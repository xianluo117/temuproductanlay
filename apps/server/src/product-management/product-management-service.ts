import {
  PRODUCT_MANAGEMENT_COLUMN_KEYS,
  type ProductManagementBinding,
  type ProductManagementColumnKey,
  type ProductManagementColumnPreferences,
  type ProductManagementListResponse,
  type ProductManagementRecord,
  type ProductManagementRecordInput,
  type ProductManagementSettings,
  type ProductManagementSpuLink,
  type UserAccount,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { lifecycleMatchForProduct } from "../temu-shops/lifecycle-match-service.js";
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

function bindingsFor(spuLinkId: number): ProductManagementBinding[] {
  return (
    database
      .prepare(
        `SELECT id, spu_link_id, skc_id, sku_id, skc_code, sku_code
         FROM product_management_bindings WHERE spu_link_id = ? ORDER BY id`,
      )
      .all(spuLinkId) as BindingRow[]
  ).map((row) => ({
    id: row.id,
    skcId: row.skc_id,
    skuId: row.sku_id,
    skcCode: row.skc_code,
    skuCode: row.sku_code,
  }));
}

function trafficLimitPriceForSpu(
  shopId: number,
  spu: string | null,
): number | null {
  if (!spu) return null;
  const row = database
    .prepare(
      `SELECT MIN(limit_candidates.price) AS minimum_limit_price
       FROM (
         SELECT skc.traffic_limit_price AS price
         FROM temu_lifecycle_skc_current skc
         JOIN temu_lifecycle_spu_current spu_row
           ON spu_row.id = skc.spu_row_id
         WHERE spu_row.shop_profile_id = ? AND spu_row.spu = ?
           AND skc.traffic_limit_price IS NOT NULL
         UNION ALL
         SELECT sku.suggested_price AS price
         FROM temu_lifecycle_sku_current sku
         JOIN temu_lifecycle_skc_current skc
           ON skc.id = sku.skc_row_id
         JOIN temu_lifecycle_spu_current spu_row
           ON spu_row.id = skc.spu_row_id
         WHERE spu_row.shop_profile_id = ? AND spu_row.spu = ?
           AND sku.suggested_price IS NOT NULL
       ) AS limit_candidates`,
    )
    .get(shopId, spu, shopId, spu) as
    | { minimum_limit_price: number | null }
    | undefined;
  return row?.minimum_limit_price ?? null;
}

function spuLinksFor(
  shopId: number,
  recordId: number,
  goodsValue: number | null,
  weightKg: number,
  settings: ProductManagementSettings,
): ProductManagementSpuLink[] {
  return (
    database
      .prepare(
        `SELECT id, record_id, spu, note, initial_review_price, review_price,
                activity_discount_override, roas, order_count, created_at, updated_at
         FROM product_management_spu_links WHERE record_id = ? ORDER BY id`,
      )
      .all(recordId) as SpuRow[]
  ).map((row) => {
    const pricing = calculatePricing({
      goodsValue,
      weightKg,
      shippingCostPerKg: settings.shippingCostPerKg,
      recommendedProfitMargin: settings.recommendedProfitMargin,
      profitThresholdRate: settings.profitThresholdRate,
      reviewPrice: row.review_price,
      initialReviewPrice: row.initial_review_price,
      activityDiscountOverride: row.activity_discount_override,
    });
    const trafficLimitPrice = trafficLimitPriceForSpu(shopId, row.spu);
    const trafficPricing = calculatePricing({
      goodsValue,
      weightKg,
      shippingCostPerKg: settings.shippingCostPerKg,
      recommendedProfitMargin: settings.recommendedProfitMargin,
      profitThresholdRate: settings.profitThresholdRate,
      reviewPrice: trafficLimitPrice,
      initialReviewPrice: null,
      activityDiscountOverride: row.activity_discount_override,
    });
    return {
      id: row.id,
      spu: row.spu,
      note: row.note,
      initialReviewPrice: row.initial_review_price,
      reviewPrice: row.review_price,
      reviewProfitMargin: pricing.reviewProfitMargin,
      suggestedActivityDiscount: pricing.suggestedActivityDiscount,
      activityDiscountOverride: row.activity_discount_override,
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
      orderCount: row.order_count,
      bindings: bindingsFor(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

function mapRecord(
  row: RecordRow,
  user: UserAccount,
  settings: ProductManagementSettings,
): ProductManagementRecord {
  const lifecycleMatch = lifecycleMatchForProduct(
    row.shop_profile_id,
    row.product_code,
  );
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
  const purchaseLinks = (
    database
      .prepare(
        `SELECT url FROM product_management_purchase_links
         WHERE record_id = ? ORDER BY sort_order, id`,
      )
      .all(row.id) as Array<{ url: string }>
  ).map((item) => item.url);
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
    purchaseLinks,
    spuLinks: spuLinksFor(
      row.shop_profile_id,
      row.id,
      row.goods_value,
      row.weight_kg,
      settings,
    ),
    lifecycleMatch,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProductManagementRecords(
  shopId: number,
  user: UserAccount,
  scope: "mine" | "shop",
  search: ProductManagementSearch = {},
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

  const rows = database
    .prepare(
      `SELECT r.*, u.username AS created_by_username
       FROM product_management_records r
       JOIN users u ON u.id = r.created_by_user_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.updated_at DESC, r.id DESC`,
    )
    .all(...args) as RecordRow[];
  const settings = getProductManagementSettings();
  return {
    scope,
    settings,
    columnPreferences: getProductManagementColumnPreferences(user.id),
    records: rows.map((row) => mapRecord(row, user, settings)),
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
  return listProductManagementRecords(shopId, user, "shop").records.find(
    (record) => record.id === id,
  )!;
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
  return listProductManagementRecords(shopId, user, "shop").records.find(
    (record) => record.id === recordId,
  )!;
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
