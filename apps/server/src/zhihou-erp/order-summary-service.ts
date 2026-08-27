import type {
  ZhihouNewOrderItem,
  ZhihouOrderReference,
  ZhihouOrderReferencesResponse,
  ZhihouOrderSummaryResponse,
  ZhihouOrderSummaryRow,
  ZhihouSkuMatchStatus,
} from "@temu-analytics/shared";
import { createHash } from "node:crypto";
import { database } from "../database/index.js";
import { latestCompletedZhihouOrderSync } from "./order-sync-service.js";
import { matchZhihouSku } from "./sku-match-service.js";

interface ItemRow {
  id: number;
  sync_batch_id: number;
  order_no: string;
  zhihou_sku: string;
  product_name: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  specification_image_url: string | null;
  main_image_url: string | null;
  store_name: string | null;
  country_code: string | null;
  submitted_at: string | null;
}

interface MutableSummary {
  row: ZhihouOrderSummaryRow;
  orders: Map<string, ZhihouOrderReference>;
  skuSet: Set<string>;
  purchaseLinkSet: Set<string>;
}

function itemRows(syncBatchId: number): ItemRow[] {
  return database
    .prepare(
      `SELECT item.id, item.sync_batch_id, order_row.order_no,
              item.zhihou_sku, item.product_name, item.color, item.size,
              item.quantity, item.specification_image_url, item.main_image_url,
              order_row.store_name, order_row.country_code, order_row.submitted_at
       FROM zhihou_new_order_items item
       JOIN zhihou_new_orders order_row ON order_row.id = item.order_id
       WHERE item.sync_batch_id = ?
       ORDER BY item.id`,
    )
    .all(syncBatchId) as ItemRow[];
}

function mapItem(row: ItemRow): ZhihouNewOrderItem {
  return {
    id: row.id,
    syncBatchId: row.sync_batch_id,
    orderNo: row.order_no,
    zhihouSku: row.zhihou_sku,
    productName: row.product_name,
    color: row.color,
    size: row.size,
    quantity: row.quantity,
    specificationImageUrl: row.specification_image_url,
    mainImageUrl: row.main_image_url,
    storeName: row.store_name,
    countryCode: row.country_code,
    submittedAt: row.submitted_at,
  };
}

function normalizedGroupPart(value: string | null): string {
  return value?.trim().toUpperCase() ?? "";
}

function groupIdentity(input: {
  parentSpu: string | null;
  zhihouSku: string;
  color: string | null;
  size: string | null;
  matchStatus: ZhihouSkuMatchStatus;
}): string {
  const productIdentity = input.parentSpu
    ? `SPU:${normalizedGroupPart(input.parentSpu)}`
    : `SKU:${normalizedGroupPart(input.zhihouSku)}`;
  return [
    productIdentity,
    `COLOR:${normalizedGroupPart(input.color)}`,
    `SIZE:${normalizedGroupPart(input.size)}`,
    `STATUS:${input.matchStatus}`,
  ].join("|");
}

function summaryKey(identity: string): string {
  return createHash("sha256").update(identity).digest("base64url").slice(0, 24);
}

function buildSummaries(syncBatchId: number): Map<string, MutableSummary> {
  const summaries = new Map<string, MutableSummary>();
  for (const raw of itemRows(syncBatchId)) {
    const item = mapItem(raw);
    const match = matchZhihouSku(item.zhihouSku);
    const identity = groupIdentity({
      parentSpu: match.parentSpu,
      zhihouSku: item.zhihouSku,
      color: item.color,
      size: item.size,
      matchStatus: match.status,
    });
    const key = summaryKey(identity);
    let summary = summaries.get(key);
    if (!summary) {
      summary = {
        row: {
          key,
          parentSpu: match.parentSpu,
          zhihouSkus: [],
          color: item.color,
          size: item.size,
          requiredQuantity: 0,
          imageUrl: item.specificationImageUrl ?? item.mainImageUrl,
          purchaseLinks: [],
          matchStatus: match.status,
          matchMessage: match.message,
          orderCount: 0,
          orderNos: [],
        },
        orders: new Map(),
        skuSet: new Set(),
        purchaseLinkSet: new Set(),
      };
      summaries.set(key, summary);
    }
    summary.row.requiredQuantity += item.quantity;
    summary.row.imageUrl ??= item.specificationImageUrl ?? item.mainImageUrl;
    summary.skuSet.add(item.zhihouSku);
    for (const link of match.purchaseLinks) summary.purchaseLinkSet.add(link);
    const order = summary.orders.get(item.orderNo);
    if (order) {
      order.quantity += item.quantity;
    } else {
      summary.orders.set(item.orderNo, {
        orderNo: item.orderNo,
        quantity: item.quantity,
        storeName: item.storeName,
        countryCode: item.countryCode,
        submittedAt: item.submittedAt,
      });
    }
  }
  for (const summary of summaries.values()) {
    summary.row.zhihouSkus = [...summary.skuSet].sort();
    summary.row.purchaseLinks = [...summary.purchaseLinkSet];
    summary.row.orderNos = [...summary.orders.keys()].sort();
    summary.row.orderCount = summary.orders.size;
  }
  return summaries;
}

export function getZhihouOrderSummary(options: {
  search?: string;
  matchStatus?: ZhihouSkuMatchStatus;
} = {}): ZhihouOrderSummaryResponse {
  const latestSync = latestCompletedZhihouOrderSync();
  if (!latestSync) {
    return {
      latestSync: null,
      rows: [],
      totalRequiredQuantity: 0,
      matchedRowCount: 0,
      unmatchedRowCount: 0,
      conflictRowCount: 0,
    };
  }
  let rows = [...buildSummaries(latestSync.id).values()].map((item) => item.row);
  if (options.matchStatus)
    rows = rows.filter((row) => row.matchStatus === options.matchStatus);
  const keyword = options.search?.trim().toUpperCase();
  if (keyword) {
    rows = rows.filter((row) =>
      [
        row.parentSpu ?? "",
        row.color ?? "",
        row.size ?? "",
        ...row.zhihouSkus,
        ...row.orderNos,
      ].some((value) => value.toUpperCase().includes(keyword)),
    );
  }
  rows.sort(
    (left, right) =>
      left.matchStatus.localeCompare(right.matchStatus) ||
      (left.parentSpu ?? left.zhihouSkus[0] ?? "").localeCompare(
        right.parentSpu ?? right.zhihouSkus[0] ?? "",
      ) ||
      (left.color ?? "").localeCompare(right.color ?? "") ||
      (left.size ?? "").localeCompare(right.size ?? ""),
  );
  return {
    latestSync,
    rows,
    totalRequiredQuantity: rows.reduce(
      (total, row) => total + row.requiredQuantity,
      0,
    ),
    matchedRowCount: rows.filter((row) => row.matchStatus === "matched").length,
    unmatchedRowCount: rows.filter((row) => row.matchStatus === "unmatched").length,
    conflictRowCount: rows.filter((row) => row.matchStatus === "conflict").length,
  };
}

export function getZhihouOrderReferences(
  key: string,
): ZhihouOrderReferencesResponse {
  const latestSync = latestCompletedZhihouOrderSync();
  if (!latestSync) throw new Error("尚无成功的智猴新订单同步数据。");
  const summary = buildSummaries(latestSync.id).get(key);
  if (!summary) throw new Error("订单汇总项不存在或已被新同步替换。");
  return {
    summaryKey: key,
    orders: [...summary.orders.values()].sort((left, right) =>
      left.orderNo.localeCompare(right.orderNo),
    ),
  };
}
