import type { TemuTrafficSyncStatus } from "@temu-analytics/shared";
import { createShopBackup } from "../backup/user-backup-service.js";
import { database } from "../database/index.js";

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

function numberValue(item: Record<string, unknown>, keys: string[]): number {
  const text = textValue(item, keys)?.replace(/,/g, "").replace(/%$/, "");
  if (!text) return 0;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function rateValue(
  item: Record<string, unknown>,
  keys: string[],
): number | null {
  const raw = textValue(item, keys);
  if (!raw) return null;
  const value = Number(raw.replace("%", ""));
  if (!Number.isFinite(value) || value < 0) return null;
  return raw.includes("%") || value > 1 ? value / 100 : value;
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
        remote_image_url = COALESCE(excluded.remote_image_url, products.remote_image_url),
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
       detail_paid_buyers, detail_payment_conversion_rate,
       impression_order_conversion_rate, search_impressions, raw_item_json)
      VALUES (?, ?, ?, ?, 'temu_api', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(shop_profile_id, data_date, spu) DO UPDATE SET
        batch_id = NULL, traffic_sync_batch_id = excluded.traffic_sync_batch_id,
        source_type = 'temu_api', first_listed_at = excluded.first_listed_at,
        impressions = excluded.impressions, clicks = excluded.clicks,
        visitors = excluded.visitors, cart_users = excluded.cart_users,
        orders = excluded.orders, detail_paid_buyers = excluded.detail_paid_buyers,
        detail_payment_conversion_rate = excluded.detail_payment_conversion_rate,
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
      const firstListedAt = textValue(item, [
        "firstSiteTime",
        "firstListedAt",
        "joinSiteTime",
      ]);
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
      upsertProduct.run(
        shopId,
        spu,
        firstListedAt,
        textValue(item, ["thumbUrl", "imageUrl", "goodsImageUrl"]),
        textValue(item, ["goodsId"]),
        textValue(item, ["siteId"]),
        textValue(item, ["goodsName", "productName", "title"]),
      );
      upsertMetric.run(
        shopId,
        dataDate,
        spu,
        page.syncId,
        firstListedAt,
        numberValue(item, ["impressionCount", "impressions"]),
        numberValue(item, ["clickCount", "clicks"]),
        numberValue(item, ["visitorCount", "uv", "visitors"]),
        numberValue(item, ["cartUserCount", "addCartUserCount", "cartUsers"]),
        numberValue(item, ["orderPayOrderNum", "orderCount", "orders"]),
        numberValue(item, [
          "orderPayUserNum",
          "detailPaidBuyers",
          "payBuyerCount",
        ]),
        rateValue(item, ["clickOrderRatio", "detailPaymentConversionRate"]),
        rateValue(item, [
          "orderPayImpressionRate",
          "impressionOrderConversionRate",
        ]),
        numberValue(item, ["searchImpressionCount", "searchImpressions"]),
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
