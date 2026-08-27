import type {
  ProductLifecycleMatch,
  ProductLifecycleSkcDetail,
  ProductLifecycleSkuDetail,
  ProductLifecycleSpuDetail,
  ProductManagementRecord,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import {
  productCodeMatchesLifecycle,
  truncateLifecycleProductCode,
} from "../product-management/product-code.js";

interface LifecycleSkuRow {
  sku_code: string | null;
  sku_id: string | null;
  size_name: string | null;
  specification_json: string | null;
  lowest_supplier_price: number | null;
  suggested_price: number | null;
}

interface LifecycleSkcRow {
  id: number;
  skc_code: string | null;
  skc_id: string | null;
  attribute_json: string | null;
  lowest_review_price: number | null;
  traffic_limit_price: number | null;
  sku_rows: LifecycleSkuRow[];
}

interface LifecycleSpuRow {
  spu: string;
  skc_rows: LifecycleSkcRow[];
}

function displayAttribute(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!value || typeof value !== "object") return [];
  const item = value as Record<string, unknown>;
  const name = String(item.name ?? item.key ?? item.propertyName ?? "").trim();
  const rawValue = item.value ?? item.values ?? item.propertyValue;
  if (Array.isArray(rawValue)) {
    return rawValue.flatMap((entry) => {
      const text = String(entry ?? "").trim();
      return text ? [`${name ? `${name}: ` : ""}${text}`] : [];
    });
  }
  const text = String(rawValue ?? "").trim();
  if (name && text) return [`${name}: ${text}`];
  if (text) return [text];
  return Object.entries(item).flatMap(([key, current]) => {
    const currentText = String(current ?? "").trim();
    return currentText ? [`${key}: ${currentText}`] : [];
  });
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.flatMap(displayAttribute))];
  } catch {
    return [];
  }
}

function minimum(values: Array<number | null>): number | null {
  const valid = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  return valid.length ? Math.min(...valid) : null;
}

function emptyMatch(): ProductLifecycleMatch {
  return {
    matchType: "none",
    spu: null,
    skcCodes: [],
    skuCodes: [],
    skcAttributes: [],
    skuAttributes: [],
    lowestSupplierPrice: null,
    lowestReviewPrice: null,
    trafficLimitPrice: null,
    details: [],
  };
}

function lifecycleRowsForShop(shopId: number): LifecycleSpuRow[] {
  const spus = database
    .prepare(
      `SELECT id, spu
       FROM temu_lifecycle_spu_current
       WHERE shop_profile_id = ? ORDER BY id`,
    )
    .all(shopId) as Array<{ id: number; spu: string }>;

  return spus.map((spu) => {
    const skcs = database
      .prepare(
        `SELECT id, skc_id, skc_code, attribute_json, lowest_review_price,
                traffic_limit_price
         FROM temu_lifecycle_skc_current
         WHERE spu_row_id = ? ORDER BY id`,
      )
      .all(spu.id) as Array<{
      id: number;
      skc_id: string | null;
      skc_code: string | null;
      attribute_json: string | null;
      lowest_review_price: number | null;
      traffic_limit_price: number | null;
    }>;

    return {
      spu: spu.spu,
      skc_rows: skcs.map((skc) => ({
        id: skc.id,
        skc_code: skc.skc_code,
        skc_id: skc.skc_id,
        attribute_json: skc.attribute_json,
        lowest_review_price: skc.lowest_review_price,
        traffic_limit_price: skc.traffic_limit_price,
        sku_rows: database
          .prepare(
            `SELECT sku_code, sku_id, size_name, specification_json,
                    lowest_supplier_price, suggested_price
             FROM temu_lifecycle_sku_current
             WHERE skc_row_id = ? ORDER BY id`,
          )
          .all(skc.id) as LifecycleSkuRow[],
      })),
    };
  });
}

function skcDetail(
  skc: LifecycleSkcRow,
  selectedSkus: LifecycleSkuRow[],
): ProductLifecycleSkcDetail {
  const skuSupplierPrices = selectedSkus.map(
    (sku) => sku.lowest_supplier_price,
  );
  const skuLimitPrices = selectedSkus.map((sku) => sku.suggested_price);
  return {
    skcId: skc.skc_id,
    skcCode: skc.skc_code,
    displayCode: truncateLifecycleProductCode(skc.skc_code),
    attributes: parseJsonArray(skc.attribute_json),
    lowestSupplierPrice: minimum([
      skc.lowest_review_price,
      ...skuSupplierPrices,
    ]),
    trafficLimitPrice: minimum([
      skc.traffic_limit_price,
      ...skuLimitPrices,
    ]),
    skus: selectedSkus.map((sku) => ({
      skuId: sku.sku_id,
      skuCode: sku.sku_code,
      displayCode: truncateLifecycleProductCode(sku.sku_code),
      sizeName: sku.size_name,
      attributes: parseJsonArray(sku.specification_json),
      lowestSupplierPrice: sku.lowest_supplier_price,
      trafficLimitPrice: sku.suggested_price,
    })),
  };
}

export function lifecycleMatchForProduct(
  shopId: number,
  productCode: string,
): ProductLifecycleMatch {
  if (!productCode.trim()) return emptyMatch();

  const rows = lifecycleRowsForShop(shopId);
  const skcMatches: Array<{ row: LifecycleSpuRow; skc: LifecycleSkcRow }> = [];
  const skuMatches: Array<{
    row: LifecycleSpuRow;
    skc: LifecycleSkcRow;
    sku: LifecycleSkuRow;
  }> = [];

  for (const row of rows) {
    for (const skc of row.skc_rows) {
      if (productCodeMatchesLifecycle(productCode, skc.skc_code)) {
        skcMatches.push({ row, skc });
      }
      for (const sku of skc.sku_rows) {
        if (productCodeMatchesLifecycle(productCode, sku.sku_code)) {
          skuMatches.push({ row, skc, sku });
        }
      }
    }
  }

  const matchType = skcMatches.length
    ? "skc"
    : skuMatches.length
      ? "sku"
      : "none";
  if (matchType === "none") return emptyMatch();

  const detailMap = new Map<string, Map<number, ProductLifecycleSkcDetail>>();
  if (matchType === "skc") {
    for (const { row, skc } of skcMatches) {
      const skcs = detailMap.get(row.spu) ?? new Map();
      skcs.set(skc.id, skcDetail(skc, skc.sku_rows));
      detailMap.set(row.spu, skcs);
    }
  } else {
    for (const { row, skc, sku } of skuMatches) {
      const skcs = detailMap.get(row.spu) ?? new Map();
      const existing = skcs.get(skc.id);
      if (existing) {
        existing.skus.push({
          skuId: sku.sku_id,
          skuCode: sku.sku_code,
          displayCode: truncateLifecycleProductCode(sku.sku_code),
          sizeName: sku.size_name,
          attributes: parseJsonArray(sku.specification_json),
          lowestSupplierPrice: sku.lowest_supplier_price,
          trafficLimitPrice: sku.suggested_price,
        });
        existing.lowestSupplierPrice = minimum(
          existing.skus.map(
            (item: ProductLifecycleSkuDetail) => item.lowestSupplierPrice,
          ),
        );
        existing.trafficLimitPrice = minimum(
          existing.skus.map(
            (item: ProductLifecycleSkuDetail) => item.trafficLimitPrice,
          ),
        );
      } else {
        skcs.set(skc.id, skcDetail(skc, [sku]));
      }
      detailMap.set(row.spu, skcs);
    }
  }

  const details: ProductLifecycleSpuDetail[] = [...detailMap.entries()].map(
    ([spu, skcMap]) => {
      const skcs = [...skcMap.values()];
      return {
        spu,
        lowestSupplierPrice: minimum(
          skcs.map((skc) => skc.lowestSupplierPrice),
        ),
        trafficLimitPrice: minimum(
          skcs.map((skc) => skc.trafficLimitPrice),
        ),
        skcs,
      };
    },
  );

  const skcCodes = new Set<string>();
  const skuCodes = new Set<string>();
  const skcAttributes = new Set<string>();
  const skuAttributes = new Set<string>();
  for (const detail of details) {
    for (const skc of detail.skcs) {
      if (skc.skcCode) skcCodes.add(skc.skcCode);
      skc.attributes.forEach((value) => skcAttributes.add(value));
      for (const sku of skc.skus) {
        if (sku.skuCode) skuCodes.add(sku.skuCode);
        sku.attributes.forEach((value) => skuAttributes.add(value));
      }
    }
  }

  const lowestSupplierPrice = minimum(
    details.map((detail) => detail.lowestSupplierPrice),
  );
  return {
    matchType,
    spu: details.length === 1 ? (details[0]?.spu ?? null) : null,
    skcCodes: [...skcCodes],
    skuCodes: [...skuCodes],
    skcAttributes: [...skcAttributes],
    skuAttributes: [...skuAttributes],
    lowestSupplierPrice,
    lowestReviewPrice: lowestSupplierPrice,
    trafficLimitPrice: minimum(
      details.map((detail) => detail.trafficLimitPrice),
    ),
    details,
  };
}

export function attachLifecycleMatch(
  record: ProductManagementRecord,
): ProductManagementRecord {
  return {
    ...record,
    lifecycleMatch: lifecycleMatchForProduct(
      record.shopProfileId,
      record.productCode,
    ),
  };
}

export function attachLifecycleMatches(
  records: ProductManagementRecord[],
): ProductManagementRecord[] {
  return records.map(attachLifecycleMatch);
}
