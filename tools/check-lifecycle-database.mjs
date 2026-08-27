import Database from "better-sqlite3";

const database = new Database("data/database/temu-analytics.sqlite", {
  readonly: true,
});

const queries = [
  "SELECT id, status, total_pages, total_spus, total_skcs, total_skus, error_message FROM temu_lifecycle_sync_batches ORDER BY id",
  "SELECT COUNT(*) AS count FROM temu_lifecycle_spu_current WHERE main_image_url IS NOT NULL AND TRIM(main_image_url) <> ''",
  "SELECT COUNT(*) AS count FROM products WHERE remote_image_url IS NOT NULL OR image_asset_id IS NOT NULL",
  "SELECT created_by_user_id, COUNT(*) AS count FROM product_management_records GROUP BY created_by_user_id",
];

for (const query of queries) {
  console.log(JSON.stringify(database.prepare(query).all()));
}

database.close();
