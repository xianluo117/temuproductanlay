import { Router } from "express";
import { z } from "zod";
import {
  authenticatedUser,
  requireAdministrator,
} from "../auth/middleware.js";
import {
  getZhihouAccount,
  saveZhihouAccount,
  testZhihouAccount,
} from "./account-service.js";
import {
  latestZhihouOrderSync,
  syncZhihouPendingOrders,
} from "./order-sync-service.js";
import {
  getZhihouOrderReferences,
  getZhihouOrderSummary,
} from "./order-summary-service.js";
import {
  adjustZhihouStockInventory,
  createZhihouBatchStockPick,
  createZhihouStockPick,
  deleteZhihouStockPick,
  getZhihouStockPickDashboard,
  matchZhihouStockPicks,
  previewZhihouBatchStockPick,
} from "./stock-pick-service.js";

export const zhihouAdminRouter = Router();
export const zhihouOrderRouter = Router();

zhihouAdminRouter.use(requireAdministrator);

const accountSchema = z.object({
  account: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500).optional(),
  enabled: z.boolean().default(true),
});

zhihouAdminRouter.get("/account", (_request, response) => {
  response.json({ data: getZhihouAccount() });
});

zhihouAdminRouter.put("/account", (request, response, next) => {
  try {
    response.json({
      data: saveZhihouAccount(accountSchema.parse(request.body)),
    });
  } catch (error) {
    next(error);
  }
});

zhihouAdminRouter.post("/account/test", async (_request, response, next) => {
  try {
    response.json({ data: await testZhihouAccount() });
  } catch (error) {
    next(error);
  }
});

zhihouAdminRouter.get("/sync/latest", (_request, response) => {
  response.json({ data: latestZhihouOrderSync() });
});

zhihouAdminRouter.post("/sync", async (request, response, next) => {
  try {
    response.json({
      data: await syncZhihouPendingOrders(authenticatedUser(request)),
    });
  } catch (error) {
    next(error);
  }
});

const stockPickSchema = z.object({
  targetKey: z.string().trim().min(1).max(100),
  inventoryCellId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  saveConversion: z.boolean().default(false),
});

zhihouOrderRouter.get("/stock-picks", (_request, response, next) => {
  try {
    response.json({ data: getZhihouStockPickDashboard() });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.post("/stock-picks", (request, response, next) => {
  try {
    response.status(201).json({
      data: createZhihouStockPick(
        authenticatedUser(request),
        stockPickSchema.parse(request.body),
      ),
    });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.delete("/stock-picks/:id", (request, response, next) => {
  try {
    deleteZhihouStockPick(
      z.coerce.number().int().positive().parse(request.params.id),
    );
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.post("/stock-picks/match", (_request, response, next) => {
  try {
    response.json({ data: matchZhihouStockPicks() });
  } catch (error) {
    next(error);
  }
});

const batchStockPickSchema = z.object({
  targetKeys: z.array(z.string().trim().min(1).max(100)).min(1).max(5000),
});

zhihouOrderRouter.post("/stock-picks/batch-preview", (request, response, next) => {
  try {
    response.json({ data: previewZhihouBatchStockPick(batchStockPickSchema.parse(request.body)) });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.post("/stock-picks/batch", (request, response, next) => {
  try {
    response.json({
      data: createZhihouBatchStockPick(
        authenticatedUser(request),
        batchStockPickSchema.parse(request.body),
      ),
    });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.post("/stock-picks/adjust-inventory", (request, response, next) => {
  try {
    response.json({
      data: adjustZhihouStockInventory(authenticatedUser(request)),
    });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.get("/summary", (request, response, next) => {
  try {
    const query = z
      .object({
        search: z.string().trim().max(500).optional(),
        matchStatus: z.enum(["matched", "unmatched", "conflict"]).optional(),
        storeName: z.string().trim().max(200).optional(),
      })
      .parse(request.query);
    const options: Parameters<typeof getZhihouOrderSummary>[0] = {};
    if (query.search) options.search = query.search;
    if (query.matchStatus) options.matchStatus = query.matchStatus;
    if (query.storeName) options.storeName = query.storeName;
    response.json({ data: getZhihouOrderSummary(options) });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.get("/summary/:key/orders", (request, response, next) => {
  try {
    const key = z.string().trim().min(1).max(100).parse(request.params.key);
    const storeName = z.string().trim().max(200).optional().parse(request.query.storeName);
    response.json({ data: getZhihouOrderReferences(key, storeName) });
  } catch (error) {
    next(error);
  }
});
