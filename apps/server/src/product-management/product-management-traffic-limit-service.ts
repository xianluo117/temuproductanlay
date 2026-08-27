import type {
  ProductManagementTrafficLimitSkc,
  ProductManagementTrafficLimitSku,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { truncateLifecycleProductCode } from "./product-code.js";

interface SkcRow {
  id: number;
  skc_id: string | null;
  skc_code: string | null;
  attribute_json: string | null;
  traffic_limit_price: number | null;
}

interface SkuRow {
  sku_id: string | null;
  sku_code: string | null;
  size_name: string | null;
  specification_json: string | null;
  suggested_price: number | null;
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
  return [];
}

function parseAttributes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? [...new Set(value.flatMap(displayAttribute))] : [];
  } catch {
    return [];
  }
}

function validMinimum(values: Array<number | null>): number | null {
  const valid = values.filter(
    (value): value is number =>
      value !== null && Number.isFinite(value) && value >= 0,
  );
  return valid.length ? Math.min(...valid) : null;
}

function skuDetails(skcRowId: number): ProductManagementTrafficLimitSku[] {
  const rows = database
    .prepare(
      `SELECT sku_id, sku_code, size_name, specification_json, suggested_price
       FROM temu_lifecycle_sku_current
       WHERE skc_row_id = ?
       ORDER BY id`,
    )
    .all(skcRowId) as SkuRow[];
  return rows.map((row) => ({
    skuId: row.sku_id,
    skuCode: row.sku_code,
    displayCode: truncateLifecycleProductCode(row.sku_code),
    sizeName: row.size_name,
    attributes: parseAttributes(row.specification_json),
    trafficLimitPrice: row.suggested_price,
  }));
}

export function listProductManagementTrafficLimitSkcs(
  recordId: number,
  shopId: number,
  spu: string,
): ProductManagementTrafficLimitSkc[] {
  const linked = database
    .prepare(
      `SELECT 1
       FROM product_management_records record
       JOIN product_management_spu_links link ON link.record_id = record.id
       WHERE record.id = ? AND record.shop_profile_id = ? AND link.spu = ?
       LIMIT 1`,
    )
    .get(recordId, shopId, spu);
  if (!linked) throw new Error("产品主档未绑定该 SPU。");

  const rows = database
    .prepare(
      `SELECT skc.id, skc.skc_id, skc.skc_code, skc.attribute_json,
              skc.traffic_limit_price
       FROM temu_lifecycle_skc_current skc
       JOIN temu_lifecycle_spu_current spu_row ON spu_row.id = skc.spu_row_id
       WHERE spu_row.shop_profile_id = ? AND spu_row.spu = ?
       ORDER BY skc.id`,
    )
    .all(shopId, spu) as SkcRow[];

  return rows.flatMap((row): ProductManagementTrafficLimitSkc[] => {
    const skus = skuDetails(row.id);
    const trafficLimitPrice = validMinimum([
      row.traffic_limit_price,
      ...skus.map((sku) => sku.trafficLimitPrice),
    ]);
    if (trafficLimitPrice === null) return [];
    return [
      {
        spu,
        skcId: row.skc_id,
        skcCode: row.skc_code,
        displayCode: truncateLifecycleProductCode(row.skc_code),
        attributes: parseAttributes(row.attribute_json),
        trafficLimitPrice,
        skus,
      },
    ];
  });
}
