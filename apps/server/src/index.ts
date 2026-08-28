import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { requireAuthentication } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { config } from "./config.js";
import { closeDatabase, runDatabaseMigrations } from "./database/index.js";
import {
  startImageTaskProcessor,
  stopImageTaskProcessor,
} from "./import/image-task-service.js";
import { apiRouter } from "./routes/api.js";
import {
  initializeTemuBrowserManager,
  stopAllTemuBrowsers,
} from "./temu-shops/browser-process-manager.js";
import { temuShopAdminRouter } from "./temu-shops/routes.js";
import {
  zhihouAdminRouter,
  zhihouOrderRouter,
} from "./zhihou-erp/routes.js";

runDatabaseMigrations();

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_request, response) => {
  response.json({ data: { status: "ok", time: new Date().toISOString() } });
});
app.use("/api/auth", authRouter);
app.use("/api/admin/temu-shops", requireAuthentication, temuShopAdminRouter);
app.use("/api/admin/zhihou-erp", requireAuthentication, zhihouAdminRouter);
app.use("/api/zhihou-orders", requireAuthentication, zhihouOrderRouter);
app.use("/api", requireAuthentication, apiRouter);

if (fs.existsSync(config.webDistDirectory)) {
  app.use(express.static(config.webDistDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/"))
      return next();
    return response.sendFile(path.join(config.webDistDirectory, "index.html"));
  });
}

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      error instanceof Error ? error.message : "服务器发生未知错误。";
    const status = error instanceof ZodError ? 400 : 500;
    if (status === 500) console.error(error);
    response.status(status).json({
      error: {
        code: error instanceof ZodError ? "VALIDATION_ERROR" : "SERVER_ERROR",
        message,
        details: error instanceof ZodError ? error.issues : undefined,
      },
    });
  },
);

const server = app.listen(config.port, config.host, () => {
  console.log(`Temu Analytics API: http://${config.host}:${config.port}`);
  initializeTemuBrowserManager();
  startImageTaskProcessor();
});

function shutdown(): void {
  stopImageTaskProcessor();
  stopAllTemuBrowsers();
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
