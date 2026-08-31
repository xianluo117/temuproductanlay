import {
  PRODUCT_MANAGEMENT_COLUMN_KEYS,
  PRODUCT_MANAGEMENT_PAGE_SIZES,
  type ProductManagementBinding,
  type ProductManagementColumnKey,
  type ProductManagementColumnPreferences,
  type ProductManagementImageStatus,
  type ProductManagementListResponse,
  type ProductManagementPageSize,
  type ProductManagementRecord,
  type ProductManagementRecordInput,
  type ProductManagementSettings,
  type ProductManagementSpuLink,
  type UserAccount,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { lifecycleMatchesForProducts } from "../temu-shops/lifecycle-match-service.js";
import { y2InventorySummariesForRecords } from "../inventory/y2-inventory-service.js";
import {
  lifecycleCodeSqlExpression,
  lifecycleProductCodeKey,
  normalizeProductCode,
  normalizedSearchKeywords,
  splitSearchKeywords,
  type ProductManagementSearch,
} from "./product-code.js";
import {
  calculatePricing,
  parseProductCode,
} from "./product-management-calculator.js";

interface RecordRow {
  id: number;
  shop_profile_id: number;
  created_by_user_id: number;
  created_by_username: string;
  product_code: string;
  internal_product_id: string | null;
  serial_number: string | null;
  note: string | null;
  weight_kg: number;
  goods_value: number | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

interface SpuRow {
  id: number;
  record_id: number;
  spu: string | null;
  note: string | null;
  initial_review_price: number | null;
  review_price: number | null;
  activity_discount_override: number | null;
  roas: number | null;
  order_count: number | null;
  created_at: string;
  updated_at: string;
}

interface BindingRow {
  id: number;
  spu_link_id: number;
  skc_id: string | null;
  sku_id: string | null;
  skc_code: string | null;
  sku_code: string | null;
}

const settingsKey = "product_management_pricing";
const columnPreferencesKey = "product_management_columns";
const pageSizePreferenceKey = "product_management_page_size";

export const defaultProductManagementColumns: ProductManagementColumnKey[] = [
  ...PRODUCT_MANAGEMENT_COLUMN_KEYS,
];

function normalizeColumnPreferences(
  value: unknown,
): ProductManagementColumnPreferences {
  const visibleColumns = Array.isArray(value)
    ? value.filter(
        (item): item is ProductManagementColumnKey =>
          typeof item === "string" &&
          (PRODUCT_MANAGEMENT_COLUMN_KEYS as readonly string[]).includes(item),
      )
    : [];
  return {
    visibleColumns: [...new Set(visibleColumns)],
  };
}

export function getProductManagementColumnPreferences(
  userId: number,
): ProductManagementColumnPreferences {
  const row = database
    .prepare("SELECT value_json FROM user_settings WHERE owner_id = ? AND key = ?")
    .get(userId, columnPreferencesKey) as { value_json: string } | undefined;
  if (!row) return { visibleColumns: [...defaultProductManagementColumns] };
  try {
    const parsed = JSON.parse(row.value_json) as { visibleColumns?: unknown };
    return normalizeColumnPreferences(parsed.visibleColumns);
  } catch {
    return { visibleColumns: [...defaultProductManagementColumns] };
  }
}

export function updateProductManagementColumnPreferences(
  userId: number,
  input: ProductManagementColumnPreferences,
): ProductManagementColumnPreferences {
  const preferences = normalizeColumnPreferences(input.visibleColumns);
  database
    .prepare(
      `INSERT INTO user_settings (owner_id, key, value_json, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(owner_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(userId, columnPreferencesKey, JSON.stringify(preferences));
  return preferences;
}

export function getProductManagementPageSize(userId: number): ProductManagementPageSize {
  const row = database
    .prepare("SELECT value_json FROM user_settings WHERE owner_id = ? AND key = ?")
    .get(userId, pageSizePreferenceKey) as { value_json: string } | undefined;
  if (row) {
    try {
      const value = Number(JSON.parse(row.value_json));
      if ((PRODUCT_MANAGEMENT_PAGE_SIZES as readonly number[]).includes(value)) {
        return value as ProductManagementPageSize;
      }
    } catch {
      // Invalid historical preference falls back to the default.
    }
  }
  return 20;
}

export function updateProductManagementPageSize(
  userId: number,
  pageSize: ProductManagementPageSize,
): ProductManagementPageSize {
  database
    .prepare(
      `INSERT INTO user_settings (owner_id, key, value_json, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(owner_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(userId, pageSizePreferenceKey, JSON.stringify(pageSize));
  return pageSize;
}

function normalizedText(value: string | null | undefined): string | null {
  const result = value?.trim() ?? "";
  return result || null;
}

export function getProductManagementSettings(): ProductManagementSettings {
  const row = database
    .prepare("SELECT value_json, updated_at FROM system_settings WHERE key = ?")
    .get(settingsKey) as { value_json: string; updated_at: string } | undefined;
  const parsed = row
    ? (JSON.parse(row.value_json) as Partial<ProductManagementSettings>)
    : {};
  const shippingCostPerKg = Number(parsed.shippingCostPerKg ?? 60);
  const recommendedProfitMargin = Number(
    parsed.recommendedProfitMargin ?? 0.55,
  );
  const profitThresholdRate = Number(parsed.profitThresholdRate ?? 0.45);
  return {
    shippingCostPerKg:
      Number.isFinite(shippingCostPerKg) && shippingCostPerKg >= 0
        ? shippingCostPerKg
        : 60,
    recommendedProfitMargin:
      Number.isFinite(recommendedProfitMargin) &&
      recommendedProfitMargin >= 0 &&
      recommendedProfitMargin < 1
        ? recommendedProfitMargin
        : 0.55,
    profitThresholdRate:
      Number.isFinite(profitThresholdRate) &&
      profitThresholdRate >= 0 &&
      profitThresholdRate < 1
        ? profitThresholdRate
        : 0.45,
    updatedAt: row?.updated_at ?? null,
  };
}

export function updateProductManagementSettings(input: {
  shippingCostPerKg: number;
  recommendedProfitMargin: number;
  profitThresholdRate: number;
}): ProductManagementSettings {
  database
    .prepare(
      `INSERT INTO system_settings (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(settingsKey, JSON.stringify(input));
  return getProductManagementSettings();
}

interface ProductImageRow {
  spu: string;
  remote_image_url: string | null;
  file_name: string | null;
  task_status: "pending" | "processing" | "completed" | "failed" | null;
  task_error: string | null;
}

interface ProductImageInfo {
  localImageUrl: string | null;
  remoteImageUrl: string | null;
  displayImageUrl: string | null;
  imageStatus: ProductManagementImageStatus;
  imageError: string | null;
}

interface ProductManagementBatchData {
  purchaseLinksByRecord: Map<number, string[]>;
  spuRowsByRecord: Map<number, SpuRow[]>;
  bindingsBySpuLink: Map<number, ProductManagementBinding[]>;
  trafficLimitBySpu: Map<string, number>;
  imageBySpu: Map<string, ProductImageInfo>;
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function imageInfo(row: ProductImageRow): ProductImageInfo {
  const localImageUrl = row.file_name
    ? `/api/images/${encodeURIComponent(row.file_name)}`
    : null;
  const remoteImageUrl = normalizedText(row.remote_image_url);
  let imageStatus: ProductManagementImageStatus = "missing";
  if (localImageUrl) imageStatus = "ready";
  else if (row.task_status === "pending") imageStatus = "pending";
  else if (row.task_status === "processing") imageStatus = "processing";
  else if (row.task_status === "failed") imageStatus = "failed";
  else if (remoteImageUrl) imageStatus = "remote_only";
  return {
    localImageUrl,
    remoteImageUrl,
    displayImageUrl: localImageUrl ?? remoteImageUrl,
    imageStatus,
    imageError: row.task_error,
  };
}

function loadBatchData(shopId: number, recordIds: number[]): ProductManagementBatchData {
  const empty: ProductManagementBatchData = {
    purchaseLinksByRecord: new Map(),
    spuRowsByRecord: new Map(),
    bindingsBySpuLink: new Map(),
    trafficLimitBySpu: new Map(),
    imageBySpu: new Map(),
  };
  if (!recordIds.length) return empty;

  const recordPlaceholders = placeholders(recordIds);
  const purchaseRows = database
    .prepare(
      `SELECT record_id, url FROM product_management_purchase_links
       WHERE record_id IN (${recordPlaceholders}) ORDER BY record_id, sort_order, id`,
    )
    .all(...recordIds) as Array<{ record_id: number; url: string }>;
  for (const row of purchaseRows) {
    const values = empty.purchaseLinksByRecord.get(row.record_id) ?? [];
    values.push(row.url);
    empty.purchaseLinksByRecord.set(row.record_id, values);
  }

  const spuRows = database
    .prepare(
      `SELECT id, record_id, spu, note, initial_review_price, review_price,
              activity_discount_override, roas, order_count, created_at, updated_at
       FROM product_management_spu_links
       WHERE record_id IN (${recordPlaceholders}) ORDER BY record_id, id`,
    )
    .all(...recordIds) as SpuRow[];
  for (const row of spuRows) {
    const values = empty.spuRowsByRecord.get(row.record_id) ?? [];
    values.push(row);
    empty.spuRowsByRecord.set(row.record_id, values);
  }

  const spuLinkIds = spuRows.map((row) => row.id);
  if (spuLinkIds.length) {
    const bindingRows = database
      .prepare(
        `SELECT id, spu_link_id, skc_id, sku_id, skc_code, sku_code
         FROM product_management_bindings
         WHERE spu_link_id IN (${placeholders(spuLinkIds)}) ORDER BY spu_link_id, id`,
      )
      .all(...spuLinkIds) as BindingRow[];
    for (const row of bindingRows) {
      const values = empty.bindingsBySpuLink.get(row.spu_link_id) ?? [];
      values.push({
        id: row.id,
        skcId: row.skc_id,
        skuId: row.sku_id,
        skcCode: row.skc_code,
        skuCode: row.sku_code,
      });
      empty.bindingsBySpuLink.set(row.spu_link_id, values);
    }
  }

  const spus = [...new Set(spuRows.map((row) => row.spu).filter((value): value is string => Boolean(value)))];
  if (spus.length) {
    const spuPlaceholders = placeholders(spus);
    const limitRows = database
      .prepare(
        `SELECT spu, MIN(price) AS minimum_limit_price
         FROM (
           SELECT spu_row.spu AS spu, skc.traffic_limit_price AS price
           FROM temu_lifecycle_skc_current skc
           JOIN temu_lifecycle_spu_current spu_row ON spu_row.id = skc.spu_row_id
           WHERE spu_row.shop_profile_id = ? AND spu_row.spu IN (${spuPlaceholders})
             AND skc.traffic_limit_price IS NOT NULL
           UNION ALL
           SELECT spu_row.spu AS spu, sku.suggested_price AS price
           FROM temu_lifecycle_sku_current sku
           JOIN temu_lifecycle_skc_current skc ON skc.id = sku.skc_row_id
           JOIN temu_lifecycle_spu_current spu_row ON spu_row.id = skc.spu_row_id
           WHERE spu_row.shop_profile_id = ? AND spu_row.spu IN (${spuPlaceholders})
             AND sku.suggested_price IS NOT NULL
         ) candidates GROUP BY spu`,
      )
      .all(shopId, ...spus, shopId, ...spus) as Array<{
        spu: string;
        minimum_limit_price: number;
      }>;
    limitRows.forEach((row) => empty.trafficLimitBySpu.set(row.spu, row.minimum_limit_price));

    const images = database
      .prepare(
        `SELECT p.spu, p.remote_image_url, asset.file_name,
                COALESCE(global_task.status, legacy_task.status) AS task_status,
                COALESCE(global_task.last_error, legacy_task.last_error) AS task_error
         FROM products p
         LEFT JOIN image_assets asset ON asset.id = p.image_asset_id
         LEFT JOIN image_download_targets target
           ON target.target_type = 'spu' AND target.shop_profile_id = p.shop_profile_id
          AND target.target_key = p.spu
         LEFT JOIN image_download_tasks global_task ON global_task.id = target.task_id
         LEFT JOIN remote_image_tasks legacy_task ON legacy_task.id = (
           SELECT latest.id FROM remote_image_tasks latest
           WHERE latest.shop_profile_id = p.shop_profile_id AND latest.spu = p.spu
           ORDER BY latest.id DESC LIMIT 1
         )
         WHERE p.shop_profile_id = ? AND p.spu IN (${spuPlaceholders})`,
      )
      .all(shopId, ...spus) as ProductImageRow[];
    images.forEach((row) => empty.imageBySpu.set(row.spu, imageInfo(row)));
  }
  return empty;
}

function spuLinksFor(
  row: RecordRow,
  settings: ProductManagementSettings,
  batch: ProductManagementBatchData,
): ProductManagementSpuLink[] {
  return (batch.spuRowsByRecord.get(row.id) ?? []).map((spuRow) => {
    const pricing = calculatePricing({
      goodsValue: row.goods_value,
      weightKg: row.weight_kg,
      shippingCostPerKg: settings.shippingCostPerKg,
      recommendedProfitMargin: settings.recommendedProfitMargin,
      profitThresholdRate: settings.profitThresholdRate,
      reviewPrice: spuRow.review_price,
      initialReviewPrice: spuRow.initial_review_price,
      activityDiscountOverride: spuRow.activity_discount_override,
    });
    const trafficLimitPrice = spuRow.spu
      ? batch.trafficLimitBySpu.get(spuRow.spu) ?? null
      : null;
    const trafficPricing = calculatePricing({
      goodsValue: row.goods_value,
      weightKg: row.weight_kg,
      shippingCostPerKg: settings.shippingCostPerKg,
      recommendedProfitMargin: settings.recommendedProfitMargin,
      profitThresholdRate: settings.profitThresholdRate,
      reviewPrice: trafficLimitPrice,
      initialReviewPrice: null,
      activityDiscountOverride: spuRow.activity_discount_override,
    });
    const image = spuRow.spu ? batch.imageBySpu.get(spuRow.spu) : undefined;
    return {
      id: spuRow.id,
      spu: spuRow.spu,
      note: spuRow.note,
      localImageUrl: image?.localImageUrl ?? null,
      remoteImageUrl: image?.remoteImageUrl ?? null,
      displayImageUrl: image?.displayImageUrl ?? null,
      imageStatus: image?.imageStatus ?? "missing",
      imageError: image?.imageError ?? null,
      initialReviewPrice: spuRow.initial_review_price,
      reviewPrice: spuRow.review_price,
      reviewProfitMargin: pricing.reviewProfitMargin,
      suggestedActivityDiscount: pricing.suggestedActivityDiscount,
      activityDiscountOverride: spuRow.activity_discount_override,
      finalActivityDiscount: pricing.finalActivityDiscount,
      activityPrice: pricing.activityPrice,
      trafficPrice: pricing.trafficPrice,
      roas: pricing.roas,
      trafficLimitPrice,
      trafficLimitProfitMargin: trafficPricing.reviewProfitMargin,
      trafficLimitSuggestedActivityDiscount: trafficPricing.suggestedActivityDiscount,
      trafficLimitFinalActivityDiscount: trafficPricing.finalActivityDiscount,
      trafficLimitActivityPrice: trafficPricing.activityPrice,
      trafficLimitTrafficPrice: trafficPricing.trafficPrice,
      trafficLimitRoas: trafficPricing.roas,
      orderCount: spuRow.order_count,
      bindings: batch.bindingsBySpuLink.get(spuRow.id) ?? [],
      createdAt: spuRow.created_at,
      updatedAt: spuRow.updated_at,
    };
  });
}

function mapRecord(
  row: RecordRow,
  user: UserAccount,
  settings: ProductManagementSettings,
  batch: ProductManagementBatchData,
  lifecycleMatch: ProductManagementRecord["lifecycleMatch"],
  y2Inventory: ProductManagementRecord["y2Inventory"],
): ProductManagementRecord {
  const pricing = calculatePricing({
    goodsValue: row.goods_value,
    weightKg: row.weight_kg,
    shippingCostPerKg: settings.shippingCostPerKg,
    recommendedProfitMargin: settings.recommendedProfitMargin,
    profitThresholdRate: settings.profitThresholdRate,
    reviewPrice: null,
    initialReviewPrice: null,
    activityDiscountOverride: null,
  });
  return {
    id: row.id,
    shopProfileId: row.shop_profile_id,
    createdByUserId: row.created_by_user_id,
    createdByUsername: row.created_by_username,
    canEdit: user.role === "admin" || row.created_by_user_id === user.id,
    productCode: row.product_code,
    internalProductId: row.internal_product_id,
    serialNumber: row.serial_number,
    weightKg: row.weight_kg,
    goodsValue: row.goods_value,
    totalCost: pricing.totalCost,
    profitThresholdPrice: pricing.profitThresholdPrice,
    recommendedPrice: pricing.recommendedPrice,
    imageUrl: row.image_url,
    purchaseLinks: batch.purchaseLinksByRecord.get(row.id) ?? [],
    spuLinks: spuLinksFor(row, settings, batch),
    lifecycleMatch,
    y2Inventory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProductManagementRecords(
  shopId: number,
  user: UserAccount,
  scope: "mine" | "shop",
  search: ProductManagementSearch = {},
  pagination: { page?: number; pageSize?: ProductManagementPageSize } = {},
): ProductManagementListResponse {
  const conditions = ["r.shop_profile_id = ?"];
  const args: Array<string | number> = [shopId];
  if (scope === "mine") {
    conditions.push("r.created_by_user_id = ?");
    args.push(user.id);
  }

  const exactExpression = (column: string): string =>
    `UPPER(TRIM(COALESCE(${column}, '')))`;
  const addExactExists = (
    keywords: string[],
    existsSql: (placeholder: string) => string,
  ): void => {
    if (!keywords.length) return;
    conditions.push(`(${keywords.map(() => existsSql("?")).join(" OR ")})`);
    args.push(...keywords);
  };

  addExactExists(normalizedSearchKeywords(search.spu), (placeholder) =>
    `EXISTS (
      SELECT 1 FROM product_management_spu_links search_spu
      WHERE search_spu.record_id = r.id
        AND ${exactExpression("search_spu.spu")} = ${placeholder}
    )`,
  );
  addExactExists(normalizedSearchKeywords(search.skc), (placeholder) =>
    `EXISTS (
      SELECT 1
      FROM product_management_spu_links search_link
      JOIN product_management_bindings search_binding
        ON search_binding.spu_link_id = search_link.id
      WHERE search_link.record_id = r.id
        AND ${exactExpression("search_binding.skc_id")} = ${placeholder}
    )`,
  );
  addExactExists(normalizedSearchKeywords(search.sku), (placeholder) =>
    `EXISTS (
      SELECT 1
      FROM product_management_spu_links search_link
      JOIN product_management_bindings search_binding
        ON search_binding.spu_link_id = search_link.id
      WHERE search_link.record_id = r.id
        AND ${exactExpression("search_binding.sku_id")} = ${placeholder}
    )`,
  );

  const productCodeKeywords = splitSearchKeywords(search.productCode);
  if (productCodeKeywords.length) {
    const mainCode = `UPPER(REPLACE(REPLACE(REPLACE(r.product_code, ' ', ''), char(9), ''), char(10), ''))`;
    const mainLifecycleCode = lifecycleCodeSqlExpression("r.product_code");
    const bindingCode = `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(search_binding.skc_code, '') || ' ' || COALESCE(search_binding.sku_code, ''), ' ', ''), char(9), ''), char(10), ''))`;
    const bindingSkcLifecycleCode = lifecycleCodeSqlExpression(
      "search_binding.skc_code",
    );
    const bindingSkuLifecycleCode = lifecycleCodeSqlExpression(
      "search_binding.sku_code",
    );
    const codeConditions: string[] = [];
    for (const keyword of productCodeKeywords) {
      const normalized = normalizeProductCode(keyword);
      const lifecycleKey = lifecycleProductCodeKey(keyword) || normalized;
      codeConditions.push(`(
        ${mainCode} LIKE ?
        OR ${mainLifecycleCode} LIKE ?
        OR EXISTS (
          SELECT 1
          FROM product_management_spu_links search_link
          JOIN product_management_bindings search_binding
            ON search_binding.spu_link_id = search_link.id
          WHERE search_link.record_id = r.id
            AND (
              ${bindingCode} LIKE ?
              OR ${bindingSkcLifecycleCode} LIKE ?
              OR ${bindingSkuLifecycleCode} LIKE ?
            )
        )
      )`);
      args.push(
        `%${normalized}%`,
        `%${lifecycleKey}%`,
        `%${normalized}%`,
        `%${lifecycleKey}%`,
        `%${lifecycleKey}%`,
      );
    }
    conditions.push(`(${codeConditions.join(" OR ")})`);
  }

  const pageSize = pagination.pageSize ?? getProductManagementPageSize(user.id);
  const requestedPage = Math.max(1, Math.trunc(pagination.page ?? 1));
  const total = (
    database
      .prepare(
        `SELECT COUNT(*) AS total
         FROM product_management_records r
         WHERE ${conditions.join(" AND ")}`,
      )
      .get(...args) as { total: number }
  ).total;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const rows = database
    .prepare(
      `SELECT r.*, u.username AS created_by_username
       FROM product_management_records r
       JOIN users u ON u.id = r.created_by_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.updated_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize) as RecordRow[];
  const settings = getProductManagementSettings();
  const batch = loadBatchData(shopId, rows.map((row) => row.id));
  const lifecycleMatches = lifecycleMatchesForProducts(
    shopId,
    rows.map((row) => row.product_code),
  );
  const y2Inventory = y2InventorySummariesForRecords(
    rows.map((row) => ({ id: row.id, productCode: row.product_code })),
  );
  return {
    scope,
    settings,
    columnPreferences: getProductManagementColumnPreferences(user.id),
    page,
    pageSize,
    total,
    totalPages,
    records: rows.map((row) => {
      const record = mapRecord(
        row,
        user,
        settings,
        batch,
        lifecycleMatches.get(row.product_code)!,
        y2Inventory.get(row.id) ?? null,
      );
      return {
        ...record,
        lifecycleMatch: { ...record.lifecycleMatch, details: [] },
      };
    }),
  };
}

function ensureEditable(
  recordId: number,
  shopId: number,
  user: UserAccount,
): RecordRow {
  const row = database
    .prepare(
      `SELECT r.*, u.username AS created_by_username
       FROM product_management_records r
       JOIN users u ON u.id = r.created_by_user_id
       WHERE r.id = ? AND r.shop_profile_id = ?`,
    )
    .get(recordId, shopId) as RecordRow | undefined;
  if (!row) throw new Error("产品主档不存在。");
  if (user.role !== "admin" && row.created_by_user_id !== user.id)
    throw new Error("只能维护自己创建的产品主档。");
  return row;
}

function replaceChildren(
  recordId: number,
  input: ProductManagementRecordInput,
): void {
  database
    .prepare(
      "DELETE FROM product_management_purchase_links WHERE record_id = ?",
    )
    .run(recordId);
  const insertPurchaseLink = database.prepare(
    `INSERT INTO product_management_purchase_links (record_id, url, sort_order)
     VALUES (?, ?, ?)`,
  );
  input.purchaseLinks.forEach((url, index) =>
    insertPurchaseLink.run(recordId, url.trim(), index),
  );

  database
    .prepare("DELETE FROM product_management_spu_links WHERE record_id = ?")
    .run(recordId);
  const insertSpu = database.prepare(
    `INSERT INTO product_management_spu_links
      (record_id, spu, note, initial_review_price, review_price,
       activity_discount_override, order_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertBinding = database.prepare(
    `INSERT INTO product_management_bindings
      (spu_link_id, skc_id, sku_id, skc_code, sku_code)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const spuLink of input.spuLinks) {
    const result = insertSpu.run(
      recordId,
      normalizedText(spuLink.spu),
      normalizedText(spuLink.note),
      spuLink.initialReviewPrice,
      spuLink.reviewPrice,
      spuLink.activityDiscountOverride,
      spuLink.orderCount,
    );
    for (const binding of spuLink.bindings) {
      const values = [
        normalizedText(binding.skcId),
        normalizedText(binding.skuId),
        normalizedText(binding.skcCode),
        normalizedText(binding.skuCode),
      ] as const;
      if (values.every((value) => value === null)) continue;
      insertBinding.run(Number(result.lastInsertRowid), ...values);
    }
  }
}

export function updateProductManagementPurchaseLinks(
  recordId: number,
  user: UserAccount,
  purchaseLinks: string[],
): string[] {
  const row = database.prepare(
    "SELECT shop_profile_id FROM product_management_records WHERE id = ?",
  ).get(recordId) as { shop_profile_id: number } | undefined;
  if (!row) throw new Error("产品主档不存在。");
  ensureEditable(recordId, row.shop_profile_id, user);
  database.transaction(() => {
    database.prepare(
      "DELETE FROM product_management_purchase_links WHERE record_id = ?",
    ).run(recordId);
    const insert = database.prepare(
      `INSERT INTO product_management_purchase_links (record_id, url, sort_order)
       VALUES (?, ?, ?)`,
    );
    purchaseLinks.forEach((url, index) => insert.run(recordId, url.trim(), index));
    database.prepare(
      "UPDATE product_management_records SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(recordId);
  })();
  return purchaseLinks.map((url) => url.trim());
}

export function createProductManagementRecord(
  shopId: number,
  user: UserAccount,
  input: ProductManagementRecordInput,
): ProductManagementRecord {
  const parsed = parseProductCode(input.productCode);
  const goodsValue = input.goodsValue ?? parsed.goodsValue;
  const create = database.transaction(() => {
    const result = database
      .prepare(
        `INSERT INTO product_management_records
          (shop_profile_id, created_by_user_id, product_code,
           internal_product_id, serial_number, weight_kg, goods_value)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        shopId,
        user.id,
        input.productCode.trim(),
        parsed.internalProductId,
        parsed.serialNumber,
        input.weightKg,
        goodsValue,
      );
    const id = Number(result.lastInsertRowid);
    replaceChildren(id, input);
    return id;
  });
  const id = create();
  return getProductManagementRecord(id, shopId, user);
}

export function updateProductManagementRecord(
  recordId: number,
  shopId: number,
  user: UserAccount,
  input: ProductManagementRecordInput,
): ProductManagementRecord {
  ensureEditable(recordId, shopId, user);
  const parsed = parseProductCode(input.productCode);
  const goodsValue = input.goodsValue ?? parsed.goodsValue;
  const update = database.transaction(() => {
    database
      .prepare(
        `UPDATE product_management_records SET
          product_code = ?, internal_product_id = ?, serial_number = ?, weight_kg = ?,
           goods_value = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND shop_profile_id = ?`,
      )
      .run(
        input.productCode.trim(),
        parsed.internalProductId,
        parsed.serialNumber,
        input.weightKg,
        goodsValue,
        recordId,
        shopId,
      );
    replaceChildren(recordId, input);
  });
  update();
  return getProductManagementRecord(recordId, shopId, user);
}

export function getProductManagementRecord(
  recordId: number,
  shopId: number,
  user: UserAccount,
): ProductManagementRecord {
  const row = database
    .prepare(
      `SELECT r.*, u.username AS created_by_username
       FROM product_management_records r
       JOIN users u ON u.id = r.created_by_user_id
       WHERE r.id = ? AND r.shop_profile_id = ?`,
    )
    .get(recordId, shopId) as RecordRow | undefined;
  if (!row) throw new Error("产品主档不存在。");
  const settings = getProductManagementSettings();
  const batch = loadBatchData(shopId, [recordId]);
  const lifecycleMatch = lifecycleMatchesForProducts(shopId, [row.product_code]).get(
    row.product_code,
  )!;
  const y2Inventory = y2InventorySummariesForRecords([
    { id: recordId, productCode: row.product_code },
  ]).get(recordId) ?? null;
  return mapRecord(row, user, settings, batch, lifecycleMatch, y2Inventory);
}

export function deleteProductManagementRecord(
  recordId: number,
  shopId: number,
  user: UserAccount,
): void {
  ensureEditable(recordId, shopId, user);
  database
    .prepare(
      "DELETE FROM product_management_records WHERE id = ? AND shop_profile_id = ?",
    )
    .run(recordId, shopId);
}
