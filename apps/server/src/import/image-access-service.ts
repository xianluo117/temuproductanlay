import { database } from "../database/index.js";

export interface AuthorizedImageAsset {
  assetId: number;
  fileName: string;
}

/**
 * 图片必须通过当前店铺的 SPU 数据、生命周期 SKC 或产品管理 SKU 绑定可达。
 */
export function findAuthorizedImageAsset(
  shopId: number,
  fileName: string,
): AuthorizedImageAsset | null {
  const row = database
    .prepare(
      `SELECT asset.id AS asset_id, asset.file_name
       FROM image_assets asset
       WHERE asset.file_name = ? AND (
         EXISTS (
           SELECT 1 FROM products product
           WHERE product.shop_profile_id = ?
             AND product.image_asset_id = asset.id
             AND (
               EXISTS (
                 SELECT 1 FROM product_management_spu_links link
                 JOIN product_management_records record ON record.id = link.record_id
                 WHERE record.shop_profile_id = product.shop_profile_id
                   AND link.spu = product.spu
               )
               OR EXISTS (
                 SELECT 1 FROM daily_metrics metric
                 WHERE metric.shop_profile_id = product.shop_profile_id
                   AND metric.spu = product.spu
               )
             )
         )
         OR EXISTS (
           SELECT 1 FROM temu_lifecycle_skc_current skc
           JOIN temu_lifecycle_spu_current spu ON spu.id = skc.spu_row_id
           WHERE spu.shop_profile_id = ? AND skc.image_asset_id = asset.id
         )
         OR EXISTS (
           SELECT 1 FROM zhihou_new_order_items item
           JOIN product_management_bindings binding
             ON UPPER(TRIM(COALESCE(binding.sku_id, ''))) = UPPER(TRIM(item.zhihou_sku))
             OR UPPER(TRIM(COALESCE(binding.sku_code, ''))) = UPPER(TRIM(item.zhihou_sku))
           JOIN product_management_spu_links link ON link.id = binding.spu_link_id
           JOIN product_management_records record ON record.id = link.record_id
           WHERE record.shop_profile_id = ? AND item.image_asset_id = asset.id
         )
       )
       LIMIT 1`,
    )
    .get(fileName, shopId, shopId, shopId) as
    | { asset_id: number; file_name: string }
    | undefined;
  return row ? { assetId: row.asset_id, fileName: row.file_name } : null;
}
