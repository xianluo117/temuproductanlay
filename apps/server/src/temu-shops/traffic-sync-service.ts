import type {
  TemuLifecycleListResponse,
  TemuLifecycleSyncStatus,
  TemuTrafficSyncStatus,
} from "@temu-analytics/shared";
import { createShopBackup } from "../backup/user-backup-service.js";
import {
  lifecycleSkcImageKey,
  promoteErpSkuImageToSkc,
  queueImageTarget,
} from "../import/image-association-service.js";
import { database } from "../database/index.js";
import { autoCreateLifecycleProductRecords } from "./lifecycle-auto-service.js";
import {
  lifecycleSuggestedPrice,
  lifecycleSupplierPrice,
  minimumLifecyclePrice,
} from "./lifecycle-parser.js";

interface SyncRow {
  id: number;
  shop_profile_id: number;
  requested_by_username: string;
  time_dimension: number;
  page_size: number;
  total_pages: number;
  total_items: number;
  imported_items: number;
  replaced_items: number;
  status: TemuTrafficSyncStatus["status"];
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

interface TrafficPage {
  syncId: number;
  pageNumber: number;
  pageSize: number;
  total: number;
  totalPages: number;
  requestBody: Record<string, unknown>;
  httpStatus: number;
  durationMs: number;
  payload: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

interface LifecycleSyncRow {
  id: number;
  shop_profile_id: number;
  requested_by_username: string;
  page_size: number;
  total_pages: number;
  total_spus: number;
  total_skcs: number;
  total_skus: number;
  status: TemuLifecycleSyncStatus["status"];
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function mapLifecycleSync(row: LifecycleSyncRow): TemuLifecycleSyncStatus {
  return {
    id: row.id,
    shopProfileId: row.shop_profile_id,
    requestedByUsername: row.requested_by_username,
    pageSize: row.page_size,
    totalPages: row.total_pages,
    totalSpus: row.total_spus,
    totalSkcs: row.total_skcs,
    totalSkus: row.total_skus,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export function latestLifecycleSync(
  shopId: number,
): TemuLifecycleSyncStatus | null {
  const row = database
    .prepare(
      `SELECT sync.*, user.username AS requested_by_username
       FROM temu_lifecycle_sync_batches sync
       JOIN users user ON user.id = sync.requested_by_user_id
       WHERE sync.shop_profile_id = ?
       ORDER BY sync.started_at DESC, sync.id DESC LIMIT 1`,
    )
    .get(shopId) as LifecycleSyncRow | undefined;
  return row ? mapLifecycleSync(row) : null;
}

export function listLifecycleCurrent(
  shopId: number,
): TemuLifecycleListResponse {
  const latestSync = latestLifecycleSync(shopId);
  const spus = database
    .prepare(
      `SELECT id, spu, product_id, product_code, main_image_url,
              lowest_review_price, traffic_limit_price, sync_batch_id
       FROM temu_lifecycle_spu_current WHERE shop_profile_id = ? ORDER BY id`,
    )
    .all(shopId) as Array<Record<string, unknown>>;
  const items = spus.map((spu) => {
    const skcs = database
      .prepare(
        `SELECT id, skc_id, skc_code, attribute_json, image_url, image_asset_id,
                lowest_review_price, traffic_limit_price
         FROM temu_lifecycle_skc_current WHERE spu_row_id = ? ORDER BY id`,
      )
      .all(Number(spu.id)) as Array<Record<string, unknown>>;
    const lowestSupplierPrice =
      (spu.lowest_review_price as number | null) ?? null;
    return {
      id: Number(spu.id),
      spu: String(spu.spu),
      productId: (spu.product_id as string | null) ?? null,
      productCode: (spu.product_code as string | null) ?? null,
      mainImageUrl: (spu.main_image_url as string | null) ?? null,
      lowestSupplierPrice,
      lowestReviewPrice: lowestSupplierPrice,
      trafficLimitPrice: (spu.traffic_limit_price as number | null) ?? null,
      lastSyncBatchId: Number(spu.sync_batch_id),
      skcs: skcs.map((skc) => {
        const skcLowestSupplierPrice =
          (skc.lowest_review_price as number | null) ?? null;
        return {
        id: Number(skc.id),
        skcId: (skc.skc_id as string | null) ?? null,
        skcCode: (skc.skc_code as string | null) ?? null,
        attributeJson: (skc.attribute_json as string | null) ?? null,
        imageUrl: (skc.image_url as string | null) ?? null,
        imageAssetId: (skc.image_asset_id as number | null) ?? null,
        lowestSupplierPrice: skcLowestSupplierPrice,
        lowestReviewPrice: skcLowestSupplierPrice,
        trafficLimitPrice: (skc.traffic_limit_price as number | null) ?? null,
        skus: database
          .prepare(
            `SELECT id, sku_id, sku_code, size_name, specification_json,
                    lowest_supplier_price, suggested_price
             FROM temu_lifecycle_sku_current WHERE skc_row_id = ? ORDER BY id`,
          )
          .all(Number(skc.id))
          .map((sku) => {
            const row = sku as Record<string, unknown>;
            const trafficLimitPrice =
              (row.suggested_price as number | null) ?? null;
            return {
              id: Number(row.id),
              skuId: (row.sku_id as string | null) ?? null,
              skuCode: (row.sku_code as string | null) ?? null,
              sizeName: (row.size_name as string | null) ?? null,
              specificationJson:
                (row.specification_json as string | null) ?? null,
              lowestSupplierPrice:
                (row.lowest_supplier_price as number | null) ?? null,
              trafficLimitPrice,
              suggestedPrice: trafficLimitPrice,
            };
          }),
        };
      }),
    };
  });
  return { shopProfileId: shopId, latestSync, items };
}

function mapSync(row: SyncRow): TemuTrafficSyncStatus {
  return {
    id: row.id,
    shopProfileId: row.shop_profile_id,
    requestedByUsername: row.requested_by_username,
    timeDimension: row.time_dimension,
    pageSize: row.page_size,
    totalPages: row.total_pages,
    totalItems: row.total_items,
    importedItems: row.imported_items,
    replacedItems: row.replaced_items,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export function getTrafficSync(id: number): TemuTrafficSyncStatus {
  const row = database
    .prepare(
      `
    SELECT sync.*, user.username AS requested_by_username
    FROM traffic_sync_batches sync
    JOIN users user ON user.id = sync.requested_by_user_id
    WHERE sync.id = ?
  `,
    )
    .get(id) as SyncRow | undefined;
  if (!row) throw new Error("流量同步任务不存在。");
  return mapSync(row);
}

export function latestTrafficSync(
  shopId: number,
): TemuTrafficSyncStatus | null {
  const row = database
    .prepare(
      `
    SELECT sync.*, user.username AS requested_by_username
    FROM traffic_sync_batches sync
    JOIN users user ON user.id = sync.requested_by_user_id
    WHERE sync.shop_profile_id = ?
    ORDER BY sync.started_at DESC, sync.id DESC LIMIT 1
  `,
    )
    .get(shopId) as SyncRow | undefined;
  return row ? mapSync(row) : null;
}

export function createTrafficSync(
  shopId: number,
  userId: number,
  pageSize = 30,
): TemuTrafficSyncStatus {
  const running = database
    .prepare(
      "SELECT id FROM traffic_sync_batches WHERE shop_profile_id = ? AND status = 'running' LIMIT 1",
    )
    .get(shopId);
  if (running) throw new Error("该店铺已有商品流量同步任务正在运行。");
  createShopBackup(shopId, "automatic");
  const result = database
    .prepare(
      `
    INSERT INTO traffic_sync_batches
    (shop_profile_id, requested_by_user_id, time_dimension, page_size, status)
    VALUES (?, ?, 1, ?, 'running')
  `,
    )
    .run(shopId, userId, pageSize);
  return getTrafficSync(Number(result.lastInsertRowid));
}

function textValue(
  item: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = item[key];
    if (value !== null && value !== undefined && String(value).trim())
      return String(value).trim();
  }
  return null;
}

function firstListedAtValue(item: Record<string, unknown>): string | null {
  const raw = textValue(item, [
    "firstBindSiteTimeStr",
    "firstSiteTime",
    "firstListedAt",
    "joinSiteTime",
  ]);
  if (raw) {
    const date = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (date) return date;
  }

  const timestamp = item.firstBindSiteTime;
  if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

function numberValue(item: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const raw = item[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const text = String(raw).replace(/,/g, "").replace(/%$/, "").trim();
    if (!text) continue;
    const value = Number(text);
    if (Number.isFinite(value) && value >= 0) return Math.round(value);
  }
  return 0;
}

/** Temu 流量接口的百分比字段均按百分数返回，例如 0.9288 表示 0.9288%。 */
function temuPercentageValue(
  item: Record<string, unknown>,
  keys: string[],
): number | null {
  const raw = textValue(item, keys);
  if (!raw) return null;
  const value = Number(raw.replace("%", ""));
  if (!Number.isFinite(value) || value < 0) return null;
  return value / 100;
}

function normalizeDate(raw: string | null): string {
  if (raw) {
    const match = raw.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function trafficDate(item: Record<string, unknown>): string {
  return normalizeDate(
    textValue(item, [
      "statDate",
      "dataDate",
      "date",
      "pt",
      "startDate",
      "endDate",
    ]),
  );
}

export interface LifecyclePage {
  syncId: number;
  pageNumber: number;
  pageSize: number;
  total: number;
  totalPages: number;
  requestBody: Record<string, unknown>;
  httpStatus: number;
  durationMs: number;
  payload: Record<string, unknown>;
  items: Array<Record<string, unknown>>;
}

function lifecycleImage(item: Record<string, unknown>): string | null {
  const direct = textValue(item, [
    "thumbUrl",
    "imageUrl",
    "goodsImageUrl",
    "mainImageUrl",
    "productImageUrl",
    "skuPreviewImage",
  ]);
  if (direct) return direct;
  for (const key of ["carouselImageUrlList", "previewImgUrlList"]) {
    const values = item[key];
    if (Array.isArray(values)) {
      const first = values.find(
        (value): value is string =>
          typeof value === "string" && Boolean(value.trim()),
      );
      if (first) return first.trim();
    }
  }
  return null;
}

function objectArray(
  item: Record<string, unknown>,
  keys: string[],
): Array<Record<string, unknown>> {
  for (const key of keys) {
    const value = item[key];
    if (Array.isArray(value))
      return value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object",
      );
  }
  return [];
}

function lifecycleSpu(item: Record<string, unknown>): string | null {
  return textValue(item, ["spu", "productSpu", "productSpuId", "productId"]);
}

function lifecycleCode(item: Record<string, unknown>): string | null {
  return textValue(item, ["productCode", "goodsCode", "productSn", "extCode"]);
}

function lifecycleSkcs(
  item: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return objectArray(item, ["skcList", "skcs", "productSkcList"]);
}

function lifecycleSkus(
  item: Record<string, unknown>,
): Array<Record<string, unknown>> {
  return objectArray(item, ["skuList", "skus", "productSkuList"]);
}

export function storeLifecyclePage(shopId: number, page: LifecyclePage): void {
  const transaction = database.transaction(() => {
    database
      .prepare(
        `INSERT OR REPLACE INTO temu_lifecycle_raw_responses
         (sync_batch_id, shop_profile_id, page_number, request_json,
          http_status, error_code, response_json, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        page.syncId,
        shopId,
        page.pageNumber,
        JSON.stringify(page.requestBody),
        page.httpStatus,
        Number(page.payload.errorCode ?? 0) || null,
        JSON.stringify(page.payload),
        page.durationMs,
      );

    const spus = database.prepare(`
      INSERT INTO temu_lifecycle_spu_current
        (shop_profile_id, sync_batch_id, spu, product_id, product_code,
         main_image_url, lowest_review_price, traffic_limit_price, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(shop_profile_id, spu) DO UPDATE SET
        sync_batch_id = CASE
          WHEN excluded.main_image_url IS NOT NULL
            OR excluded.product_id IS NOT NULL
            OR excluded.product_code IS NOT NULL
          THEN excluded.sync_batch_id
          ELSE sync_batch_id
        END,
        product_id = COALESCE(excluded.product_id, product_id),
        product_code = COALESCE(excluded.product_code, product_code),
        main_image_url = COALESCE(excluded.main_image_url, main_image_url),
        lowest_review_price = excluded.lowest_review_price,
        traffic_limit_price = excluded.traffic_limit_price,
        updated_at = CURRENT_TIMESTAMP
    `);
    const selectSpu = database.prepare(
      "SELECT id, sync_batch_id FROM temu_lifecycle_spu_current WHERE shop_profile_id = ? AND spu = ?",
    );
    const deleteSkcs = database.prepare(
      "DELETE FROM temu_lifecycle_skc_current WHERE spu_row_id = ?",
    );
    const skcs = database.prepare(`
      INSERT INTO temu_lifecycle_skc_current
        (spu_row_id, sync_batch_id, skc_id, skc_code, attribute_json, image_url,
         lowest_review_price, traffic_limit_price, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const skus = database.prepare(`
      INSERT INTO temu_lifecycle_sku_current
        (skc_row_id, sync_batch_id, sku_id, sku_code, size_name,
         specification_json, lowest_supplier_price, suggested_price, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    let spuCount = 0;
    let skcCount = 0;
    let skuCount = 0;

    for (const item of page.items) {
      const spu = lifecycleSpu(item);
      if (!spu) continue;
      const existingSpu = selectSpu.get(shopId, spu) as
        | { id: number; sync_batch_id: number }
        | undefined;
      const skcItems = lifecycleSkcs(item);
      const reviewPrices = skcItems.flatMap((skc) => [
        lifecycleSupplierPrice(skc),
        ...lifecycleSkus(skc).map((sku) => lifecycleSupplierPrice(sku)),
      ]);
      const trafficPrices = skcItems.flatMap((skc) => [
        lifecycleSuggestedPrice(skc),
        ...lifecycleSkus(skc).map((sku) => lifecycleSuggestedPrice(sku)),
      ]);
      spus.run(
        shopId,
        page.syncId,
        spu,
        textValue(item, ["productId", "goodsId"]),
        lifecycleCode(item),
        lifecycleImage(item),
        minimumLifecyclePrice(reviewPrices),
        minimumLifecyclePrice(trafficPrices),
      );
      const spuId = Number(
        existingSpu?.id ??
          (selectSpu.get(shopId, spu) as { id: number } | undefined)?.id,
      );
      if (!Number.isInteger(spuId) || spuId <= 0) {
        throw new Error(`生命周期 SPU 写入后无法读取主键：${spu}`);
      }
      if (existingSpu && existingSpu.sync_batch_id !== page.syncId) {
        const beforeDelete = database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM temu_lifecycle_skc_current WHERE spu_row_id = ?) AS skc_count,
               (SELECT COUNT(*) FROM temu_lifecycle_sku_current sku
                JOIN temu_lifecycle_skc_current skc ON skc.id = sku.skc_row_id
                WHERE skc.spu_row_id = ?) AS sku_count,
               (SELECT COUNT(*) FROM y2_inventory_colors color
                WHERE color.skc_row_id IN (
                  SELECT id FROM temu_lifecycle_skc_current WHERE spu_row_id = ?
                )) AS inventory_skc_refs,
               (SELECT COUNT(*) FROM y2_inventory_cells cell
                WHERE cell.sku_row_id IN (
                  SELECT sku.id
                  FROM temu_lifecycle_sku_current sku
                  JOIN temu_lifecycle_skc_current skc ON skc.id = sku.skc_row_id
                  WHERE skc.spu_row_id = ?
                )) AS inventory_sku_refs`,
          )
          .get(spuId, spuId, spuId, spuId) as {
            skc_count: number;
            sku_count: number;
            inventory_skc_refs: number;
            inventory_sku_refs: number;
          };
        console.warn("[LifecycleSync] replacing lifecycle SKC/SKU rows; Y2 foreign-key refs may be nulled", {
          shopId,
          syncId: page.syncId,
          spu,
          spuId,
          previousSyncId: existingSpu.sync_batch_id,
          ...beforeDelete,
        });
        deleteSkcs.run(spuId);
      }
      spuCount += 1;
      for (const skc of lifecycleSkcs(item)) {
        const skcId = textValue(skc, ["skcId", "goodsSkcId", "id"]);
        const skcCode = textValue(skc, [
          "skcCode",
          "goodsSkcCode",
          "extCode",
          "productCode",
        ]);
        const skuItems = lifecycleSkus(skc);
        const skcSupplierPrice = minimumLifecyclePrice([
          lifecycleSupplierPrice(skc),
          ...skuItems.map((sku) => lifecycleSupplierPrice(sku)),
        ]);
        const skcSuggestedPrice = minimumLifecyclePrice([
          lifecycleSuggestedPrice(skc),
          ...skuItems.map((sku) => lifecycleSuggestedPrice(sku)),
        ]);
        const skcImage = lifecycleImage(skc) ?? lifecycleSkus(skc)
          .map((sku) => lifecycleImage(sku))
          .find((url): url is string => Boolean(url));
        const skcResult = skcs.run(
          spuId,
          page.syncId,
          skcId,
          skcCode,
          JSON.stringify([
            ...(Array.isArray(skc.productPropertyList) ? skc.productPropertyList : []),
            ...(skc.colorName ? [{ name: "颜色", value: skc.colorName }] : []),
          ]),
          skcImage ?? null,
          skcSupplierPrice,
          skcSuggestedPrice,
        );
        const skcRowId = Number(skcResult.lastInsertRowid);
        if (skcImage) {
          queueImageTarget({
            url: skcImage,
            targetType: "skc",
            shopId,
            targetKey: lifecycleSkcImageKey(skcRowId),
            sourceType: "lifecycle",
            priority: 100,
          });
        }
        skcCount += 1;
        for (const sku of skuItems) {
          const skuId = textValue(sku, ["skuId", "goodsSkuId", "id"]);
          const skuCode = textValue(sku, [
            "skuCode",
            "goodsSkuCode",
            "extCode",
            "productCode",
          ]);
          skus.run(
            skcRowId,
            page.syncId,
            skuId,
            skuCode,
            textValue(sku, ["sizeName", "size", "specification"]),
            JSON.stringify(
              sku.productPropertyList ??
                sku.attributes ??
                sku.propertyList ??
                [],
            ),
            lifecycleSupplierPrice(sku),
            lifecycleSuggestedPrice(sku),
          );
          for (const zhihouSku of [skuId, skuCode]) {
            promoteErpSkuImageToSkc({ zhihouSku, shopId, skcRowId });
          }
          skuCount += 1;
        }
      }
    }
    database
      .prepare(
        `UPDATE temu_lifecycle_sync_batches
         SET total_pages = ?, total_spus = total_spus + ?,
             total_skcs = total_skcs + ?, total_skus = total_skus + ?
         WHERE id = ? AND shop_profile_id = ?`,
      )
      .run(page.totalPages, spuCount, skcCount, skuCount, page.syncId, shopId);
  });
  transaction();
  restoreY2InventoryBindings(
    shopId,
    page.items.map((item) => lifecycleSpu(item)).filter((value): value is string => Boolean(value)),
  );
}

function restoreY2InventoryBindings(shopId: number, spus: string[]): void {
  const normalizedSpus = [...new Set(
    spus.map((value) => value.trim().toUpperCase()).filter(Boolean),
  )];
  if (!normalizedSpus.length) return;

  const placeholders = normalizedSpus.map(() => "?").join(", ");
  const restore = database.transaction(() => {
    const products = database.prepare(
      `SELECT id, spu FROM y2_inventory_products
       WHERE UPPER(TRIM(COALESCE(spu, ''))) IN (${placeholders})`,
    ).all(...normalizedSpus) as Array<{ id: number; spu: string | null }>;
    const spusByProductId = new Map(products.map((product) => [product.id, product.spu?.trim().toUpperCase() ?? ""]));
    const skcs = database.prepare(
      `SELECT lifecycle_skc.id AS row_id, lifecycle_spu.spu, lifecycle_skc.skc_id, lifecycle_skc.skc_code
       FROM temu_lifecycle_skc_current lifecycle_skc
       JOIN temu_lifecycle_spu_current lifecycle_spu ON lifecycle_spu.id = lifecycle_skc.spu_row_id
       WHERE UPPER(TRIM(lifecycle_spu.spu)) IN (${placeholders})`,
    ).all(...normalizedSpus) as Array<{ row_id: number; spu: string; skc_id: string | null; skc_code: string | null }>;
    const skcByIdentity = new Map<string, number>();
    for (const skc of skcs) {
      for (const value of [skc.skc_id, skc.skc_code]) {
        if (value?.trim()) skcByIdentity.set(`${skc.spu.trim().toUpperCase()}\u0000${value.trim().toUpperCase()}`, skc.row_id);
      }
    }

    const colors = database.prepare(
      `SELECT id, inventory_product_id, skc_id, skc_code
       FROM y2_inventory_colors
       WHERE inventory_product_id IN (${products.map(() => "?").join(", ") || "NULL"})`,
    ).all(...products.map((product) => product.id)) as Array<{ id: number; inventory_product_id: number; skc_id: string | null; skc_code: string | null }>;
    const updateColor = database.prepare(
      `UPDATE y2_inventory_colors
       SET skc_row_id = ?, match_status = ?, match_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    for (const color of colors) {
      const spu = spusByProductId.get(color.inventory_product_id) ?? "";
      const rowId = [color.skc_id, color.skc_code]
        .map((value) => value?.trim().toUpperCase())
        .filter(Boolean)
        .map((value) => skcByIdentity.get(`${spu}\u0000${value}`))
        .find((value): value is number => value !== undefined) ?? null;
      updateColor.run(rowId, rowId ? "matched" : "unmatched", rowId ? null : "生命周期同步后未找到原SKC", color.id);
    }

    const skus = database.prepare(
      `SELECT cell.id, cell.sku_id, cell.sku_code, color.skc_id, color.skc_code,
              color.inventory_product_id
       FROM y2_inventory_cells cell
       JOIN y2_inventory_colors color ON color.id = cell.color_row_id
       WHERE color.inventory_product_id IN (${products.map(() => "?").join(", ") || "NULL"})`,
    ).all(...products.map((product) => product.id)) as Array<{
      id: number; sku_id: string | null; sku_code: string | null;
      skc_id: string | null; skc_code: string | null; inventory_product_id: number;
    }>;
    const skuRows = database.prepare(
      `SELECT lifecycle_sku.id AS row_id, lifecycle_spu.spu,
              lifecycle_skc.skc_id, lifecycle_skc.skc_code,
              lifecycle_sku.sku_id, lifecycle_sku.sku_code
       FROM temu_lifecycle_sku_current lifecycle_sku
       JOIN temu_lifecycle_skc_current lifecycle_skc ON lifecycle_skc.id = lifecycle_sku.skc_row_id
       JOIN temu_lifecycle_spu_current lifecycle_spu ON lifecycle_spu.id = lifecycle_skc.spu_row_id
       WHERE UPPER(TRIM(lifecycle_spu.spu)) IN (${placeholders})`,
    ).all(...normalizedSpus) as Array<{
      row_id: number; spu: string; skc_id: string | null; skc_code: string | null;
      sku_id: string | null; sku_code: string | null;
    }>;
    const skuByIdentity = new Map<string, number>();
    for (const sku of skuRows) {
      for (const value of [sku.sku_id, sku.sku_code]) {
        if (value?.trim()) skuByIdentity.set(`${sku.spu.trim().toUpperCase()}\u0000${sku.skc_id?.trim().toUpperCase() ?? ""}\u0000${sku.skc_code?.trim().toUpperCase() ?? ""}\u0000${value.trim().toUpperCase()}`, sku.row_id);
      }
    }
    const updateCell = database.prepare(
      `UPDATE y2_inventory_cells
       SET sku_row_id = ?, match_status = ?, match_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    for (const cell of skus) {
      const spu = spusByProductId.get(cell.inventory_product_id) ?? "";
      const skcKey = `${spu}\u0000${cell.skc_id?.trim().toUpperCase() ?? ""}\u0000${cell.skc_code?.trim().toUpperCase() ?? ""}`;
      const rowId = [cell.sku_id, cell.sku_code]
        .map((value) => value?.trim().toUpperCase())
        .filter(Boolean)
        .map((value) => skuByIdentity.get(`${skcKey}\u0000${value}`))
        .find((value): value is number => value !== undefined) ?? null;
      updateCell.run(rowId, rowId ? "matched" : "unmatched", rowId ? null : "生命周期同步后未找到原SKU", cell.id);
    }
  });
  restore();
}

export function reprocessLifecycleBatch(shopId: number, syncId: number): void {
  const rows = database
    .prepare(
      `SELECT page_number, request_json, http_status, response_json, duration_ms
       FROM temu_lifecycle_raw_responses
       WHERE shop_profile_id = ? AND sync_batch_id = ?
       ORDER BY page_number`,
    )
    .all(shopId, syncId) as Array<{
    page_number: number;
    request_json: string;
    http_status: number;
    response_json: string;
    duration_ms: number;
  }>;
  if (rows.length === 0) {
    throw new Error(`生命周期同步批次不存在或没有原始响应：${syncId}`);
  }

  const reprocess = database.transaction(() => {
    database
      .prepare(
        `DELETE FROM temu_lifecycle_skc_current
         WHERE sync_batch_id = ? AND spu_row_id IN (
           SELECT id FROM temu_lifecycle_spu_current
           WHERE shop_profile_id = ?
         )`,
      )
      .run(syncId, shopId);
    database
      .prepare(
        `UPDATE temu_lifecycle_sync_batches
         SET total_pages = 0, total_spus = 0, total_skcs = 0, total_skus = 0
         WHERE id = ? AND shop_profile_id = ?`,
      )
      .run(syncId, shopId);

    for (const row of rows) {
      const payload = JSON.parse(row.response_json) as Record<string, unknown>;
      const result = payload.result as Record<string, unknown> | undefined;
      const items = objectArray(result ?? {}, [
        "dataList",
        "pageItems",
        "list",
        "goodsList",
        "data",
        "records",
        "items",
      ]);
      const requestBody = JSON.parse(row.request_json) as Record<string, unknown>;
      const pageSize = Number(requestBody.pageSize ?? 50) || 50;
      const total = Number(result?.total ?? items.length) || items.length;
      storeLifecyclePage(shopId, {
        syncId,
        pageNumber: row.page_number,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        requestBody,
        httpStatus: row.http_status,
        durationMs: row.duration_ms,
        payload,
        items,
      });
    }
  });

  reprocess();
  database
    .prepare(
      `UPDATE temu_lifecycle_sync_batches
       SET status = 'completed', error_message = NULL,
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND shop_profile_id = ? AND status = 'partial'`,
    )
    .run(syncId, shopId);
  autoCreateLifecycleProductRecords(shopId, syncId);
}

export function createLifecycleSync(
  shopId: number,
  userId: number,
  pageSize = 50,
): TemuLifecycleSyncStatus {
  const running = database
    .prepare(
      "SELECT id FROM temu_lifecycle_sync_batches WHERE shop_profile_id = ? AND status = 'running' LIMIT 1",
    )
    .get(shopId);
  if (running) throw new Error("该店铺已有生命周期同步任务正在运行。");
  const result = database
    .prepare(
      `INSERT INTO temu_lifecycle_sync_batches
       (shop_profile_id, requested_by_user_id, page_size, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .run(shopId, userId, pageSize);
  return getLifecycleSync(Number(result.lastInsertRowid));
}

export function getLifecycleSync(id: number): TemuLifecycleSyncStatus {
  const row = database
    .prepare(
      `SELECT sync.*, user.username AS requested_by_username
       FROM temu_lifecycle_sync_batches sync
       JOIN users user ON user.id = sync.requested_by_user_id
       WHERE sync.id = ?`,
    )
    .get(id) as LifecycleSyncRow | undefined;
  if (!row) throw new Error("生命周期同步任务不存在。");
  return mapLifecycleSync(row);
}

export function completeLifecycleSync(
  shopId: number,
  syncId: number,
): TemuLifecycleSyncStatus {
  database
    .prepare(
      `UPDATE temu_lifecycle_sync_batches
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND shop_profile_id = ? AND status = 'running'`,
    )
    .run(syncId, shopId);
  try {
    autoCreateLifecycleProductRecords(shopId, syncId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "生命周期同步后处理失败。";
    database
      .prepare(
        `UPDATE temu_lifecycle_sync_batches
         SET status = 'partial', error_message = ?, completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP)
         WHERE id = ? AND shop_profile_id = ? AND status = 'completed'`,
      )
      .run(message, syncId, shopId);
  }
  return getLifecycleSync(syncId);
}

export function failLifecycleSync(
  shopId: number,
  syncId: number,
  message: string,
): TemuLifecycleSyncStatus {
  database
    .prepare(
      `UPDATE temu_lifecycle_sync_batches
       SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
       WHERE id = ? AND shop_profile_id = ? AND status = 'running'`,
    )
    .run(message, syncId, shopId);
  return getLifecycleSync(syncId);
}

export function storeTrafficPage(shopId: number, page: TrafficPage): void {
  const transaction = database.transaction(() => {
    database
      .prepare(
        `
      INSERT OR REPLACE INTO traffic_raw_responses
      (sync_batch_id, shop_profile_id, endpoint, page_number, request_json,
       http_status, error_code, response_json, duration_ms)
      VALUES (?, ?, '/api/flow/analysis/list', ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        page.syncId,
        shopId,
        page.pageNumber,
        JSON.stringify(page.requestBody),
        page.httpStatus,
        Number(page.payload.errorCode ?? 0) || null,
        JSON.stringify(page.payload),
        page.durationMs,
      );

    const upsertProduct = database.prepare(`
      INSERT INTO products
      (shop_profile_id, spu, first_listed_at, remote_image_url, goods_id, site_id, product_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_profile_id, spu) DO UPDATE SET
        first_listed_at = COALESCE(excluded.first_listed_at, products.first_listed_at),
        remote_image_url = COALESCE(products.remote_image_url, excluded.remote_image_url),
        goods_id = COALESCE(excluded.goods_id, products.goods_id),
        site_id = COALESCE(excluded.site_id, products.site_id),
        product_name = COALESCE(excluded.product_name, products.product_name),
        updated_at = CURRENT_TIMESTAMP
    `);
    const previous = database.prepare(
      "SELECT * FROM daily_metrics WHERE shop_profile_id = ? AND data_date = ? AND spu = ?",
    );
    const savePrevious = database.prepare(`
      INSERT INTO import_replaced_metrics
      (shop_profile_id, replacement_traffic_sync_batch_id, original_batch_id, data_date, spu, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const upsertMetric = database.prepare(`
      INSERT INTO daily_metrics
      (shop_profile_id, data_date, spu, traffic_sync_batch_id, source_type,
       first_listed_at, impressions, clicks, visitors, cart_users, orders,
       detail_paid_buyers, detail_payment_conversion_rate, click_order_conversion_rate,
       impression_order_conversion_rate, search_impressions, raw_item_json)
       VALUES (?, ?, ?, ?, 'temu_api', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_profile_id, data_date, spu) DO UPDATE SET
        batch_id = NULL, traffic_sync_batch_id = excluded.traffic_sync_batch_id,
        source_type = 'temu_api',
        first_listed_at = COALESCE(excluded.first_listed_at, daily_metrics.first_listed_at),
        impressions = excluded.impressions, clicks = excluded.clicks,
        visitors = excluded.visitors, cart_users = excluded.cart_users,
        orders = excluded.orders, detail_paid_buyers = excluded.detail_paid_buyers,
        detail_payment_conversion_rate = excluded.detail_payment_conversion_rate,
        click_order_conversion_rate = excluded.click_order_conversion_rate,
        impression_order_conversion_rate = excluded.impression_order_conversion_rate,
        search_impressions = excluded.search_impressions,
        raw_item_json = excluded.raw_item_json, updated_at = CURRENT_TIMESTAMP
    `);
    let imported = 0;
    let replaced = 0;
    for (const item of page.items) {
      const spu = textValue(item, [
        "spu",
        "productSpu",
        "productId",
        "goodsId",
      ]);
      if (!spu) continue;
      const dataDate = trafficDate(item);
      const firstListedAt = firstListedAtValue(item);
      const old = previous.get(shopId, dataDate, spu) as
        | Record<string, unknown>
        | undefined;
      if (old) {
        savePrevious.run(
          shopId,
          page.syncId,
          old.batch_id ?? null,
          dataDate,
          spu,
          JSON.stringify(old),
        );
        replaced += 1;
      }
      const imageUrl = textValue(item, [
        "thumbUrl",
        "imageUrl",
        "goodsImageUrl",
        "mainImageUrl",
        "productImageUrl",
      ]);
      upsertProduct.run(
        shopId,
        spu,
        firstListedAt,
        imageUrl,
        textValue(item, ["goodsId"]),
        textValue(item, ["siteId"]),
        textValue(item, ["goodsName", "productName", "title"]),
      );
      if (imageUrl) {
        queueImageTarget({
          url: imageUrl,
          targetType: "spu",
          shopId,
          targetKey: spu,
          sourceType: "traffic",
          priority: 300,
        });
      }
      upsertMetric.run(
        shopId,
        dataDate,
        spu,
        page.syncId,
        firstListedAt,
        numberValue(item, ["impressionCount", "impressions"]),
        numberValue(item, ["clickCount", "clicks"]),
        numberValue(item, [
          "goodsVisitorsUserNum",
          "visitorCount",
          "uv",
          "visitors",
        ]),
        numberValue(item, [
          "cartCrtUserNum",
          "cartUserCount",
          "addCartUserCount",
          "cartUsers",
        ]),
        numberValue(item, ["orderPayOrderNum", "orderCount", "orders"]),
        numberValue(item, [
          "fullPaymentUserNum",
          "businessDetailPaymentUserNum",
          "orderPayUserNum",
          "detailPaidBuyers",
          "payBuyerCount",
        ]),
        temuPercentageValue(item, [
          "businessDetailPaymentUserRate",
          "detailPaymentConversionRate",
        ]),
        temuPercentageValue(item, ["clickOrderRatio"]),
        temuPercentageValue(item, [
          "orderPayImpressionRate",
          "impressionOrderConversionRate",
        ]),
        numberValue(item, [
          "searchExposeNum",
          "searchImpressionCount",
          "searchImpressions",
        ]),
        JSON.stringify(item),
      );
      imported += 1;
    }
    database
      .prepare(
        `
      UPDATE traffic_sync_batches SET total_pages = ?, total_items = ?,
        imported_items = imported_items + ?, replaced_items = replaced_items + ?
      WHERE id = ? AND shop_profile_id = ?
    `,
      )
      .run(
        page.totalPages,
        page.total,
        imported,
        replaced,
        page.syncId,
        shopId,
      );
  });
  transaction();
}

export function completeTrafficSync(
  shopId: number,
  syncId: number,
): TemuTrafficSyncStatus {
  database
    .prepare(
      `
    UPDATE traffic_sync_batches SET status = 'completed', completed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND shop_profile_id = ? AND status = 'running'
  `,
    )
    .run(syncId, shopId);
  return getTrafficSync(syncId);
}

export function failTrafficSync(
  shopId: number,
  syncId: number,
  message: string,
): TemuTrafficSyncStatus {
  database
    .prepare(
      `
    UPDATE traffic_sync_batches SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
      error_message = ? WHERE id = ? AND shop_profile_id = ? AND status = 'running'
  `,
    )
    .run(message, syncId, shopId);
  return getTrafficSync(syncId);
}
