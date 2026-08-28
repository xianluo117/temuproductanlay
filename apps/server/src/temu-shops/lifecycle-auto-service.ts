import { database } from "../database/index.js";
import { queueImageTarget } from "../import/image-association-service.js";
import { notifyImageTaskProcessor } from "../import/image-task-service.js";
import {
  productCodeMatchesLifecycle,
  truncateLifecycleProductCode,
} from "../product-management/product-code.js";
import { parseProductCode } from "../product-management/product-management-calculator.js";

interface LifecycleSkuRow {
  sku_id: string | null;
  sku_code: string | null;
}

interface LifecycleSkcRow {
  skc_id: string | null;
  skc_code: string | null;
  sku_rows: LifecycleSkuRow[];
}

interface LifecycleSpuRow {
  id: number;
  spu: string;
  product_id: string | null;
  product_code: string | null;
  main_image_url: string | null;
  skc_rows: LifecycleSkcRow[];
}

function clean(value: string | null | undefined): string | null {
  const result = value?.trim() ?? "";
  return result || null;
}

function lifecycleRows(shopId: number, syncId: number): LifecycleSpuRow[] {
  const spus = database
    .prepare(
      `SELECT id, spu, product_id, product_code, main_image_url
       FROM temu_lifecycle_spu_current
       WHERE shop_profile_id = ? AND sync_batch_id = ?
       ORDER BY id`,
    )
    .all(shopId, syncId) as Array<{
    id: number;
    spu: string;
    product_id: string | null;
    product_code: string | null;
    main_image_url: string | null;
  }>;

  return spus.map((spu) => {
    const skcs = database
      .prepare(
        `SELECT id, skc_id, skc_code
         FROM temu_lifecycle_skc_current
         WHERE spu_row_id = ? ORDER BY id`,
      )
      .all(spu.id) as Array<{
      id: number;
      skc_id: string | null;
      skc_code: string | null;
    }>;

    return {
      ...spu,
      skc_rows: skcs.map((skc) => ({
        skc_id: skc.skc_id,
        skc_code: skc.skc_code,
        sku_rows: database
          .prepare(
            `SELECT sku_id, sku_code
             FROM temu_lifecycle_sku_current
             WHERE skc_row_id = ? ORDER BY id`,
          )
          .all(skc.id) as LifecycleSkuRow[],
      })),
    };
  });
}

function chooseProductCode(row: LifecycleSpuRow): string | null {
  const candidates = [
    ...row.skc_rows.map((skc) => skc.skc_code),
    ...row.skc_rows.flatMap((skc) => skc.sku_rows.map((sku) => sku.sku_code)),
    row.product_code,
  ]
    .map(truncateLifecycleProductCode)
    .filter((value): value is string => Boolean(value));
  return candidates[0] ?? null;
}

function ensureLifecycleImageBatch(shopId: number, syncId: number): number {
  const existing = database
    .prepare(
      `SELECT id FROM import_batches
       WHERE shop_profile_id = ? AND file_name = ? LIMIT 1`,
    )
    .get(shopId, `lifecycle-sync-${syncId}`) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = database
    .prepare(
      `INSERT INTO import_batches
       (shop_profile_id, file_name, stored_file_name, file_hash, data_date,
        row_count, status, issues_json)
       VALUES (?, ?, ?, ?, CURRENT_DATE, 0, 'completed', '[]')`,
    )
    .run(
      shopId,
      `lifecycle-sync-${syncId}`,
      `lifecycle-sync-${syncId}`,
      `lifecycle-sync-${syncId}`,
    );
  return Number(result.lastInsertRowid);
}

function queueImage(shopId: number, syncId: number, spu: string, url: string): void {
  const product = database
    .prepare(
      `SELECT image_asset_id, remote_image_url
       FROM products WHERE shop_profile_id = ? AND spu = ?`,
    )
    .get(shopId, spu) as
    | { image_asset_id: number | null; remote_image_url: string | null }
    | undefined;
  if (!product || product.image_asset_id || !url) return;

  database
    .prepare(
      `UPDATE products SET remote_image_url = COALESCE(remote_image_url, ?),
       updated_at = CURRENT_TIMESTAMP
       WHERE shop_profile_id = ? AND spu = ?`,
    )
    .run(url, shopId, spu);

  const completed = database
    .prepare(
      `SELECT 1 FROM remote_image_tasks
       WHERE shop_profile_id = ? AND spu = ? AND image_url = ?
         AND status = 'completed' LIMIT 1`,
    )
    .get(shopId, spu, url);
  if (completed) return;

  const pending = database
    .prepare(
      `SELECT 1 FROM remote_image_tasks
       WHERE shop_profile_id = ? AND spu = ? AND image_url = ?
         AND status IN ('pending', 'processing') LIMIT 1`,
    )
    .get(shopId, spu, url);
  if (pending) return;

  const batchId = ensureLifecycleImageBatch(shopId, syncId);
  database
    .prepare(
      `INSERT OR IGNORE INTO remote_image_tasks
       (shop_profile_id, batch_id, spu, image_url, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .run(shopId, batchId, spu, url);
}

export function autoCreateLifecycleProductRecords(
  shopId: number,
  syncId: number,
): void {
  const admin = database
    .prepare("SELECT id FROM users WHERE username = 'admin' AND role = 'admin' AND enabled = 1 LIMIT 1")
    .get() as { id: number } | undefined;
  if (!admin) throw new Error("未找到可用的 admin 管理员账号。");

  const rows = lifecycleRows(shopId, syncId);
  const transaction = database.transaction(() => {
    const upsertProduct = database.prepare(
      `INSERT INTO products
       (shop_profile_id, spu, remote_image_url, goods_id, product_name)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(shop_profile_id, spu) DO UPDATE SET
         remote_image_url = COALESCE(products.remote_image_url, excluded.remote_image_url),
         goods_id = COALESCE(products.goods_id, excluded.goods_id),
         updated_at = CURRENT_TIMESTAMP`,
    );
    const listRecords = database.prepare(
      `SELECT id, product_code, internal_product_id, goods_value, source_type
       FROM product_management_records
       WHERE shop_profile_id = ?
       ORDER BY id`,
    );
    const insertRecord = database.prepare(
      `INSERT INTO product_management_records
       (shop_profile_id, created_by_user_id, product_code, internal_product_id,
        serial_number, weight_kg, goods_value, source_type)
       VALUES (?, ?, ?, ?, ?, 0.3, ?, 'lifecycle')`,
    );
    const fillLifecycleCalculation = database.prepare(
      `UPDATE product_management_records
       SET serial_number = COALESCE(serial_number, ?),
           internal_product_id = COALESCE(internal_product_id, ?),
           goods_value = COALESCE(goods_value, ?),
           updated_at = CASE
             WHEN (serial_number IS NULL AND ? IS NOT NULL)
               OR (internal_product_id IS NULL AND ? IS NOT NULL)
               OR (goods_value IS NULL AND ? IS NOT NULL)
             THEN CURRENT_TIMESTAMP
             ELSE updated_at
           END
       WHERE id = ? AND shop_profile_id = ? AND source_type = 'lifecycle'`,
    );
    const findSpu = database.prepare(
      `SELECT id FROM product_management_spu_links
       WHERE record_id = ? AND spu = ? LIMIT 1`,
    );
    const insertSpu = database.prepare(
      `INSERT INTO product_management_spu_links (record_id, spu)
       VALUES (?, ?)`,
    );
    const findBinding = database.prepare(
      `SELECT 1 FROM product_management_bindings
       WHERE spu_link_id = ? AND COALESCE(skc_id, '') = COALESCE(?, '')
         AND COALESCE(sku_id, '') = COALESCE(?, '')
         AND COALESCE(skc_code, '') = COALESCE(?, '')
         AND COALESCE(sku_code, '') = COALESCE(?, '') LIMIT 1`,
    );
    const insertBinding = database.prepare(
      `INSERT INTO product_management_bindings
       (spu_link_id, skc_id, sku_id, skc_code, sku_code)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const records = listRecords.all(shopId) as Array<{
      id: number;
      product_code: string;
      internal_product_id: string | null;
      goods_value: number | null;
      source_type: "manual" | "lifecycle";
    }>;

    for (const row of rows) {
      const productCode = chooseProductCode(row);
      upsertProduct.run(
        shopId,
        row.spu,
        row.main_image_url,
        row.product_id,
        row.spu,
      );
      if (!productCode) continue;
      const parsed = parseProductCode(productCode);
      const existing = records.find((record) =>
        productCodeMatchesLifecycle(record.product_code, productCode),
      );
      const recordId = existing?.id ?? Number(
        insertRecord.run(
          shopId,
          admin.id,
          productCode,
          parsed.internalProductId ?? row.product_id,
          parsed.serialNumber,
          parsed.goodsValue,
        ).lastInsertRowid,
      );
      if (existing?.source_type === "lifecycle") {
        const internalProductId =
          parsed.internalProductId ?? row.product_id ?? null;
        fillLifecycleCalculation.run(
          parsed.serialNumber,
          internalProductId,
          parsed.goodsValue,
          parsed.serialNumber,
          internalProductId,
          parsed.goodsValue,
          recordId,
          shopId,
        );
      } else if (!existing) {
        records.push({
          id: recordId,
          product_code: productCode,
          internal_product_id: parsed.internalProductId ?? row.product_id,
          goods_value: parsed.goodsValue,
          source_type: "lifecycle",
        });
      }
      const spuLink = findSpu.get(recordId, row.spu) as { id: number } | undefined;
      const spuLinkId = spuLink?.id ?? Number(insertSpu.run(recordId, row.spu).lastInsertRowid);

      for (const skc of row.skc_rows) {
        for (const sku of skc.sku_rows.length ? skc.sku_rows : [{ sku_id: null, sku_code: null }]) {
          const values = [skc.skc_id, sku.sku_id, skc.skc_code, sku.sku_code] as const;
          if (values.every((value) => !clean(value))) continue;
          if (!findBinding.get(spuLinkId, ...values)) insertBinding.run(spuLinkId, ...values);
        }
      }

      const product = database
        .prepare(
          `SELECT remote_image_url, image_asset_id FROM products
           WHERE shop_profile_id = ? AND spu = ?`,
        )
        .get(shopId, row.spu) as
        | { remote_image_url: string | null; image_asset_id: number | null }
        | undefined;
      const imageUrl = product?.image_asset_id
        ? null
        : product?.remote_image_url ?? row.main_image_url;
      if (imageUrl) {
        queueImageTarget({
          url: imageUrl,
          targetType: "spu",
          shopId,
          targetKey: row.spu,
          sourceType: "lifecycle",
          priority: 10,
        });
      }
    }
  });
  transaction();
  notifyImageTaskProcessor();
}
