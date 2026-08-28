import Database from "better-sqlite3";

const database = new Database("data/database/temu-analytics.sqlite", {
  readonly: true,
});

const shops = database
  .prepare(
    `SELECT id, name, account_label, enabled
     FROM temu_shop_profiles
     WHERE name LIKE ? OR account_label LIKE ?`,
  )
  .all("%Larmelis Y%", "%Larmelis Y%");

for (const shop of shops) {
  const shopId = Number(shop.id);
  const batches = database
    .prepare(
      `SELECT id, status, started_at, completed_at, total_pages,
              total_spus, total_skcs, total_skus, error_message
       FROM temu_lifecycle_sync_batches
       WHERE shop_profile_id = ?
       ORDER BY started_at DESC, id DESC`,
    )
    .all(shopId);
  const lifecycleRows = database
    .prepare(
      `SELECT sync_batch_id, COUNT(*) AS spus,
              SUM(CASE WHEN COALESCE(TRIM(product_code), '') <> '' THEN 1 ELSE 0 END) AS spu_codes,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM temu_lifecycle_skc_current skc
                WHERE skc.spu_row_id = spu.id
                  AND COALESCE(TRIM(skc.skc_code), '') <> ''
              ) THEN 1 ELSE 0 END) AS skc_codes,
              SUM(CASE WHEN EXISTS (
                SELECT 1 FROM temu_lifecycle_skc_current skc
                JOIN temu_lifecycle_sku_current sku ON sku.skc_row_id = skc.id
                WHERE skc.spu_row_id = spu.id
                  AND COALESCE(TRIM(sku.sku_code), '') <> ''
              ) THEN 1 ELSE 0 END) AS sku_codes
       FROM temu_lifecycle_spu_current spu
       WHERE shop_profile_id = ?
       GROUP BY sync_batch_id`,
    )
    .all(shopId);
  const records = database
    .prepare(
      `SELECT source_type, COUNT(*) AS count
       FROM product_management_records
       WHERE shop_profile_id = ?
       GROUP BY source_type`,
    )
    .all(shopId);
  const workerEvents = database
    .prepare(
      `SELECT id, event_type, message, details_json, created_at
       FROM temu_browser_events
       WHERE shop_profile_id = ? AND event_type IN ('WORKER_OUTPUT', 'WORKER_LIFECYCLE_PAGE', 'WORKER_LIFECYCLE_COMPLETED', 'WORKER_LIFECYCLE_FAILED')
       ORDER BY id DESC LIMIT 30`,
    )
    .all(shopId);
  console.log(
    JSON.stringify({ shop, batches, lifecycleRows, records, workerEvents }, null, 2),
  );
}

database.close();
