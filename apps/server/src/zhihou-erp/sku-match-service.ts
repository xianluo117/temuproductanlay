import type {
  ZhihouSkuMatchResult,
  ZhihouSkuMatchType,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";

interface MatchRow {
  record_id: number;
  shop_profile_id: number;
  product_code: string;
  parent_spu: string | null;
}

function normalizedSku(value: string): string {
  return value.trim().toUpperCase();
}

function candidateRows(
  zhihouSku: string,
  matchType: Exclude<ZhihouSkuMatchType, "none">,
): MatchRow[] {
  const column = matchType === "sku_id" ? "binding.sku_id" : "binding.sku_code";
  return database
    .prepare(
      `SELECT DISTINCT
         record.id AS record_id,
         record.shop_profile_id,
         record.product_code,
         link.spu AS parent_spu
       FROM product_management_bindings binding
       JOIN product_management_spu_links link ON link.id = binding.spu_link_id
       JOIN product_management_records record ON record.id = link.record_id
       WHERE UPPER(TRIM(COALESCE(${column}, ''))) = ?`,
    )
    .all(normalizedSku(zhihouSku)) as MatchRow[];
}

function purchaseLinks(recordId: number): string[] {
  return (
    database
      .prepare(
        `SELECT url FROM product_management_purchase_links
         WHERE record_id = ? ORDER BY sort_order, id`,
      )
      .all(recordId) as Array<{ url: string }>
  ).map((row) => row.url);
}

function matchedResult(
  zhihouSku: string,
  matchType: Exclude<ZhihouSkuMatchType, "none">,
  row: MatchRow,
): ZhihouSkuMatchResult {
  return {
    status: "matched",
    matchType,
    zhihouSku,
    productManagementRecordId: row.record_id,
    shopProfileId: row.shop_profile_id,
    parentSpu: row.parent_spu,
    productCode: row.product_code,
    purchaseLinks: purchaseLinks(row.record_id),
    message: row.parent_spu ? null : "SKU 已匹配产品主档，但未配置上级 SPU。",
  };
}

export function matchZhihouSku(zhihouSku: string): ZhihouSkuMatchResult {
  const sku = zhihouSku.trim();
  for (const matchType of ["sku_id", "sku_code"] as const) {
    const candidates = candidateRows(sku, matchType);
    if (candidates.length === 1) return matchedResult(sku, matchType, candidates[0]!);
    if (candidates.length > 1) {
      return {
        status: "conflict",
        matchType,
        zhihouSku: sku,
        productManagementRecordId: null,
        shopProfileId: null,
        parentSpu: null,
        productCode: null,
        purchaseLinks: [],
        message: `SKU 在产品管理中匹配到 ${candidates.length} 条记录，请清理重复绑定。`,
      };
    }
  }
  return {
    status: "unmatched",
    matchType: "none",
    zhihouSku: sku,
    productManagementRecordId: null,
    shopProfileId: null,
    parentSpu: null,
    productCode: null,
    purchaseLinks: [],
    message: "未在产品管理的 SKU ID 或 SKU 编码中找到匹配项。",
  };
}
