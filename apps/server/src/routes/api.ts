import type { ImportBatch } from "@temu-analytics/shared";
import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  getDashboard,
  getProductDetail,
  getProducts,
} from "../analytics/analytics-service.js";
import {
  getAnomalies,
  getThresholds,
  updateThresholds,
} from "../analytics/anomaly-service.js";
import {
  getSpuComparison,
  listSpuComparisonCandidates,
} from "../analytics/comparison-service.js";
import {
  activeShopId,
  authenticatedUser,
  requireAdministrator,
  type AuthenticatedRequest,
} from "../auth/middleware.js";
import {
  createBackup,
  listBackups,
  restoreBackup,
  restoreStoredBackup,
} from "../backup/backup-service.js";
import {
  createShopBackup,
  listShopBackups,
  restoreShopBackup,
  restoreStoredShopBackup,
} from "../backup/user-backup-service.js";
import { config, paths } from "../config.js";
import { database } from "../database/index.js";
import { getBatchImageProgress } from "../import/image-task-service.js";
import {
  commitPendingImport,
  createImportPreview,
} from "../import/import-service.js";
import {
  createGlobalOperation,
  deleteGlobalOperation,
  listGlobalOperations,
  updateGlobalOperation,
} from "../operations/global-operation-service.js";
import {
  createProductManagementRecord,
  deleteProductManagementRecord,
  listProductManagementRecords,
  updateProductManagementRecord,
  updateProductManagementSettings,
} from "../product-management/product-management-service.js";
import {
  createProductOperation,
  createProductOperationsBatch,
  deleteProductOperation,
  listProductOperations,
  updateProductOperation,
} from "../products/operation-service.js";

export const apiRouter = Router();

const upload = multer({
  dest: paths.temp,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== ".xlsx")
      return callback(new Error("仅支持 .xlsx 文件。"));
    return callback(null, true);
  },
});

const backupUpload = multer({
  dest: paths.temp,
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const valid = path.extname(file.originalname).toLowerCase() === ".zip";
    if (!valid) return callback(new Error("仅支持 .zip 备份文件。"));
    return callback(null, true);
  },
});

apiRouter.post(
  "/imports/preview",
  upload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) throw new Error("请选择要上传的 Excel 文件。");
      response.json({
        data: await createImportPreview(
          request.file.path,
          request.file.originalname,
          activeShopId(request),
        ),
      });
    } catch (error) {
      if (request.file) void fs.promises.rm(request.file.path, { force: true });
      next(error);
    }
  },
);

apiRouter.post("/imports/commit", async (request, response, next) => {
  try {
    const input = z
      .object({
        token: z.string().min(10),
        overwrite: z.boolean().default(false),
      })
      .parse(request.body);
    response.json({
      data: await commitPendingImport(
        input.token,
        input.overwrite,
        activeShopId(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/imports", (request, response) => {
  const rows = database
    .prepare(
      `
    SELECT id, file_name, data_date, row_count, imported_at, status, replaced_batch_id, issues_json
    FROM import_batches WHERE shop_profile_id = ? ORDER BY imported_at DESC
  `,
    )
    .all(activeShopId(request)) as Array<{
    id: number;
    file_name: string;
    data_date: string;
    row_count: number;
    imported_at: string;
    status: ImportBatch["status"];
    replaced_batch_id: number | null;
    issues_json: string;
  }>;
  response.json({
    data: rows.map(
      (row): ImportBatch => ({
        id: row.id,
        fileName: row.file_name,
        dataDate: row.data_date,
        rowCount: row.row_count,
        importedAt: row.imported_at,
        status: row.status,
        replacedBatchId: row.replaced_batch_id,
        issueCount: (JSON.parse(row.issues_json) as unknown[]).length,
        imageProgress: getBatchImageProgress(row.id, activeShopId(request)),
      }),
    ),
  });
});

apiRouter.get("/imports/:id/image-progress", (request, response, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(request.params.id);
    response.json({ data: getBatchImageProgress(id, activeShopId(request)) });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/dashboard", (request, response) => {
  response.json({
    data: getDashboard(
      activeShopId(request),
      typeof request.query.date === "string" ? request.query.date : undefined,
    ),
  });
});

apiRouter.get("/products", (request, response) => {
  const options: {
    date?: string;
    search?: string;
    sort?: string;
    order?: string;
  } = {};
  if (typeof request.query.date === "string") options.date = request.query.date;
  if (typeof request.query.search === "string")
    options.search = request.query.search;
  if (typeof request.query.sort === "string") options.sort = request.query.sort;
  if (typeof request.query.order === "string")
    options.order = request.query.order;
  response.json({ data: getProducts(activeShopId(request), options) });
});

const nullableText = z.string().trim().max(500).nullable().default(null);
const nullableNumber = z
  .number()
  .finite()
  .nonnegative()
  .nullable()
  .default(null);
const productManagementBindingSchema = z.object({
  skcId: nullableText,
  skuId: nullableText,
  skcCode: nullableText,
  skuCode: nullableText,
});
const productManagementSpuSchema = z.object({
  spu: nullableText,
  initialReviewPrice: nullableNumber,
  reviewPrice: nullableNumber,
  activityDiscountOverride: z
    .number()
    .positive()
    .max(1)
    .nullable()
    .default(null),
  roas: nullableNumber,
  orderCount: z.number().int().nonnegative().nullable().default(null),
  bindings: z.array(productManagementBindingSchema).max(500).default([]),
});
const productManagementRecordSchema = z.object({
  productCode: z.string().trim().min(1).max(200),
  note: z.string().max(3000).nullable().default(null),
  weightKg: z.number().finite().nonnegative(),
  purchaseLinks: z.array(z.string().url().max(2000)).max(30).default([]),
  spuLinks: z.array(productManagementSpuSchema).max(100).default([]),
});

apiRouter.get("/product-management", (request, response, next) => {
  try {
    const scope = z
      .enum(["mine", "shop"])
      .default("mine")
      .parse(request.query.scope);
    response.json({
      data: listProductManagementRecords(
        activeShopId(request),
        authenticatedUser(request),
        scope,
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/product-management", (request, response, next) => {
  try {
    response.status(201).json({
      data: createProductManagementRecord(
        activeShopId(request),
        authenticatedUser(request),
        productManagementRecordSchema.parse(request.body),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.put("/product-management/:id", (request, response, next) => {
  try {
    response.json({
      data: updateProductManagementRecord(
        z.coerce.number().int().positive().parse(request.params.id),
        activeShopId(request),
        authenticatedUser(request),
        productManagementRecordSchema.parse(request.body),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.delete("/product-management/:id", (request, response, next) => {
  try {
    deleteProductManagementRecord(
      z.coerce.number().int().positive().parse(request.params.id),
      activeShopId(request),
      authenticatedUser(request),
    );
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

apiRouter.put(
  "/product-management/settings",
  requireAdministrator,
  (request, response, next) => {
    try {
      const input = z
        .object({
          shippingCostPerKg: z.number().finite().nonnegative(),
          recommendedProfitMargin: z.number().finite().min(0).lt(1),
        })
        .parse(request.body);
      response.json({ data: updateProductManagementSettings(input) });
    } catch (error) {
      next(error);
    }
  },
);

apiRouter.get("/spu-comparison/candidates", (request, response) => {
  response.json({ data: listSpuComparisonCandidates(activeShopId(request)) });
});

apiRouter.get("/spu-comparison", (request, response, next) => {
  try {
    const query = z
      .object({
        spus: z.string().min(1),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(request.query);
    const spus = query.spus
      .split(",")
      .map((spu) => spu.trim())
      .filter(Boolean);
    response.json({
      data: getSpuComparison(activeShopId(request), spus, query.date),
    });
  } catch (error) {
    next(error);
  }
});

const operationInputSchema = z.object({
  operatedAt: z.string().datetime({ offset: true }),
  content: z
    .string()
    .trim()
    .min(1, "操作内容不能为空。")
    .max(1000, "操作内容不能超过 1000 个字符。"),
  note: z
    .string()
    .max(3000, "备注不能超过 3000 个字符。")
    .nullable()
    .default(null),
});
const operationIdSchema = z.coerce.number().int().positive();
const batchOperationInputSchema = operationInputSchema.extend({
  spus: z
    .array(z.string().trim().min(1))
    .min(1, "请至少选择一个 SPU。")
    .max(500, "单次最多选择 500 个 SPU。"),
});

apiRouter.get("/global-operations", (request, response) => {
  response.json({ data: listGlobalOperations(activeShopId(request)) });
});

apiRouter.post("/global-operations", (request, response, next) => {
  try {
    response.status(201).json({
      data: createGlobalOperation(
        activeShopId(request),
        operationInputSchema.parse(request.body),
        authenticatedUser(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.put("/global-operations/:id", (request, response, next) => {
  try {
    const id = operationIdSchema.parse(request.params.id);
    response.json({
      data: updateGlobalOperation(
        activeShopId(request),
        id,
        operationInputSchema.parse(request.body),
        authenticatedUser(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.delete("/global-operations/:id", (request, response, next) => {
  try {
    const id = operationIdSchema.parse(request.params.id);
    deleteGlobalOperation(
      activeShopId(request),
      id,
      authenticatedUser(request),
    );
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/products/operations/batch", (request, response, next) => {
  try {
    const input = batchOperationInputSchema.parse(request.body);
    response.status(201).json({
      data: createProductOperationsBatch(
        activeShopId(request),
        input.spus,
        input,
        authenticatedUser(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/products/:spu/operations", (request, response, next) => {
  try {
    response.json({
      data: listProductOperations(activeShopId(request), request.params.spu),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.post("/products/:spu/operations", (request, response, next) => {
  try {
    const record = createProductOperation(
      activeShopId(request),
      request.params.spu,
      operationInputSchema.parse(request.body),
      authenticatedUser(request),
    );
    response.status(201).json({ data: record });
  } catch (error) {
    next(error);
  }
});

apiRouter.put("/products/:spu/operations/:id", (request, response, next) => {
  try {
    const id = operationIdSchema.parse(request.params.id);
    response.json({
      data: updateProductOperation(
        activeShopId(request),
        request.params.spu,
        id,
        operationInputSchema.parse(request.body),
        authenticatedUser(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.delete("/products/:spu/operations/:id", (request, response, next) => {
  try {
    const id = operationIdSchema.parse(request.params.id);
    deleteProductOperation(
      activeShopId(request),
      request.params.spu,
      id,
      authenticatedUser(request),
    );
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/products/:spu", (request, response) => {
  const detail = getProductDetail(activeShopId(request), request.params.spu);
  if (!detail)
    return response
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "未找到该 SPU。" } });
  return response.json({ data: detail });
});

apiRouter.get("/anomalies", (request, response) => {
  response.json({
    data: getAnomalies(
      activeShopId(request),
      typeof request.query.date === "string" ? request.query.date : undefined,
    ),
  });
});

apiRouter.get("/settings/anomaly-thresholds", (request, response) => {
  response.json({ data: getThresholds(activeShopId(request)) });
});

apiRouter.put("/settings/anomaly-thresholds", (request, response, next) => {
  try {
    const schema = z.object({
      impressionsDrop: z.number().min(0).max(1),
      clickThroughRateDrop: z.number().min(0).max(1),
      cartRateDrop: z.number().min(0).max(1),
      conversionRateDrop: z.number().min(0).max(1),
      consecutiveZeroOrderDays: z.number().int().min(1).max(30),
      minimumImpressions: z.number().int().min(0),
    });
    response.json({
      data: updateThresholds(activeShopId(request), schema.parse(request.body)),
    });
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/images/:fileName", (request, response, next) => {
  try {
    const fileName = path.basename(
      z.string().min(1).parse(request.params.fileName),
    );
    const shopId = activeShopId(request);
    const allowed = database
      .prepare(
        `
      SELECT 1 FROM products p JOIN image_assets a ON a.id = p.image_asset_id
      WHERE p.shop_profile_id = ? AND a.file_name = ? LIMIT 1
    `,
      )
      .get(shopId, fileName);
    if (!allowed)
      return response
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "图片不存在。" } });
    const target = path.join(paths.images, fileName);
    if (!fs.existsSync(target))
      return response
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "图片文件不存在。" } });
    return response.sendFile(target);
  } catch (error) {
    next(error);
  }
});

apiRouter.get("/backups", (request, response) =>
  response.json({ data: listShopBackups(activeShopId(request)) }),
);
apiRouter.post("/backups", (request, response) =>
  response.json({ data: createShopBackup(activeShopId(request), "manual") }),
);
apiRouter.get("/backups/:fileName/download", (request, response) => {
  const safeName = path.basename(String(request.params.fileName));
  const authenticated = request as unknown as AuthenticatedRequest;
  const shopId = activeShopId(request);
  const isOwnShopBackup = safeName.endsWith(`-shop-${shopId}.zip`);
  const isSystemBackup =
    authenticated.auth.user.role === "admin" &&
    !/-shop-\d+\.zip$/.test(safeName);
  if (!isOwnShopBackup && !isSystemBackup) return response.status(403).end();
  const target = path.join(paths.backups, safeName);
  if (!fs.existsSync(target)) return response.status(404).end();
  return response.download(target, safeName);
});
apiRouter.post(
  "/backups/:fileName/restore",
  async (request, response, next) => {
    try {
      const fileName = z.string().min(1).parse(request.params.fileName);
      const manifest = await restoreStoredShopBackup(
        fileName,
        activeShopId(request),
      );
      response.json({
        data: { restored: true, restartRequired: false, manifest },
      });
    } catch (error) {
      next(error);
    }
  },
);
apiRouter.post(
  "/backups/restore",
  backupUpload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) throw new Error("请选择备份文件。");
      const manifest = await restoreShopBackup(
        request.file.path,
        activeShopId(request),
      );
      response.json({
        data: { restored: true, restartRequired: false, manifest },
      });
    } catch (error) {
      if (request.file) void fs.promises.rm(request.file.path, { force: true });
      next(error);
    }
  },
);

apiRouter.get("/system-backups", requireAdministrator, (_request, response) =>
  response.json({ data: listBackups() }),
);
apiRouter.post("/system-backups", requireAdministrator, (_request, response) =>
  response.json({ data: createBackup("manual") }),
);
apiRouter.post(
  "/system-backups/:fileName/restore",
  requireAdministrator,
  async (request, response, next) => {
    try {
      const fileName = z.string().min(1).parse(request.params.fileName);
      const manifest = await restoreStoredBackup(fileName);
      response.json({
        data: { restored: true, restartRequired: true, manifest },
      });
      setTimeout(() => process.exit(75), 500);
    } catch (error) {
      next(error);
    }
  },
);
apiRouter.post(
  "/system-backups/restore",
  requireAdministrator,
  backupUpload.single("file"),
  async (request, response, next) => {
    try {
      if (!request.file) throw new Error("请选择系统备份文件。");
      const manifest = await restoreBackup(request.file.path);
      response.json({
        data: { restored: true, restartRequired: true, manifest },
      });
      setTimeout(() => process.exit(75), 500);
    } catch (error) {
      if (request.file) void fs.promises.rm(request.file.path, { force: true });
      next(error);
    }
  },
);
