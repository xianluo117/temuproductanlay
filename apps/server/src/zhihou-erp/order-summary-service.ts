import type {
  ZhihouInventoryPickOption,
  ZhihouNewOrderItem,
  ZhihouOrderMatrix,
  ZhihouOrderMatrixCell,
  ZhihouOrderReference,
  ZhihouOrderReferencesResponse,
  ZhihouOrderSummaryResponse,
  ZhihouSkuMatchStatus,
  ZhihouSkuMatchType,
} from "@temu-analytics/shared";
import { createHash } from "node:crypto";
import { database } from "../database/index.js";
import {
  y2InventoryBySku,
  zhihouInventoryPickOptions,
} from "../inventory/y2-inventory-service.js";
import { latestCompletedZhihouOrderSync } from "./order-sync-service.js";

const preferredSizeOrder = ["S", "M", "L", "XL", "XXL"];

function sizeSort(left: string, right: string): number {
  const normalizedLeft = left.trim().toUpperCase();
  const normalizedRight = right.trim().toUpperCase();
  const leftIndex = preferredSizeOrder.indexOf(normalizedLeft);
  const rightIndex = preferredSizeOrder.indexOf(normalizedRight);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return left.localeCompare(right, "zh-CN", { numeric: true });
}

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
  image_asset_id: number | null;
  store_name: string | null;
  country_code: string | null;
  submitted_at: string | null;
}

interface BindingRow {
  record_id: number;
  shop_profile_id: number;
  product_code: string;
  parent_spu: string | null;
  sku_id: string | null;
  sku_code: string | null;
}

interface LifecycleRow {
  shop_profile_id: number;
  spu: string;
  skc_row_id: number;
  skc_id: string | null;
  skc_code: string | null;
  attribute_json: string | null;
  image_url: string | null;
  image_asset_id: number | null;
  sku_id: string | null;
  sku_code: string | null;
  size_name: string | null;
  specification_json: string | null;
}

interface BatchMatch {
  status: ZhihouSkuMatchStatus;
  productManagementRecordId: number | null;
  matchType: ZhihouSkuMatchType;
  parentSpu: string | null;
  productCode: string | null;
  purchaseLinks: string[];
  message: string | null;
  lifecycle: LifecycleRow | null;
}

interface MutableSummary {
  row: ZhihouOrderMatrixCell;
  orders: Map<string, ZhihouOrderReference>;
  skuSet: Set<string>;
  productCodeSet: Set<string>;
  purchaseLinkSet: Set<string>;
  messageSet: Set<string>;
}

const unknownColor = "未知颜色";
const unknownSize = "未知尺码";

function hasTable(table: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table),
  );
}

function hasColumn(table: string, columnName: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (column) => column.name === columnName,
  );
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function displayValue(value: string | null | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function itemRows(syncBatchId: number): ItemRow[] {
  const imageAssetColumn = hasColumn("zhihou_new_order_items", "image_asset_id")
    ? "item.image_asset_id"
    : "NULL";
  return database
    .prepare(
      `SELECT item.id, item.sync_batch_id, order_row.order_no,
              item.zhihou_sku, item.product_name, item.color, item.size,
              item.quantity, item.specification_image_url, item.main_image_url,
              ${imageAssetColumn} AS image_asset_id,
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

function batchImageUrls(assetIds: Array<number | null>): Map<number, string> {
  const ids = [...new Set(assetIds.filter((id): id is number => Boolean(id)))];
  const result = new Map<number, string>();
  if (!ids.length) return result;
  const rows = database
    .prepare(
      `SELECT id, file_name FROM image_assets
       WHERE id IN (${placeholders(ids.length)})`,
    )
    .all(...ids) as Array<{ id: number; file_name: string }>;
  for (const row of rows) {
    result.set(row.id, `/api/images/${encodeURIComponent(row.file_name)}`);
  }
  return result;
}

function batchBindings(skus: string[]): BindingRow[] {
  if (!skus.length) return [];
  const values = placeholders(skus.length);
  return database
    .prepare(
      `SELECT DISTINCT record.id AS record_id, record.shop_profile_id,
              record.product_code, link.spu AS parent_spu,
              binding.sku_id, binding.sku_code
       FROM product_management_bindings binding
       JOIN product_management_spu_links link ON link.id = binding.spu_link_id
       JOIN product_management_records record ON record.id = link.record_id
       WHERE UPPER(TRIM(COALESCE(binding.sku_id, ''))) IN (${values})
          OR UPPER(TRIM(COALESCE(binding.sku_code, ''))) IN (${values})`,
    )
    .all(...skus, ...skus) as BindingRow[];
}

function batchPurchaseLinks(recordIds: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (!recordIds.length) return result;
  const rows = database
    .prepare(
      `SELECT record_id, url FROM product_management_purchase_links
       WHERE record_id IN (${placeholders(recordIds.length)})
       ORDER BY record_id, sort_order, id`,
    )
    .all(...recordIds) as Array<{ record_id: number; url: string }>;
  for (const row of rows) {
    const links = result.get(row.record_id) ?? [];
    links.push(row.url);
    result.set(row.record_id, links);
  }
  return result;
}

function batchLifecycle(rows: BindingRow[]): LifecycleRow[] {
  const identities = new Map<string, { shopId: number; spu: string }>();
  for (const row of rows) {
    if (!row.parent_spu) continue;
    identities.set(`${row.shop_profile_id}|${normalized(row.parent_spu)}`, {
      shopId: row.shop_profile_id,
      spu: row.parent_spu,
    });
  }
  if (!identities.size) return [];
  const conditions = [...identities.values()].map(
    () => "(spu_row.shop_profile_id = ? AND UPPER(TRIM(spu_row.spu)) = ?)",
  );
  const parameters = [...identities.values()].flatMap((item) => [
    item.shopId,
    normalized(item.spu),
  ]);
  const imageAssetColumn = hasColumn("temu_lifecycle_skc_current", "image_asset_id")
    ? "skc.image_asset_id"
    : "NULL";
  return database
    .prepare(
      `SELECT spu_row.shop_profile_id, spu_row.spu,
              skc.id AS skc_row_id, skc.skc_id, skc.skc_code, skc.attribute_json, skc.image_url,
              ${imageAssetColumn} AS image_asset_id,
              sku.sku_id, sku.sku_code, sku.size_name, sku.specification_json
       FROM temu_lifecycle_spu_current spu_row
       JOIN temu_lifecycle_skc_current skc ON skc.spu_row_id = spu_row.id
       LEFT JOIN temu_lifecycle_sku_current sku ON sku.skc_row_id = skc.id
       WHERE ${conditions.join(" OR ")}
       ORDER BY spu_row.id, skc.id, sku.id`,
    )
    .all(...parameters) as LifecycleRow[];
}

function attributeValue(raw: string | null, names: string[]): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const wanted = new Set(names.map(normalized));
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const value = item as Record<string, unknown>;
      const name = normalized(String(value.name ?? value.key ?? value.attrName ?? ""));
      if (!wanted.has(name)) continue;
      const candidate = value.value ?? value.attrValue ?? value.valueName;
      if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
        return String(candidate).trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function lifecycleCandidates(
  binding: BindingRow,
  rows: LifecycleRow[],
  matchType: Exclude<ZhihouSkuMatchType, "none">,
  zhihouSku: string,
): LifecycleRow[] {
  return rows.filter(
    (row) =>
      row.shop_profile_id === binding.shop_profile_id &&
      normalized(row.spu) === normalized(binding.parent_spu) &&
      normalized(matchType === "sku_id" ? row.sku_id : row.sku_code) === zhihouSku,
  );
}

function buildMatchMap(items: ItemRow[]): Map<string, BatchMatch> {
  const skuValues = [...new Set(items.map((item) => normalized(item.zhihou_sku)).filter(Boolean))];
  const bindings = batchBindings(skuValues);
  const links = batchPurchaseLinks([...new Set(bindings.map((row) => row.record_id))]);
  const lifecycleRows = batchLifecycle(bindings);
  const result = new Map<string, BatchMatch>();

  for (const sku of skuValues) {
    const idMatches = bindings.filter((row) => normalized(row.sku_id) === sku);
    const codeMatches = bindings.filter((row) => normalized(row.sku_code) === sku);
    const matchType: ZhihouSkuMatchType = idMatches.length ? "sku_id" : codeMatches.length ? "sku_code" : "none";
    const candidates = matchType === "sku_id" ? idMatches : matchType === "sku_code" ? codeMatches : [];
    const uniqueRecords = new Map(candidates.map((row) => [row.record_id, row]));
    if (!uniqueRecords.size) {
      result.set(sku, {
        status: "unmatched",
        productManagementRecordId: null,
        matchType: "none",
        parentSpu: null,
        productCode: null,
        purchaseLinks: [],
        message: "未在产品管理的 SKU ID 或 SKU 编码中找到匹配项。",
        lifecycle: null,
      });
      continue;
    }
    if (uniqueRecords.size > 1) {
      result.set(sku, {
        status: "conflict",
        productManagementRecordId: null,
        matchType,
        parentSpu: null,
        productCode: null,
        purchaseLinks: [],
        message: `SKU 在产品管理中匹配到 ${uniqueRecords.size} 条记录，请清理重复绑定。`,
        lifecycle: null,
      });
      continue;
    }
    const binding = [...uniqueRecords.values()][0]!;
    const lifecycleMatches = lifecycleCandidates(
      binding,
      lifecycleRows,
      matchType as Exclude<ZhihouSkuMatchType, "none">,
      sku,
    );
    const lifecycleIdentities = new Map(
      lifecycleMatches.map((row) => [
        [row.skc_id, row.skc_code, row.sku_id, row.sku_code].map(normalized).join("|"),
        row,
      ]),
    );
    if (lifecycleIdentities.size > 1) {
      result.set(sku, {
        status: "conflict",
        productManagementRecordId: binding.record_id,
        matchType,
        parentSpu: binding.parent_spu,
        productCode: binding.product_code,
        purchaseLinks: links.get(binding.record_id) ?? [],
        message: `SKU 对应 ${lifecycleIdentities.size} 个生命周期规格，请检查 SKC/SKU 绑定。`,
        lifecycle: null,
      });
      continue;
    }
    result.set(sku, {
      status: "matched",
      productManagementRecordId: binding.record_id,
      matchType,
      parentSpu: binding.parent_spu,
      productCode: binding.product_code,
      purchaseLinks: links.get(binding.record_id) ?? [],
      message: binding.parent_spu
        ? lifecycleIdentities.size
          ? null
          : "已匹配产品主档，但未找到对应的生命周期 SKU 规格，颜色和尺码使用订单信息。"
        : "SKU 已匹配产品主档，但未配置上级 SPU。",
      lifecycle: [...lifecycleIdentities.values()][0] ?? null,
    });
  }
  return result;
}

function leafIdentity(input: {
  parentSpu: string | null;
  zhihouSku: string;
  color: string;
  size: string;
  matchStatus: ZhihouSkuMatchStatus;
}): string {
  const productIdentity = input.parentSpu
    ? `SPU:${normalized(input.parentSpu)}`
    : `SKU:${normalized(input.zhihouSku)}`;
  return [
    productIdentity,
    `COLOR:${normalized(input.color)}`,
    `SIZE:${normalized(input.size)}`,
    `STATUS:${input.matchStatus}`,
  ].join("|");
}

function summaryKey(identity: string): string {
  return createHash("sha256").update(identity).digest("base64url").slice(0, 24);
}

function preferredImages(
  lifecycle: LifecycleRow | null,
  item: ZhihouNewOrderItem,
  itemAssetId: number | null,
  imageUrls: Map<number, string>,
): string[] {
  return [...new Set([
    imageUrls.get(lifecycle?.image_asset_id ?? 0),
    lifecycle?.image_url,
    imageUrls.get(itemAssetId ?? 0),
    item.specificationImageUrl,
    item.mainImageUrl,
  ].map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function matchLifecycleSkuId(
  zhihouSkus: string[],
  matches: Map<string, BatchMatch>,
): string | null {
  return zhihouSkus
    .map((sku) => matches.get(normalized(sku))?.lifecycle?.sku_id ?? null)
    .find((value): value is string => Boolean(value)) ?? null;
}

function matchLifecycleSkuCode(
  zhihouSkus: string[],
  matches: Map<string, BatchMatch>,
): string | null {
  return zhihouSkus
    .map((sku) => matches.get(normalized(sku))?.lifecycle?.sku_code ?? null)
    .find((value): value is string => Boolean(value)) ?? null;
}

function buildLeafSummaries(
  syncBatchId: number,
  storeName?: string,
): Map<string, MutableSummary> {
  const allItems = itemRows(syncBatchId);
  const selectedStoreName = storeName?.trim() ?? "";
  const rawItems = selectedStoreName
    ? allItems.filter((item) => (item.store_name?.trim() ?? "") === selectedStoreName)
    : allItems;
  const matches = buildMatchMap(rawItems);
  const imageUrls = batchImageUrls([
    ...rawItems.map((item) => item.image_asset_id),
    ...[...matches.values()].map((match) => match.lifecycle?.image_asset_id ?? null),
  ]);
  const summaries = new Map<string, MutableSummary>();
  for (const raw of rawItems) {
    const item = mapItem(raw);
    const match = matches.get(normalized(item.zhihouSku))!;
    const lifecycleColor = attributeValue(match.lifecycle?.attribute_json ?? null, [
      "颜色",
      "COLOR",
      "COLOUR",
    ]);
    const lifecycleSize = match.lifecycle?.size_name
      ?? attributeValue(match.lifecycle?.specification_json ?? null, ["尺码", "尺寸", "SIZE"]);
    const color = displayValue(lifecycleColor ?? item.color, unknownColor);
    const size = displayValue(lifecycleSize ?? item.size, unknownSize);
    const identity = leafIdentity({
      parentSpu: match.parentSpu,
      zhihouSku: item.zhihouSku,
      color,
      size,
      matchStatus: match.status,
    });
    const key = summaryKey(identity);
    let summary = summaries.get(key);
    const itemImageUrls = preferredImages(match.lifecycle, item, raw.image_asset_id, imageUrls);
    if (!summary) {
      summary = {
        row: {
          key,
          productManagementRecordId: match.productManagementRecordId,
          parentSpu: match.parentSpu,
          zhihouSkus: [],
          productCodes: [],
          color,
          size,
          requiredQuantity: 0,
          y2InventoryQuantity: null,
          inventoryPickableQuantity: 0,
          pickedQuantity: 0,
          remainingPurchaseQuantity: 0,
          inventoryDifference: null,
          suggestedPurchaseQuantity: null,
          inventoryPickOptions: [],
          inventoryMatchStatus: null,
          inventoryMatchMessage: null,
          imageUrl: itemImageUrls[0] ?? null,
          imageUrls: itemImageUrls,
          purchaseLinks: [],
          matchStatus: match.status,
          matchMessage: match.message,
          orderCount: 0,
          orderNos: [],
        },
        orders: new Map(),
        skuSet: new Set(),
        productCodeSet: new Set(),
        purchaseLinkSet: new Set(),
        messageSet: new Set(match.message ? [match.message] : []),
      };
      summaries.set(key, summary);
    }
    const currentSummary = summary;
    currentSummary.row.requiredQuantity += item.quantity;
    currentSummary.row.imageUrls = [...new Set([...currentSummary.row.imageUrls, ...itemImageUrls])];
    currentSummary.row.imageUrl = currentSummary.row.imageUrls[0] ?? null;
    currentSummary.skuSet.add(item.zhihouSku);
    if (match.productCode) currentSummary.productCodeSet.add(match.productCode);
    match.purchaseLinks.forEach((link) => currentSummary.purchaseLinkSet.add(link));
    if (match.message) currentSummary.messageSet.add(match.message);
    const order = currentSummary.orders.get(item.orderNo);
    if (order) order.quantity += item.quantity;
    else {
      currentSummary.orders.set(item.orderNo, {
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
    summary.row.productCodes = [...summary.productCodeSet].sort();
    summary.row.purchaseLinks = [...summary.purchaseLinkSet];
    summary.row.matchMessage = [...summary.messageSet].join("；") || null;
    summary.row.orderNos = [...summary.orders.keys()].sort();
    summary.row.orderCount = summary.orders.size;
    const inventory = y2InventoryBySku(
      matchLifecycleSkuId(summary.row.zhihouSkus, matches),
      matchLifecycleSkuCode(summary.row.zhihouSkus, matches),
    );
    const targetLifecycle = summary.row.zhihouSkus
      .map((sku) => matches.get(normalized(sku))?.lifecycle ?? null)
      .find((value): value is LifecycleRow => Boolean(value)) ?? null;
    const pickOptions = zhihouInventoryPickOptions({
      productManagementRecordId: summary.row.productManagementRecordId,
      productCodes: summary.row.productCodes,
      targetSpu: summary.row.parentSpu,
      targetSkcRowId: targetLifecycle?.skc_row_id ?? null,
      targetColor: summary.row.color,
      targetSize: summary.row.size,
      targetKey: summary.row.key,
    });
    const exactOptions = pickOptions.filter((option) => option.isExact);
    const exactQuantity = exactOptions.reduce((total, option) => total + option.quantity, 0);
    const picked = hasTable("zhihou_stock_pick_items")
      ? (() => {
          const activeOrderCondition = hasColumn("zhihou_stock_order_snapshots", "is_active")
            ? " AND order_row.is_active = 1"
            : "";
          return database.prepare(
            `SELECT
               COALESCE((
                 SELECT SUM(pick.picked_quantity - pick.matched_quantity)
                 FROM zhihou_stock_pick_items pick
                 WHERE pick.target_key = ?
               ), 0)
               + COALESCE((
                 SELECT SUM(allocation.quantity)
                 FROM zhihou_stock_pick_allocations allocation
                 JOIN zhihou_stock_order_item_snapshots item
                   ON item.id = allocation.order_item_snapshot_id
                 JOIN zhihou_stock_order_snapshots order_row
                   ON order_row.id = item.order_snapshot_id
                 WHERE item.target_key = ?${activeOrderCondition}
               ), 0) AS quantity`,
          ).get(summary.row.key, summary.row.key) as { quantity: number };
        })()
      : { quantity: 0 };
    summary.row.inventoryPickOptions = pickOptions;
    summary.row.inventoryPickableQuantity = Math.min(
      Math.max(summary.row.requiredQuantity - picked.quantity, 0),
      exactQuantity,
    );
    summary.row.pickedQuantity = picked.quantity;
    summary.row.remainingPurchaseQuantity = Math.max(
      summary.row.requiredQuantity - picked.quantity,
      0,
    );
    summary.row.y2InventoryQuantity = inventory?.quantity ?? (exactOptions.length ? exactQuantity : null);
    summary.row.inventoryDifference = summary.row.y2InventoryQuantity === null
      ? null
      : summary.row.y2InventoryQuantity - summary.row.requiredQuantity;
    summary.row.suggestedPurchaseQuantity = null;
    summary.row.inventoryMatchStatus = inventory?.status ?? (exactOptions.length ? "matched" : null);
    summary.row.inventoryMatchMessage = inventory?.message ?? (pickOptions.length ? null : "没有可用的Y2库存规格。");
  }
  return summaries;
}

function aggregateStatus(rows: ZhihouOrderMatrixCell[]): ZhihouSkuMatchStatus {
  if (rows.some((row) => row.matchStatus === "conflict")) return "conflict";
  if (rows.some((row) => row.matchStatus === "unmatched")) return "unmatched";
  return "matched";
}

function buildMatrices(cells: ZhihouOrderMatrixCell[]): ZhihouOrderMatrix[] {
  const spuGroups = new Map<string, ZhihouOrderMatrixCell[]>();
  for (const cell of cells) {
    const identity = cell.parentSpu
      ? `SPU:${normalized(cell.parentSpu)}`
      : `UNMATCHED:${normalized(cell.zhihouSkus[0])}`;
    const values = spuGroups.get(identity) ?? [];
    values.push(cell);
    spuGroups.set(identity, values);
  }
  return [...spuGroups.entries()]
    .map(([identity, spuCells]) => {
      const sizes = [...new Set(spuCells.map((cell) => cell.size))].sort(sizeSort);
      const colorGroups = new Map<string, ZhihouOrderMatrixCell[]>();
      for (const cell of spuCells) {
        const values = colorGroups.get(normalized(cell.color)) ?? [];
        values.push(cell);
        colorGroups.set(normalized(cell.color), values);
      }
      const colorRows = [...colorGroups.values()]
        .map((colorCells) => {
          const imageUrls = [...new Set(colorCells.flatMap((cell) => cell.imageUrls))];
          return {
          key: `color-${summaryKey(`${identity}|${normalized(colorCells[0]?.color)}`)}`,
          color: colorCells[0]?.color ?? unknownColor,
          imageUrl: imageUrls[0] ?? null,
          imageUrls,
          requiredQuantity: colorCells.reduce((total, cell) => total + cell.requiredQuantity, 0),
          y2InventoryQuantity: colorCells.reduce((total, cell) => total + (cell.y2InventoryQuantity ?? 0), 0),
          suggestedPurchaseQuantity: colorCells.reduce((total, cell) => total + cell.remainingPurchaseQuantity, 0),
          cells: Object.fromEntries(colorCells.map((cell) => [cell.size, cell])),
          };
        })
        .sort((left, right) => left.color.localeCompare(right.color, "zh-CN"));
      return {
        key: `matrix-${summaryKey(identity)}`,
        productManagementRecordId: spuCells[0]?.productManagementRecordId ?? null,
        parentSpu: spuCells[0]?.parentSpu ?? null,
        fallbackSku: spuCells[0]?.parentSpu ? null : spuCells[0]?.zhihouSkus[0] ?? null,
        productCodes: [...new Set(spuCells.flatMap((cell) => cell.productCodes))].sort(),
        purchaseLinks: [...new Set(spuCells.flatMap((cell) => cell.purchaseLinks))],
        sizes,
        colorRows,
        requiredQuantity: spuCells.reduce((total, cell) => total + cell.requiredQuantity, 0),
        y2InventoryQuantity: spuCells.reduce((total, cell) => total + (cell.y2InventoryQuantity ?? 0), 0),
        inventoryPickableQuantity: spuCells.reduce((total, cell) => total + cell.inventoryPickableQuantity, 0),
        pickedQuantity: spuCells.reduce((total, cell) => total + cell.pickedQuantity, 0),
        remainingPurchaseQuantity: spuCells.reduce((total, cell) => total + cell.remainingPurchaseQuantity, 0),
        suggestedPurchaseQuantity: spuCells.reduce((total, cell) => total + cell.remainingPurchaseQuantity, 0),
        matchStatus: aggregateStatus(spuCells),
      } satisfies ZhihouOrderMatrix;
    })
    .sort((left, right) => {
      const leftProductCode = left.productCodes[0];
      const rightProductCode = right.productCodes[0];
      if (leftProductCode && !rightProductCode) return -1;
      if (!leftProductCode && rightProductCode) return 1;
      const productCodeComparison = (leftProductCode ?? "").localeCompare(
        rightProductCode ?? "",
        "zh-CN",
        { numeric: true },
      );
      if (productCodeComparison !== 0) return productCodeComparison;
      return (left.parentSpu ?? left.fallbackSku ?? "").localeCompare(
        right.parentSpu ?? right.fallbackSku ?? "",
        "zh-CN",
        { numeric: true },
      );
    });
}

function matchesSearch(row: ZhihouOrderMatrixCell, keyword: string): boolean {
  return [
    row.parentSpu ?? "",
    ...row.productCodes,
    row.color ?? "",
    row.size ?? "",
    ...row.zhihouSkus,
    ...row.orderNos,
  ].some((value) => normalized(value).includes(keyword));
}

export function getZhihouOrderSummary(options: {
  search?: string;
  matchStatus?: ZhihouSkuMatchStatus;
  storeName?: string;
} = {}): ZhihouOrderSummaryResponse {
  const latestSync = latestCompletedZhihouOrderSync();
  if (!latestSync) {
    return {
      latestSync: null,
      storeNames: [],
      matrices: [],
      totalRequiredQuantity: 0,
      totalY2InventoryQuantity: 0,
      totalSuggestedPurchaseQuantity: 0,
      matchedRowCount: 0,
      unmatchedRowCount: 0,
      conflictRowCount: 0,
    };
  }
  const storeNames = [...new Set(itemRows(latestSync.id)
    .map((item) => item.store_name?.trim() ?? "")
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
  const summaries = buildLeafSummaries(latestSync.id, options.storeName);
  let leaves = [...summaries.values()].map((item) => item.row);
  if (options.matchStatus) leaves = leaves.filter((row) => row.matchStatus === options.matchStatus);
  const keyword = normalized(options.search);
  if (keyword) leaves = leaves.filter((row) => matchesSearch(row, keyword));
  return {
    latestSync,
    storeNames,
    matrices: buildMatrices(leaves),
    totalRequiredQuantity: leaves.reduce((total, row) => total + row.requiredQuantity, 0),
    totalY2InventoryQuantity: leaves.reduce((total, row) => total + row.inventoryPickableQuantity, 0),
    totalSuggestedPurchaseQuantity: 0,
    matchedRowCount: leaves.filter((row) => row.matchStatus === "matched").length,
    unmatchedRowCount: leaves.filter((row) => row.matchStatus === "unmatched").length,
    conflictRowCount: leaves.filter((row) => row.matchStatus === "conflict").length,
  };
}

export function getZhihouOrderReferences(
  key: string,
  storeName?: string,
): ZhihouOrderReferencesResponse {
  const latestSync = latestCompletedZhihouOrderSync();
  if (!latestSync) throw new Error("尚无成功的智猴新订单同步数据。");
  const summary = buildLeafSummaries(latestSync.id, storeName).get(key);
  if (!summary) throw new Error("订单汇总项不存在或已被新同步替换。");
  return {
    summaryKey: key,
    orders: [...summary.orders.values()].sort((left, right) =>
      left.orderNo.localeCompare(right.orderNo),
    ),
  };
}
