import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../database/index.js";
import { findAuthorizedImageAsset } from "./image-access-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
let shopId = 0;
let otherShopId = 0;
let adminId = 0;
let lifecycleBatchId = 0;
let orderSyncId = 0;

function createAsset(label: string): { id: number; fileName: string } {
  const fileName = `${label}-${suffix}.jpg`;
  const id = Number(
    database
      .prepare(
        `INSERT INTO image_assets
         (content_hash, file_name, mime_type, byte_size, source_type)
         VALUES (?, ?, 'image/jpeg', 1, 'remote')`,
      )
      .run(`access-${label}-${suffix}`, fileName).lastInsertRowid,
  );
  return { id, fileName };
}

beforeAll(() => {
  adminId = (
    database
      .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
      .get() as { id: number }
  ).id;
  const insertShop = database.prepare(
    `INSERT INTO temu_shop_profiles
     (name, account_label, profile_key, cdp_port, fingerprint_seed)
     VALUES (?, ?, ?, ?, ?)`,
  );
  shopId = Number(
    insertShop.run(
      `Image Access ${suffix}`,
      `image-access-${suffix}`,
      `temu/image-access-${suffix}`,
      18103,
      `image-access-fingerprint-${suffix}`,
    ).lastInsertRowid,
  );
  otherShopId = Number(
    insertShop.run(
      `Image Access Other ${suffix}`,
      `image-access-other-${suffix}`,
      `temu/image-access-other-${suffix}`,
      18104,
      `image-access-other-fingerprint-${suffix}`,
    ).lastInsertRowid,
  );
});

afterAll(() => {
  database.prepare("DELETE FROM temu_shop_profiles WHERE id IN (?, ?)").run(shopId, otherShopId);
});

describe("本地图片店铺访问授权", () => {
  it("允许当前店铺的 SPU 图片并拒绝其他店铺", () => {
    const asset = createAsset("spu");
    const spu = `ACCESS-SPU-${suffix}`;
    database
      .prepare(
        "INSERT INTO products (shop_profile_id, spu, image_asset_id) VALUES (?, ?, ?)",
      )
      .run(shopId, spu, asset.id);
    database
      .prepare(
        `INSERT INTO daily_metrics
         (shop_profile_id, data_date, spu, source_type)
         VALUES (?, '2099-03-01', ?, 'temu_api')`,
      )
      .run(shopId, spu);

    expect(findAuthorizedImageAsset(shopId, asset.fileName)?.assetId).toBe(asset.id);
    expect(findAuthorizedImageAsset(otherShopId, asset.fileName)).toBeNull();
  });

  it("允许当前店铺生命周期 SKC 图片", () => {
    const asset = createAsset("skc");
    lifecycleBatchId = Number(
      database
        .prepare(
          `INSERT INTO temu_lifecycle_sync_batches
           (shop_profile_id, requested_by_user_id, page_size, status)
           VALUES (?, ?, 50, 'completed')`,
        )
        .run(shopId, adminId).lastInsertRowid,
    );
    const spuRowId = Number(
      database
        .prepare(
          `INSERT INTO temu_lifecycle_spu_current
           (shop_profile_id, sync_batch_id, spu) VALUES (?, ?, ?)`,
        )
        .run(shopId, lifecycleBatchId, `ACCESS-LIFE-${suffix}`).lastInsertRowid,
    );
    database
      .prepare(
        `INSERT INTO temu_lifecycle_skc_current
         (spu_row_id, sync_batch_id, skc_code, image_asset_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run(spuRowId, lifecycleBatchId, `ACCESS-SKC-${suffix}`, asset.id);

    expect(findAuthorizedImageAsset(shopId, asset.fileName)?.assetId).toBe(asset.id);
    expect(findAuthorizedImageAsset(otherShopId, asset.fileName)).toBeNull();
  });

  it("仅通过产品管理 SKU 绑定允许 ERP 订单图片", () => {
    const asset = createAsset("erp");
    const sku = `ACCESS-ERP-${suffix}`;
    const recordId = Number(
      database
        .prepare(
          `INSERT INTO product_management_records
           (shop_profile_id, created_by_user_id, product_code, source_type)
           VALUES (?, ?, ?, 'manual')`,
        )
        .run(shopId, adminId, `ACCESS-PRODUCT-${suffix}`).lastInsertRowid,
    );
    const linkId = Number(
      database
        .prepare(
          "INSERT INTO product_management_spu_links (record_id, spu) VALUES (?, ?)",
        )
        .run(recordId, `ACCESS-PARENT-${suffix}`).lastInsertRowid,
    );
    database
      .prepare(
        "INSERT INTO product_management_bindings (spu_link_id, sku_id) VALUES (?, ?)",
      )
      .run(linkId, sku);
    orderSyncId = Number(
      database
        .prepare(
          `INSERT INTO zhihou_order_sync_batches
           (requested_by_user_id, status) VALUES (?, 'completed')`,
        )
        .run(adminId).lastInsertRowid,
    );
    const orderId = Number(
      database
        .prepare(
          `INSERT INTO zhihou_new_orders
           (sync_batch_id, order_no) VALUES (?, ?)`,
        )
        .run(orderSyncId, `ACCESS-ORDER-${suffix}`).lastInsertRowid,
    );
    database
      .prepare(
        `INSERT INTO zhihou_new_order_items
         (sync_batch_id, order_id, external_item_key, zhihou_sku, image_asset_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(orderSyncId, orderId, `ACCESS-ITEM-${suffix}`, sku, asset.id);

    expect(findAuthorizedImageAsset(shopId, asset.fileName)?.assetId).toBe(asset.id);
    expect(findAuthorizedImageAsset(otherShopId, asset.fileName)).toBeNull();
  });
});
