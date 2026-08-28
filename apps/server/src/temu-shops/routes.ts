import { Router } from "express";
import { z } from "zod";
import { requireAdministrator } from "../auth/middleware.js";
import {
  getImageDownloadConcurrencySettings,
  updateImageDownloadConcurrencySettings,
} from "../import/image-download-settings-service.js";
import { notifyImageTaskProcessor } from "../import/image-task-service.js";
import {
  healthCheckTemuBrowser,
  startTemuBrowser,
  stopTemuBrowser,
  syncTemuLifecycle,
  syncTemuTrafficGoods,
} from "./browser-process-manager.js";
import {
  createTemuShopProfile,
  deleteTemuShopProfile,
  getTemuShopProfile,
  listTemuBrowserEvents,
  listTemuShopProfiles,
  updateTemuShopGrants,
  updateTemuShopProfile,
} from "./temu-shop-service.js";
import {
  createLifecycleSync,
  createTrafficSync,
  failLifecycleSync,
  failTrafficSync,
  latestLifecycleSync,
  latestTrafficSync,
} from "./traffic-sync-service.js";

export const temuShopAdminRouter = Router();
temuShopAdminRouter.use(requireAdministrator);

const idSchema = z.coerce.number().int().positive();
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  accountLabel: z.string().trim().min(1).max(200),
  locale: z.string().trim().min(2).max(30).default("zh-CN"),
  timezone: z.string().trim().min(2).max(100).default("Asia/Shanghai"),
  enabled: z.boolean().default(true),
  grantedUserIds: z.array(z.number().int().positive()).max(500).default([]),
});
const updateSchema = createSchema.omit({ grantedUserIds: true }).partial();
const grantSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(500),
});
const imageDownloadSettingsSchema = z.object({
  legacyImportConcurrency: z.number().int().min(1).max(50),
  globalQueueConcurrency: z.number().int().min(1).max(50),
});

temuShopAdminRouter.get("/settings/image-download-concurrency", (_request, response) => {
  response.json({ data: getImageDownloadConcurrencySettings() });
});

temuShopAdminRouter.put(
  "/settings/image-download-concurrency",
  (request, response, next) => {
    try {
      const settings = updateImageDownloadConcurrencySettings(
        imageDownloadSettingsSchema.parse(request.body),
      );
      notifyImageTaskProcessor();
      response.json({ data: settings });
    } catch (error) {
      next(error);
    }
  },
);

temuShopAdminRouter.get("/", (_request, response) =>
  response.json({ data: listTemuShopProfiles() }),
);

temuShopAdminRouter.post("/", (request, response, next) => {
  try {
    response
      .status(201)
      .json({ data: createTemuShopProfile(createSchema.parse(request.body)) });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.get("/:id", (request, response, next) => {
  try {
    response.json({
      data: getTemuShopProfile(idSchema.parse(request.params.id)),
    });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.patch("/:id", (request, response, next) => {
  try {
    response.json({
      data: updateTemuShopProfile(
        idSchema.parse(request.params.id),
        updateSchema.parse(request.body),
      ),
    });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.delete("/:id", (request, response, next) => {
  try {
    deleteTemuShopProfile(idSchema.parse(request.params.id));
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.put("/:id/grants", (request, response, next) => {
  try {
    const input = grantSchema.parse(request.body);
    response.json({
      data: updateTemuShopGrants(
        idSchema.parse(request.params.id),
        input.userIds,
      ),
    });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.post(
  "/:id/browser/start-login",
  (request, response, next) => {
    try {
      const profile = startTemuBrowser(idSchema.parse(request.params.id));
      response
        .status(202)
        .json({ data: { profile, message: "正在启动可视浏览器。" } });
    } catch (error) {
      next(error);
    }
  },
);

temuShopAdminRouter.post("/:id/browser/health", (request, response, next) => {
  try {
    const profile = healthCheckTemuBrowser(idSchema.parse(request.params.id));
    response
      .status(202)
      .json({ data: { profile, message: "健康检查已发送。" } });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.post("/:id/browser/stop", (request, response, next) => {
  try {
    const profile = stopTemuBrowser(idSchema.parse(request.params.id));
    response
      .status(202)
      .json({ data: { profile, message: "正在停止浏览器实例。" } });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.get("/:id/browser/status", (request, response, next) => {
  try {
    response.json({
      data: getTemuShopProfile(idSchema.parse(request.params.id)),
    });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.post("/:id/traffic/sync", (request, response, next) => {
  try {
    const shopId = idSchema.parse(request.params.id);
    const authenticated =
      request as unknown as import("../auth/middleware.js").AuthenticatedRequest;
    const sync = createTrafficSync(shopId, authenticated.auth.user.id);
    try {
      syncTemuTrafficGoods(shopId, sync.id);
    } catch (error) {
      failTrafficSync(
        shopId,
        sync.id,
        error instanceof Error ? error.message : "同步启动失败。",
      );
      throw error;
    }
    response
      .status(202)
      .json({ data: { sync, message: "商品流量同步已开始。" } });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.post("/:id/lifecycle/sync", (request, response, next) => {
  try {
    const shopId = idSchema.parse(request.params.id);
    const authenticated =
      request as unknown as import("../auth/middleware.js").AuthenticatedRequest;
    const sync = createLifecycleSync(shopId, authenticated.auth.user.id, 50);
    try {
      syncTemuLifecycle(shopId, sync.id);
    } catch (error) {
      failLifecycleSync(
        shopId,
        sync.id,
        error instanceof Error ? error.message : "同步启动失败。",
      );
      throw error;
    }
    response.status(202).json({
      data: { sync, message: "已发布到站点生命周期同步已开始。" },
    });
  } catch (error) {
    next(error);
  }
});

temuShopAdminRouter.get(
  "/:id/traffic/sync/latest",
  (request, response, next) => {
    try {
      response.json({
        data: latestTrafficSync(idSchema.parse(request.params.id)),
      });
    } catch (error) {
      next(error);
    }
  },
);

temuShopAdminRouter.get(
  "/:id/lifecycle/sync/latest",
  (request, response, next) => {
    try {
      response.json({
        data: latestLifecycleSync(idSchema.parse(request.params.id)),
      });
    } catch (error) {
      next(error);
    }
  },
);

temuShopAdminRouter.get("/:id/events", (request, response, next) => {
  try {
    response.json({
      data: listTemuBrowserEvents(idSchema.parse(request.params.id)),
    });
  } catch (error) {
    next(error);
  }
});
