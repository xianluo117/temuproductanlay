import type {
  ProductManagementBinding,
  ProductManagementListResponse,
  ProductManagementRecord,
  ProductManagementRecordInput,
  ProductManagementSettings,
  ProductManagementSpuLink,
  UserAccount,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
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
  return {
    shippingCostPerKg: Number(parsed.shippingCostPerKg ?? 0),
    recommendedProfitMargin: Number(parsed.recommendedProfitMargin ?? 0.55),
    updatedAt: row?.updated_at ?? null,
  };
}

export function updateProductManagementSettings(input: {
  shippingCostPerKg: number;
  recommendedProfitMargin: number;
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

function spuLinksFor(
  recordId: number,
  goodsValue: number | null,
  weightKg: number,
  settings: ProductManagementSettings,
): ProductManagementSpuLink[] {
  return (
    database
      .prepare(
        `SELECT id, record_id, spu, initial_review_price, review_price,
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
      reviewPrice: row.review_price,
      initialReviewPrice: row.initial_review_price,
      activityDiscountOverride: row.activity_discount_override,
    });
    return {
      id: row.id,
      spu: row.spu,
      initialReviewPrice: row.initial_review_price,
      reviewPrice: row.review_price,
      reviewProfitMargin: pricing.reviewProfitMargin,
      suggestedActivityDiscount: pricing.suggestedActivityDiscount,
      activityDiscountOverride: row.activity_discount_override,
      finalActivityDiscount: pricing.finalActivityDiscount,
      activityPrice: pricing.activityPrice,
      trafficPrice: pricing.trafficPrice,
      roas: row.roas,
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
  const pricing = calculatePricing({
    goodsValue: row.goods_value,
    weightKg: row.weight_kg,
    shippingCostPerKg: settings.shippingCostPerKg,
    recommendedProfitMargin: settings.recommendedProfitMargin,
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
    note: row.note,
    weightKg: row.weight_kg,
    goodsValue: row.goods_value,
    totalCost: pricing.totalCost,
    recommendedPrice: pricing.recommendedPrice,
    imageUrl: row.image_url,
    purchaseLinks,
    spuLinks: spuLinksFor(row.id, row.goods_value, row.weight_kg, settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProductManagementRecords(
  shopId: number,
  user: UserAccount,
  scope: "mine" | "shop",
): ProductManagementListResponse {
  const where =
    scope === "mine"
      ? "WHERE r.shop_profile_id = ? AND r.created_by_user_id = ?"
      : "WHERE r.shop_profile_id = ?";
  const args = scope === "mine" ? [shopId, user.id] : [shopId];
  const rows = database
    .prepare(
      `SELECT r.*, u.username AS created_by_username
       FROM product_management_records r
       JOIN users u ON u.id = r.created_by_user_id
       ${where}
       ORDER BY r.updated_at DESC, r.id DESC`,
    )
    .all(...args) as RecordRow[];
  const settings = getProductManagementSettings();
  return {
    scope,
    settings,
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
      (record_id, spu, initial_review_price, review_price,
       activity_discount_override, roas, order_count)
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
      spuLink.initialReviewPrice,
      spuLink.reviewPrice,
      spuLink.activityDiscountOverride,
      spuLink.roas,
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
  const create = database.transaction(() => {
    const result = database
      .prepare(
        `INSERT INTO product_management_records
          (shop_profile_id, created_by_user_id, product_code,
           internal_product_id, note, weight_kg, goods_value)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        shopId,
        user.id,
        input.productCode.trim(),
        parsed.internalProductId,
        normalizedText(input.note),
        input.weightKg,
        parsed.goodsValue,
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
  const update = database.transaction(() => {
    database
      .prepare(
        `UPDATE product_management_records SET
          product_code = ?, internal_product_id = ?, note = ?, weight_kg = ?,
          goods_value = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND shop_profile_id = ?`,
      )
      .run(
        input.productCode.trim(),
        parsed.internalProductId,
        normalizedText(input.note),
        input.weightKg,
        parsed.goodsValue,
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
