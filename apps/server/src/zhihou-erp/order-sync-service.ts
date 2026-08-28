import type {
  UserAccount,
  ZhihouOrderSyncBatch,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import {
  erpSkuImageKey,
  lifecycleSkcImageKey,
  queueImageTarget,
} from "../import/image-association-service.js";
import { getZhihouCredentials } from "./account-service.js";
import {
  runZhihouWorker,
  type ZhihouPendingOrdersResult,
  type ZhihouWorkerOrder,
  type ZhihouWorkerOrderItem,
} from "./worker-client.js";
import { findMatchedSkcImageTarget } from "./sku-match-service.js";

interface SyncRow {
  id: number;
  requested_by_user_id: number;
  requested_by_username: string;
  status: ZhihouOrderSyncBatch["status"];
  page_count: number;
  order_count: number;
  item_count: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

function mapSync(row: SyncRow): ZhihouOrderSyncBatch {
  return {
    id: row.id,
    requestedByUserId: row.requested_by_user_id,
    requestedByUsername: row.requested_by_username,
    status: row.status,
    pageCount: row.page_count,
    orderCount: row.order_count,
    itemCount: row.item_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export function getZhihouOrderSync(id: number): ZhihouOrderSyncBatch {
  const row = database
    .prepare(
      `SELECT batch.*, user.username AS requested_by_username
       FROM zhihou_order_sync_batches batch
       JOIN users user ON user.id = batch.requested_by_user_id
       WHERE batch.id = ?`,
    )
    .get(id) as SyncRow | undefined;
  if (!row) throw new Error("智猴订单同步批次不存在。");
  return mapSync(row);
}

export function latestZhihouOrderSync(): ZhihouOrderSyncBatch | null {
  const row = database
    .prepare(
      `SELECT batch.*, user.username AS requested_by_username
       FROM zhihou_order_sync_batches batch
       JOIN users user ON user.id = batch.requested_by_user_id
       ORDER BY batch.started_at DESC, batch.id DESC LIMIT 1`,
    )
    .get() as SyncRow | undefined;
  return row ? mapSync(row) : null;
}

export function latestCompletedZhihouOrderSync(): ZhihouOrderSyncBatch | null {
  const row = database
    .prepare(
      `SELECT batch.*, user.username AS requested_by_username
       FROM zhihou_order_sync_batches batch
       JOIN users user ON user.id = batch.requested_by_user_id
       WHERE batch.status = 'completed'
       ORDER BY batch.completed_at DESC, batch.id DESC LIMIT 1`,
    )
    .get() as SyncRow | undefined;
  return row ? mapSync(row) : null;
}

function createSync(userId: number): number {
  const running = database
    .prepare(
      "SELECT id FROM zhihou_order_sync_batches WHERE status = 'running' LIMIT 1",
    )
    .get();
  if (running) throw new Error("已有智猴新订单同步任务正在执行。");
  return Number(
    database
      .prepare(
        `INSERT INTO zhihou_order_sync_batches (requested_by_user_id, status)
         VALUES (?, 'running')`,
      )
      .run(userId).lastInsertRowid,
  );
}

function normalizedOrders(orders: ZhihouWorkerOrder[]): ZhihouWorkerOrder[] {
  const byOrderNo = new Map<string, ZhihouWorkerOrder>();
  for (const order of orders) {
    const orderNo = order.orderNo.trim();
    if (!orderNo) continue;
    const itemMap = new Map<string, ZhihouWorkerOrderItem>();
    for (const item of order.items) {
      const sku = item.zhihouSku.trim();
      const key = item.externalItemKey.trim();
      if (!sku || !key) continue;
      const previous = itemMap.get(key);
      itemMap.set(key, {
        ...item,
        externalItemKey: key,
        zhihouSku: sku,
        quantity: Math.max(0, Math.trunc(item.quantity)),
        ...(previous
          ? { quantity: Math.max(previous.quantity, Math.trunc(item.quantity)) }
          : {}),
      });
    }
    byOrderNo.set(orderNo, {
      ...order,
      orderNo,
      items: [...itemMap.values()],
    });
  }
  return [...byOrderNo.values()];
}

function commitSync(
  syncId: number,
  result: ZhihouPendingOrdersResult,
): ZhihouOrderSyncBatch {
  const orders = normalizedOrders(result.orders);
  const commit = database.transaction(() => {
    const insertOrder = database.prepare(
      `INSERT INTO zhihou_new_orders
        (sync_batch_id, erp_order_id, order_no, store_name, country_code, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = database.prepare(
      `INSERT INTO zhihou_new_order_items
        (sync_batch_id, order_id, external_item_key, zhihou_sku, product_name,
         color, size, quantity, specification_image_url, main_image_url,
         image_target_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let itemCount = 0;
    for (const order of orders) {
      const orderId = Number(
        insertOrder.run(
          syncId,
          order.erpOrderId,
          order.orderNo,
          order.storeName,
          order.countryCode,
          order.submittedAt,
        ).lastInsertRowid,
      );
      for (const item of order.items) {
        insertItem.run(
          syncId,
          orderId,
          item.externalItemKey,
          item.zhihouSku,
          item.productName,
          item.color,
          item.size,
          item.quantity,
          item.specificationImageUrl,
          item.mainImageUrl,
          erpSkuImageKey(item.zhihouSku, syncId),
        );
        itemCount += 1;
      }
    }
    database
      .prepare(
        `UPDATE zhihou_order_sync_batches SET
           status = 'completed', page_count = ?, order_count = ?, item_count = ?,
           completed_at = CURRENT_TIMESTAMP, error_message = NULL
         WHERE id = ? AND status = 'running'`,
      )
      .run(Math.max(0, Math.trunc(result.pageCount)), orders.length, itemCount, syncId);
  });
  commit();
  return getZhihouOrderSync(syncId);
}

function queueErpSpecificationImages(
  syncId: number,
  orders: ZhihouWorkerOrder[],
): void {
  for (const order of orders) {
    for (const item of order.items) {
      const imageUrl = item.specificationImageUrl ?? item.mainImageUrl;
      if (!imageUrl) continue;
      const target = findMatchedSkcImageTarget(item.zhihouSku);
      if (target) {
        queueImageTarget({
          url: imageUrl,
          targetType: "skc",
          shopId: target.shopId,
          targetKey: lifecycleSkcImageKey(target.skcRowId),
          sourceType: "erp",
          priority: 200,
        });
        continue;
      }
      const targetKey = erpSkuImageKey(item.zhihouSku, syncId);
      if (!targetKey) continue;
      queueImageTarget({
        url: imageUrl,
        targetType: "erp_sku",
        shopId: null,
        targetKey,
        sourceType: "erp",
        priority: 200,
      });
    }
  }
}

function failSync(syncId: number, error: unknown): void {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "智猴新订单同步失败。";
  database
    .prepare(
      `UPDATE zhihou_order_sync_batches SET
         status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(message, syncId);
}

export async function syncZhihouPendingOrders(
  user: UserAccount,
): Promise<ZhihouOrderSyncBatch> {
  const syncId = createSync(user.id);
  try {
    const credentials = getZhihouCredentials();
    const result = await runZhihouWorker<ZhihouPendingOrdersResult>({
      action: "sync_pending_orders",
      ...credentials,
    });
    const sync = commitSync(syncId, result);
    queueErpSpecificationImages(syncId, normalizedOrders(result.orders));
    return sync;
  } catch (error) {
    failSync(syncId, error);
    throw error;
  }
}
