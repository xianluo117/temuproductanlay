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
  const rows = database
    .prepare(
      `SELECT spu_row.id AS spu_row_id, spu_row.spu,
              skc.id AS skc_row_id, skc.skc_id, skc.skc_code,
              skc.attribute_json, skc.lowest_review_price, skc.traffic_limit_price,
              sku.id AS sku_row_id, sku.sku_code, sku.sku_id, sku.size_name,
              sku.specification_json, sku.lowest_supplier_price, sku.suggested_price
       FROM temu_lifecycle_spu_current spu_row
       LEFT JOIN temu_lifecycle_skc_current skc ON skc.spu_row_id = spu_row.id
       LEFT JOIN temu_lifecycle_sku_current sku ON sku.skc_row_id = skc.id
       WHERE spu_row.shop_profile_id = ?
       ORDER BY spu_row.id, skc.id, sku.id`,
    )
    .all(shopId) as Array<{
      spu_row_id: number;
      spu: string;
      skc_row_id: number | null;
      skc_id: string | null;
      skc_code: string | null;
      attribute_json: string | null;
      lowest_review_price: number | null;
      traffic_limit_price: number | null;
      sku_row_id: number | null;
      sku_code: string | null;
      sku_id: string | null;
      size_name: string | null;
      specification_json: string | null;
      lowest_supplier_price: number | null;
      suggested_price: number | null;
    }>;

  const spuMap = new Map<number, LifecycleSpuRow>();
  const skcMap = new Map<number, LifecycleSkcRow>();
  for (const row of rows) {
    let spu = spuMap.get(row.spu_row_id);
    if (!spu) {
      spu = { spu: row.spu, skc_rows: [] };
      spuMap.set(row.spu_row_id, spu);
    }
    if (row.skc_row_id === null) continue;
    let skc = skcMap.get(row.skc_row_id);
    if (!skc) {
      skc = {
        id: row.skc_row_id,
        skc_code: row.skc_code,
        skc_id: row.skc_id,
        attribute_json: row.attribute_json,
        lowest_review_price: row.lowest_review_price,
        traffic_limit_price: row.traffic_limit_price,
        sku_rows: [],
      };
      skcMap.set(row.skc_row_id, skc);
      spu.skc_rows.push(skc);
    }
    if (row.sku_row_id !== null) {
      skc.sku_rows.push({
        sku_code: row.sku_code,
        sku_id: row.sku_id,
        size_name: row.size_name,
        specification_json: row.specification_json,
        lowest_supplier_price: row.lowest_supplier_price,
        suggested_price: row.suggested_price,
      });
    }
  }
  return [...spuMap.values()];
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

function lifecycleMatchFromRows(
  rows: LifecycleSpuRow[],
  productCode: string,
): ProductLifecycleMatch {
  if (!productCode.trim()) return emptyMatch();
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

export function lifecycleMatchForProduct(
  shopId: number,
  productCode: string,
): ProductLifecycleMatch {
  return lifecycleMatchFromRows(lifecycleRowsForShop(shopId), productCode);
}

export function lifecycleMatchesForProducts(
  shopId: number,
  productCodes: string[],
): Map<string, ProductLifecycleMatch> {
  const rows = lifecycleRowsForShop(shopId);
  return new Map(
    [...new Set(productCodes)].map((productCode) => [
      productCode,
      lifecycleMatchFromRows(rows, productCode),
    ]),
  );
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
