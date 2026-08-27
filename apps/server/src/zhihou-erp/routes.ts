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

zhihouOrderRouter.get("/summary", (request, response, next) => {
  try {
    const query = z
      .object({
        search: z.string().trim().max(500).optional(),
        matchStatus: z.enum(["matched", "unmatched", "conflict"]).optional(),
      })
      .parse(request.query);
    const options: Parameters<typeof getZhihouOrderSummary>[0] = {};
    if (query.search) options.search = query.search;
    if (query.matchStatus) options.matchStatus = query.matchStatus;
    response.json({ data: getZhihouOrderSummary(options) });
  } catch (error) {
    next(error);
  }
});

zhihouOrderRouter.get("/summary/:key/orders", (request, response, next) => {
  try {
    const key = z.string().trim().min(1).max(100).parse(request.params.key);
    response.json({ data: getZhihouOrderReferences(key) });
  } catch (error) {
    next(error);
  }
});
