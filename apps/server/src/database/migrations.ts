import type Database from "better-sqlite3";
import { hashPassword } from "../auth/password.js";

const BUSINESS_TABLES = [
  "import_replaced_metrics",
  "remote_image_tasks",
  "product_operation_records",
  "daily_metrics",
  "products",
  "global_operation_records",
  "import_batches",
] as const;

function hasColumn(
  database: Database.Database,
  table: string,
  column: string,
): boolean {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>
  ).some((item) => item.name === column);
}

function createTenantSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      active_owner_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (active_owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL DEFAULT 1,
      file_name TEXT NOT NULL,
      stored_file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      data_date TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'rolled_back')),
      issues_json TEXT NOT NULL DEFAULT '[]',
      replaced_batch_id INTEGER,
      imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      rolled_back_at TEXT,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (replaced_batch_id) REFERENCES import_batches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_import_batches_owner_date ON import_batches(owner_id, data_date, status);

    CREATE TABLE IF NOT EXISTS products (
      owner_id INTEGER NOT NULL DEFAULT 1,
      spu TEXT NOT NULL,
      first_listed_at TEXT,
      image_asset_id INTEGER,
      remote_image_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_id, spu),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (image_asset_id) REFERENCES image_assets(id)
    );

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL DEFAULT 1,
      data_date TEXT NOT NULL,
      spu TEXT NOT NULL,
      batch_id INTEGER NOT NULL,
      first_listed_at TEXT,
      impressions INTEGER NOT NULL DEFAULT 0 CHECK (impressions >= 0),
      clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
      visitors INTEGER NOT NULL DEFAULT 0 CHECK (visitors >= 0),
      cart_users INTEGER NOT NULL DEFAULT 0 CHECK (cart_users >= 0),
      orders INTEGER NOT NULL DEFAULT 0 CHECK (orders >= 0),
      detail_paid_buyers INTEGER NOT NULL DEFAULT 0 CHECK (detail_paid_buyers >= 0),
      detail_payment_conversion_rate REAL,
      impression_order_conversion_rate REAL,
      search_impressions INTEGER NOT NULL DEFAULT 0 CHECK (search_impressions >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (owner_id, data_date, spu),
      FOREIGN KEY (owner_id, spu) REFERENCES products(owner_id, spu) ON UPDATE CASCADE ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_daily_metrics_owner_date ON daily_metrics(owner_id, data_date);
    CREATE INDEX IF NOT EXISTS idx_daily_metrics_owner_spu_date ON daily_metrics(owner_id, spu, data_date);

    CREATE TABLE IF NOT EXISTS product_operation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL DEFAULT 1,
      spu TEXT NOT NULL,
      operated_at TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id, spu) REFERENCES products(owner_id, spu) ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_product_operations_owner_spu_date
      ON product_operation_records(owner_id, spu, operated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS global_operation_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL DEFAULT 1,
      operated_at TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(trim(content)) > 0),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_global_operations_owner_date
      ON global_operation_records(owner_id, operated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS remote_image_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL DEFAULT 1,
      batch_id INTEGER NOT NULL,
      spu TEXT NOT NULL,
      image_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (owner_id, batch_id, spu, image_url),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id, spu) REFERENCES products(owner_id, spu) ON UPDATE CASCADE ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_remote_image_tasks_queue ON remote_image_tasks(status, next_attempt_at, id);
    CREATE INDEX IF NOT EXISTS idx_remote_image_tasks_owner_batch ON remote_image_tasks(owner_id, batch_id, status);

    CREATE TABLE IF NOT EXISTS import_replaced_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL DEFAULT 1,
      replacement_batch_id INTEGER NOT NULL,
      original_batch_id INTEGER NOT NULL,
      data_date TEXT NOT NULL,
      spu TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (replacement_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (original_batch_id) REFERENCES import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      owner_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (owner_id, key),
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

export function migrateToMultiUser(
  database: Database.Database,
  defaultThresholds: unknown,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database
    .prepare(
      `
    INSERT OR IGNORE INTO users (id, username, password_hash, role, enabled, must_change_password)
    VALUES (1, 'admin', ?, 'admin', 1, 1)
  `,
    )
    .run(hashPassword("password"));

  const tenantSchema = hasColumn(database, "products", "owner_id");
  const shopSchema = hasColumn(database, "products", "shop_profile_id");
  const legacySchema = !tenantSchema && !shopSchema;
  if (legacySchema) {
    database.pragma("foreign_keys = OFF");
    const migrate = database.transaction(() => {
      for (const table of BUSINESS_TABLES)
        database.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}`);
      createTenantSchema(database);
      database.exec(`
        INSERT INTO import_batches SELECT id, 1, file_name, stored_file_name, file_hash, data_date, row_count, status, issues_json, replaced_batch_id, imported_at, rolled_back_at FROM legacy_import_batches;
        INSERT INTO products SELECT 1, spu, first_listed_at, image_asset_id, remote_image_url, created_at, updated_at FROM legacy_products;
        INSERT INTO daily_metrics SELECT id, 1, data_date, spu, NULLIF(batch_id, 0), first_listed_at, impressions, clicks, visitors, cart_users, orders, detail_paid_buyers, detail_payment_conversion_rate, impression_order_conversion_rate, search_impressions, created_at FROM legacy_daily_metrics;
        INSERT INTO product_operation_records SELECT id, 1, spu, operated_at, content, note, created_at, updated_at FROM legacy_product_operation_records;
        INSERT INTO global_operation_records SELECT id, 1, operated_at, content, note, created_at, updated_at FROM legacy_global_operation_records;
        INSERT INTO remote_image_tasks SELECT id, 1, batch_id, spu, image_url, status, attempt_count, last_error, next_attempt_at, created_at, started_at, completed_at, updated_at FROM legacy_remote_image_tasks;
        INSERT INTO import_replaced_metrics SELECT id, 1, replacement_batch_id, original_batch_id, data_date, spu, payload_json FROM legacy_import_replaced_metrics;
      `);
      for (const table of BUSINESS_TABLES)
        database.exec(`DROP TABLE legacy_${table}`);
    });
    migrate();
    database.pragma("foreign_keys = ON");
  } else if (tenantSchema) {
    createTenantSchema(database);
  }

  if (legacySchema) {
    const existingThreshold = database
      .prepare(
        "SELECT value_json FROM system_settings WHERE key = 'anomaly_thresholds'",
      )
      .get() as { value_json: string } | undefined;
    database
      .prepare(
        `INSERT OR IGNORE INTO user_settings (owner_id, key, value_json) VALUES (1, 'anomaly_thresholds', ?)`,
      )
      .run(existingThreshold?.value_json ?? JSON.stringify(defaultThresholds));
  }
}

export function migrateTemuLifecycle(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS temu_lifecycle_sync_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      requested_by_user_id INTEGER NOT NULL,
      page_size INTEGER NOT NULL DEFAULT 50,
      total_pages INTEGER NOT NULL DEFAULT 0,
      total_spus INTEGER NOT NULL DEFAULT 0,
      total_skcs INTEGER NOT NULL DEFAULT 0,
      total_skus INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_temu_lifecycle_sync_shop_started
      ON temu_lifecycle_sync_batches(shop_profile_id, started_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS temu_lifecycle_raw_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_batch_id INTEGER NOT NULL,
      shop_profile_id INTEGER NOT NULL,
      page_number INTEGER NOT NULL,
      request_json TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      error_code INTEGER,
      response_json TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sync_batch_id, page_number),
      FOREIGN KEY (sync_batch_id) REFERENCES temu_lifecycle_sync_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS temu_lifecycle_spu_current (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      sync_batch_id INTEGER NOT NULL,
      spu TEXT NOT NULL,
      product_id TEXT,
      product_code TEXT,
      main_image_url TEXT,
      lowest_review_price REAL,
      traffic_limit_price REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(shop_profile_id, spu),
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (sync_batch_id) REFERENCES temu_lifecycle_sync_batches(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_temu_lifecycle_spu_code
      ON temu_lifecycle_spu_current(shop_profile_id, product_code);

    CREATE TABLE IF NOT EXISTS temu_lifecycle_skc_current (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spu_row_id INTEGER NOT NULL,
      sync_batch_id INTEGER NOT NULL,
      skc_id TEXT,
      skc_code TEXT,
      attribute_json TEXT,
      lowest_review_price REAL,
      traffic_limit_price REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(spu_row_id, skc_id, skc_code),
      FOREIGN KEY (spu_row_id) REFERENCES temu_lifecycle_spu_current(id) ON DELETE CASCADE,
      FOREIGN KEY (sync_batch_id) REFERENCES temu_lifecycle_sync_batches(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_temu_lifecycle_skc_code
      ON temu_lifecycle_skc_current(skc_code);

    CREATE TABLE IF NOT EXISTS temu_lifecycle_sku_current (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skc_row_id INTEGER NOT NULL,
      sync_batch_id INTEGER NOT NULL,
      sku_id TEXT,
      sku_code TEXT,
      size_name TEXT,
      specification_json TEXT,
      lowest_supplier_price REAL,
      suggested_price REAL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(skc_row_id, sku_id, sku_code),
      FOREIGN KEY (skc_row_id) REFERENCES temu_lifecycle_skc_current(id) ON DELETE CASCADE,
      FOREIGN KEY (sync_batch_id) REFERENCES temu_lifecycle_sync_batches(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_temu_lifecycle_sku_code
      ON temu_lifecycle_sku_current(sku_code);
  `);
  if (
    !hasColumn(database, "temu_lifecycle_spu_current", "lowest_review_price")
  ) {
    database.exec(
      "ALTER TABLE temu_lifecycle_spu_current ADD COLUMN lowest_review_price REAL",
    );
  }
  if (
    !hasColumn(database, "temu_lifecycle_spu_current", "traffic_limit_price")
  ) {
    database.exec(
      "ALTER TABLE temu_lifecycle_spu_current ADD COLUMN traffic_limit_price REAL",
    );
  }
  if (!hasColumn(database, "temu_lifecycle_spu_current", "main_image_url")) {
    database.exec(
      "ALTER TABLE temu_lifecycle_spu_current ADD COLUMN main_image_url TEXT",
    );
  }
}

export function migrateProductManagement(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_management_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      product_code TEXT NOT NULL CHECK (length(trim(product_code)) > 0),
      internal_product_id TEXT,
      serial_number TEXT,
      note TEXT,
      weight_kg REAL NOT NULL DEFAULT 0.3 CHECK (weight_kg >= 0),
      goods_value REAL CHECK (goods_value IS NULL OR goods_value >= 0),
      image_url TEXT,
      source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'lifecycle')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_product_management_records_shop_creator
      ON product_management_records(shop_profile_id, created_by_user_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_product_management_records_shop_updated
      ON product_management_records(shop_profile_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_product_management_records_shop_code
      ON product_management_records(shop_profile_id, product_code);

    CREATE TABLE IF NOT EXISTS product_management_purchase_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      url TEXT NOT NULL CHECK (length(trim(url)) > 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (record_id) REFERENCES product_management_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_product_management_purchase_links_record
      ON product_management_purchase_links(record_id, sort_order, id);

    CREATE TABLE IF NOT EXISTS product_management_spu_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      spu TEXT,
      note TEXT,
      initial_review_price REAL CHECK (initial_review_price IS NULL OR initial_review_price >= 0),
      review_price REAL CHECK (review_price IS NULL OR review_price >= 0),
      activity_discount_override REAL CHECK (
        activity_discount_override IS NULL OR
        (activity_discount_override > 0 AND activity_discount_override <= 1)
      ),
      roas REAL CHECK (roas IS NULL OR roas >= 0),
      order_count INTEGER CHECK (order_count IS NULL OR order_count >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (record_id) REFERENCES product_management_records(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_product_management_spu_links_record
      ON product_management_spu_links(record_id, id);
    CREATE INDEX IF NOT EXISTS idx_product_management_spu_links_spu
      ON product_management_spu_links(spu) WHERE spu IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_management_spu_links_record_spu
      ON product_management_spu_links(record_id, spu);

    CREATE TABLE IF NOT EXISTS product_management_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      spu_link_id INTEGER NOT NULL,
      skc_id TEXT,
      sku_id TEXT,
      skc_code TEXT,
      sku_code TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (
        skc_id IS NOT NULL OR sku_id IS NOT NULL OR
        skc_code IS NOT NULL OR sku_code IS NOT NULL
      ),
      FOREIGN KEY (spu_link_id) REFERENCES product_management_spu_links(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_product_management_bindings_link
      ON product_management_bindings(spu_link_id, id);
    CREATE INDEX IF NOT EXISTS idx_product_management_bindings_skc
      ON product_management_bindings(skc_id) WHERE skc_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_management_bindings_sku
      ON product_management_bindings(sku_id) WHERE sku_id IS NOT NULL;
  `);

  if (!hasColumn(database, "product_management_records", "source_type")) {
    database.exec(
      "ALTER TABLE product_management_records ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'lifecycle'))",
    );
  }
  if (!hasColumn(database, "product_management_records", "serial_number")) {
    database.exec(
      "ALTER TABLE product_management_records ADD COLUMN serial_number TEXT",
    );
  }

  database.exec(`
    UPDATE product_management_records AS record
    SET source_type = 'lifecycle'
    WHERE source_type = 'manual'
      AND created_by_user_id = (
        SELECT id FROM users
        WHERE username = 'admin' AND role = 'admin'
        ORDER BY id LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM product_management_purchase_links purchase
        WHERE purchase.record_id = record.id
      )
      AND EXISTS (
        SELECT 1
        FROM product_management_spu_links link
        JOIN temu_lifecycle_spu_current lifecycle_spu
          ON lifecycle_spu.shop_profile_id = record.shop_profile_id
         AND lifecycle_spu.spu = link.spu
        WHERE link.record_id = record.id
      )
      AND EXISTS (
        SELECT 1
        FROM product_management_spu_links link
        JOIN product_management_bindings binding
          ON binding.spu_link_id = link.id
        JOIN temu_lifecycle_spu_current lifecycle_spu
          ON lifecycle_spu.shop_profile_id = record.shop_profile_id
         AND lifecycle_spu.spu = link.spu
        JOIN temu_lifecycle_skc_current lifecycle_skc
          ON lifecycle_skc.spu_row_id = lifecycle_spu.id
        LEFT JOIN temu_lifecycle_sku_current lifecycle_sku
          ON lifecycle_sku.skc_row_id = lifecycle_skc.id
        WHERE link.record_id = record.id
          AND (
            (binding.skc_id IS NOT NULL AND binding.skc_id = lifecycle_skc.skc_id)
            OR (binding.sku_id IS NOT NULL AND binding.sku_id = lifecycle_sku.sku_id)
          )
      );
  `);

  database
    .prepare(
      `INSERT OR IGNORE INTO system_settings (key, value_json)
       VALUES ('product_management_pricing', ?)`,
    )
    .run(
      JSON.stringify({
        shippingCostPerKg: 60,
        recommendedProfitMargin: 0.55,
        profitThresholdRate: 0.45,
      }),
    );

  if (!hasColumn(database, "product_management_spu_links", "note")) {
    database.exec(
      "ALTER TABLE product_management_spu_links ADD COLUMN note TEXT",
    );
  }
}

export function migrateZhihouErp(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS zhihou_erp_accounts (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      account TEXT NOT NULL CHECK (length(trim(account)) > 0),
      password_ciphertext TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      last_test_status TEXT NOT NULL DEFAULT 'untested'
        CHECK (last_test_status IN ('untested', 'success', 'failed')),
      last_tested_at TEXT,
      last_test_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zhihou_order_sync_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by_user_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
      order_count INTEGER NOT NULL DEFAULT 0 CHECK (order_count >= 0),
      item_count INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_sync_started
      ON zhihou_order_sync_batches(started_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS zhihou_new_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_batch_id INTEGER NOT NULL,
      erp_order_id TEXT,
      order_no TEXT NOT NULL CHECK (length(trim(order_no)) > 0),
      store_name TEXT,
      country_code TEXT,
      submitted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sync_batch_id, order_no),
      FOREIGN KEY (sync_batch_id) REFERENCES zhihou_order_sync_batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_orders_batch_order
      ON zhihou_new_orders(sync_batch_id, order_no);

    CREATE TABLE IF NOT EXISTS zhihou_new_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_batch_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      external_item_key TEXT NOT NULL,
      zhihou_sku TEXT NOT NULL CHECK (length(trim(zhihou_sku)) > 0),
      product_name TEXT,
      color TEXT,
      size TEXT,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      specification_image_url TEXT,
      main_image_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sync_batch_id, external_item_key),
      FOREIGN KEY (sync_batch_id) REFERENCES zhihou_order_sync_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES zhihou_new_orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_items_batch_sku
      ON zhihou_new_order_items(sync_batch_id, zhihou_sku);
    CREATE INDEX IF NOT EXISTS idx_zhihou_items_order
      ON zhihou_new_order_items(order_id, id);

    CREATE TABLE IF NOT EXISTS zhihou_stock_pick_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_by_user_id INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS zhihou_stock_pick_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      target_key TEXT NOT NULL,
      parent_spu TEXT,
      target_zhihou_sku TEXT NOT NULL,
      target_color TEXT NOT NULL,
      target_size TEXT NOT NULL,
      inventory_cell_id INTEGER NOT NULL,
      source_color TEXT NOT NULL,
      source_size TEXT NOT NULL,
      picked_quantity INTEGER NOT NULL CHECK (picked_quantity > 0),
      matched_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (matched_quantity >= 0 AND matched_quantity <= picked_quantity),
      adjusted_quantity INTEGER NOT NULL DEFAULT 0
        CHECK (adjusted_quantity >= 0 AND adjusted_quantity <= picked_quantity),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES zhihou_stock_pick_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_cell_id) REFERENCES y2_inventory_cells(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_pick_items_target
      ON zhihou_stock_pick_items(target_key, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_zhihou_pick_items_inventory
      ON zhihou_stock_pick_items(inventory_cell_id, id);

    CREATE TABLE IF NOT EXISTS zhihou_stock_order_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      submitted_at TEXT,
      store_name TEXT,
      country_code TEXT,
      required_quantity INTEGER NOT NULL CHECK (required_quantity >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      last_seen_sync_batch_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zhihou_stock_order_item_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_snapshot_id INTEGER NOT NULL,
      external_item_key TEXT NOT NULL UNIQUE,
      target_key TEXT NOT NULL,
      target_zhihou_sku TEXT NOT NULL,
      target_color TEXT NOT NULL,
      target_size TEXT NOT NULL,
      required_quantity INTEGER NOT NULL CHECK (required_quantity >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_snapshot_id) REFERENCES zhihou_stock_order_snapshots(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_order_item_snapshot_target
      ON zhihou_stock_order_item_snapshots(target_key, id);

    CREATE TABLE IF NOT EXISTS zhihou_stock_pick_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pick_item_id INTEGER NOT NULL,
      order_item_snapshot_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(pick_item_id, order_item_snapshot_id),
      FOREIGN KEY (pick_item_id) REFERENCES zhihou_stock_pick_items(id) ON DELETE CASCADE,
      FOREIGN KEY (order_item_snapshot_id) REFERENCES zhihou_stock_order_item_snapshots(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_pick_allocations_order_item
      ON zhihou_stock_pick_allocations(order_item_snapshot_id, id);

    CREATE TABLE IF NOT EXISTS zhihou_size_conversion_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_key TEXT NOT NULL,
      target_size TEXT NOT NULL,
      inventory_cell_id INTEGER NOT NULL,
      source_size TEXT NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(target_key, inventory_cell_id),
      FOREIGN KEY (inventory_cell_id) REFERENCES y2_inventory_cells(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_conversion_target
      ON zhihou_size_conversion_options(target_key, id);

    CREATE TABLE IF NOT EXISTS zhihou_inventory_adjustment_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pick_item_id INTEGER NOT NULL UNIQUE,
      inventory_cell_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      before_quantity INTEGER NOT NULL CHECK (before_quantity >= 0),
      after_quantity INTEGER NOT NULL CHECK (after_quantity >= 0),
      adjusted_by_user_id INTEGER NOT NULL,
      adjusted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pick_item_id) REFERENCES zhihou_stock_pick_items(id) ON DELETE RESTRICT,
      FOREIGN KEY (inventory_cell_id) REFERENCES y2_inventory_cells(id) ON DELETE RESTRICT,
      FOREIGN KEY (adjusted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_zhihou_inventory_adjustments_time
       ON zhihou_inventory_adjustment_logs(adjusted_at DESC, id DESC);
   `);
   if (!hasColumn(database, "zhihou_stock_order_snapshots", "is_active")) {
     database.exec(
       "ALTER TABLE zhihou_stock_order_snapshots ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))",
     );
   }
   if (!hasColumn(database, "zhihou_stock_order_snapshots", "last_seen_sync_batch_id")) {
     database.exec(
       "ALTER TABLE zhihou_stock_order_snapshots ADD COLUMN last_seen_sync_batch_id INTEGER",
     );
   }
 }

export function migrateY2Inventory(database: Database.Database): void {
  const productColumns = database
    .prepare("PRAGMA table_info(y2_inventory_products)")
    .all() as Array<{ name: string; notnull: number }>;
  if (productColumns.some((column) => column.name === "product_code" && column.notnull === 1)) {
    database.pragma("foreign_keys = OFF");
    database.pragma("legacy_alter_table = ON");
    database.exec(`
      ALTER TABLE y2_inventory_products RENAME TO y2_inventory_products_legacy;
      CREATE TABLE y2_inventory_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_management_record_id INTEGER,
        product_code TEXT COLLATE NOCASE,
        spu TEXT,
        image_asset_id INTEGER,
        note TEXT,
        sizes_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_management_record_id) REFERENCES product_management_records(id) ON DELETE SET NULL,
        FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
      );
      INSERT INTO y2_inventory_products
        (id, product_management_record_id, product_code, spu, image_asset_id, note, sizes_json, created_at, updated_at)
      SELECT id, product_management_record_id, product_code, spu, image_asset_id, note, sizes_json, created_at, updated_at
      FROM y2_inventory_products_legacy;
      DROP TABLE y2_inventory_products_legacy;
      CREATE INDEX idx_y2_inventory_product_code ON y2_inventory_products(product_code);
      CREATE INDEX idx_y2_inventory_product_record ON y2_inventory_products(product_management_record_id);
    `);
    database.pragma("legacy_alter_table = OFF");
    database.pragma("foreign_keys = ON");
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS y2_inventory_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_management_record_id INTEGER,
      product_code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(product_code)) > 0),
      spu TEXT,
      image_asset_id INTEGER,
      note TEXT,
      sizes_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_management_record_id) REFERENCES product_management_records(id) ON DELETE SET NULL,
      FOREIGN KEY (image_asset_id) REFERENCES image_assets(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_product_code
      ON y2_inventory_products(product_code);
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_product_record
      ON y2_inventory_products(product_management_record_id);

    CREATE TABLE IF NOT EXISTS y2_inventory_colors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_product_id INTEGER NOT NULL,
      color_name TEXT NOT NULL CHECK (length(trim(color_name)) > 0),
      normalized_color TEXT NOT NULL,
      skc_row_id INTEGER,
      skc_id TEXT,
      skc_code TEXT,
      match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('matched', 'unmatched', 'conflict')),
      match_message TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(inventory_product_id, normalized_color),
      FOREIGN KEY (inventory_product_id) REFERENCES y2_inventory_products(id) ON DELETE CASCADE,
      FOREIGN KEY (skc_row_id) REFERENCES temu_lifecycle_skc_current(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_colors_skc
      ON y2_inventory_colors(skc_row_id);

    CREATE TABLE IF NOT EXISTS y2_inventory_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      color_row_id INTEGER NOT NULL,
      size_name TEXT NOT NULL CHECK (length(trim(size_name)) > 0),
      normalized_size TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
      sku_row_id INTEGER,
      sku_id TEXT,
      sku_code TEXT,
      match_status TEXT NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('matched', 'unmatched', 'conflict')),
      match_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(color_row_id, normalized_size),
      FOREIGN KEY (color_row_id) REFERENCES y2_inventory_colors(id) ON DELETE CASCADE,
      FOREIGN KEY (sku_row_id) REFERENCES temu_lifecycle_sku_current(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_cells_sku
      ON y2_inventory_cells(sku_row_id);
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_cells_sku_identity
      ON y2_inventory_cells(sku_id, sku_code);

    CREATE TABLE IF NOT EXISTS y2_inventory_product_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_product_id INTEGER NOT NULL,
      product_code TEXT NOT NULL CHECK (length(trim(product_code)) > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(inventory_product_id, product_code),
      FOREIGN KEY (inventory_product_id) REFERENCES y2_inventory_products(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_y2_inventory_product_codes_value
      ON y2_inventory_product_codes(UPPER(TRIM(product_code)));
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_product_codes_product
      ON y2_inventory_product_codes(inventory_product_id);

    CREATE TABLE IF NOT EXISTS y2_inventory_product_spus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_product_id INTEGER NOT NULL,
      spu TEXT NOT NULL CHECK (length(trim(spu)) > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(inventory_product_id, spu),
      FOREIGN KEY (inventory_product_id) REFERENCES y2_inventory_products(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_y2_inventory_product_spus_value
      ON y2_inventory_product_spus(UPPER(TRIM(spu)));
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_product_spus_product
      ON y2_inventory_product_spus(inventory_product_id);

    CREATE TABLE IF NOT EXISTS y2_inventory_product_spu_specs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_spu_id INTEGER NOT NULL,
      color_row_id INTEGER NOT NULL,
      cell_id INTEGER,
      skc_row_id INTEGER,
      sku_row_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(product_spu_id, color_row_id, cell_id),
      FOREIGN KEY (product_spu_id) REFERENCES y2_inventory_product_spus(id) ON DELETE CASCADE,
      FOREIGN KEY (color_row_id) REFERENCES y2_inventory_colors(id) ON DELETE CASCADE,
      FOREIGN KEY (cell_id) REFERENCES y2_inventory_cells(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_product_spu_specs_color
      ON y2_inventory_product_spu_specs(color_row_id, product_spu_id);
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_product_spu_specs_cell
      ON y2_inventory_product_spu_specs(cell_id, product_spu_id);

    CREATE TABLE IF NOT EXISTS y2_inventory_change_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_product_id INTEGER,
      product_code TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
      changed_by_user_id INTEGER NOT NULL,
      before_total_quantity INTEGER,
      after_total_quantity INTEGER,
      before_json TEXT,
      after_json TEXT,
      changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_y2_inventory_logs_changed
      ON y2_inventory_change_logs(changed_at DESC, id DESC);
  `);
  const staleTables = [
    "y2_inventory_colors",
    "y2_inventory_product_codes",
    "y2_inventory_product_spus",
    "y2_inventory_product_spu_specs",
  ].filter((table) => {
    const row = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string | null } | undefined;
    return row?.sql?.includes("y2_inventory_products_legacy") ?? false;
  });
  if (staleTables.length) {
    database.pragma("foreign_keys = OFF");
    database.pragma("legacy_alter_table = ON");
    for (const table of staleTables) {
      const staleTable = `${table}_stale`;
      database.exec(`ALTER TABLE ${table} RENAME TO ${staleTable};`);
      if (table === "y2_inventory_colors") {
        database.exec(`
          CREATE TABLE y2_inventory_colors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_product_id INTEGER NOT NULL,
            color_name TEXT NOT NULL CHECK (length(trim(color_name)) > 0),
            normalized_color TEXT NOT NULL,
            skc_row_id INTEGER,
            skc_id TEXT,
            skc_code TEXT,
            match_status TEXT NOT NULL DEFAULT 'unmatched'
              CHECK (match_status IN ('matched', 'unmatched', 'conflict')),
            match_message TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(inventory_product_id, normalized_color),
            FOREIGN KEY (inventory_product_id) REFERENCES y2_inventory_products(id) ON DELETE CASCADE,
            FOREIGN KEY (skc_row_id) REFERENCES temu_lifecycle_skc_current(id) ON DELETE SET NULL
          );
          INSERT INTO y2_inventory_colors
            (id, inventory_product_id, color_name, normalized_color, skc_row_id, skc_id,
             skc_code, match_status, match_message, sort_order, created_at, updated_at)
          SELECT id, inventory_product_id, color_name, normalized_color, skc_row_id, skc_id,
                 skc_code, match_status, match_message, sort_order, created_at, updated_at
          FROM y2_inventory_colors_stale;
          DROP TABLE y2_inventory_colors_stale;
        `);
      } else if (table === "y2_inventory_product_codes") {
        database.exec(`
          CREATE TABLE y2_inventory_product_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_product_id INTEGER NOT NULL,
            product_code TEXT NOT NULL CHECK (length(trim(product_code)) > 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(inventory_product_id, product_code),
            FOREIGN KEY (inventory_product_id) REFERENCES y2_inventory_products(id) ON DELETE CASCADE
          );
          INSERT OR IGNORE INTO y2_inventory_product_codes
            (id, inventory_product_id, product_code, created_at)
          SELECT id, inventory_product_id, product_code, created_at
          FROM y2_inventory_product_codes_stale;
          DROP TABLE y2_inventory_product_codes_stale;
        `);
      } else if (table === "y2_inventory_product_spus") {
        database.exec(`
          CREATE TABLE y2_inventory_product_spus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_product_id INTEGER NOT NULL,
            spu TEXT NOT NULL CHECK (length(trim(spu)) > 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(inventory_product_id, spu),
            FOREIGN KEY (inventory_product_id) REFERENCES y2_inventory_products(id) ON DELETE CASCADE
          );
          INSERT OR IGNORE INTO y2_inventory_product_spus
            (id, inventory_product_id, spu, created_at)
          SELECT id, inventory_product_id, spu, created_at
          FROM y2_inventory_product_spus_stale;
          DROP TABLE y2_inventory_product_spus_stale;
        `);
      } else if (table === "y2_inventory_product_spu_specs") {
        database.exec(`DROP TABLE IF EXISTS ${staleTable};`);
      } else {
        database.exec(`DROP TABLE IF EXISTS ${staleTable};`);
      }
    }
    database.pragma("legacy_alter_table = OFF");
    database.pragma("foreign_keys = ON");
  }
  database.exec(`
    INSERT OR IGNORE INTO y2_inventory_product_codes (inventory_product_id, product_code)
    SELECT id, product_code FROM y2_inventory_products
    WHERE TRIM(COALESCE(product_code, '')) <> '';
    INSERT OR IGNORE INTO y2_inventory_product_spus (inventory_product_id, spu)
    SELECT id, spu FROM y2_inventory_products
    WHERE TRIM(COALESCE(spu, '')) <> '';
  `);
  if (!hasColumn(database, "y2_inventory_products", "image_asset_id")) {
    database.exec(
      "ALTER TABLE y2_inventory_products ADD COLUMN image_asset_id INTEGER REFERENCES image_assets(id)",
    );
  }
  if (!hasColumn(database, "y2_inventory_products", "note")) {
    database.exec("ALTER TABLE y2_inventory_products ADD COLUMN note TEXT");
  }
  database.exec(`
    DELETE FROM y2_inventory_change_logs
    WHERE changed_at < datetime('now', '-7 days');
  `);
}

/**
 * 图片文件按内容哈希全局去重；此处只维护业务对象与下载任务的关联。
 * ERP 规格图归属为 SKC 图，未匹配时以 ERP SKU 作为临时目标。
 */
export function migrateProductImages(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS image_download_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_url TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      asset_id INTEGER,
      next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES image_assets(id)
    );
    CREATE INDEX IF NOT EXISTS idx_image_download_tasks_queue
      ON image_download_tasks(status, next_attempt_at, id);

    CREATE TABLE IF NOT EXISTS image_download_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('spu', 'skc', 'erp_sku')),
      shop_profile_id INTEGER,
      target_key TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('traffic', 'lifecycle', 'erp')),
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (target_type, shop_profile_id, target_key),
      FOREIGN KEY (task_id) REFERENCES image_download_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_image_download_targets_task
      ON image_download_targets(task_id);
    CREATE INDEX IF NOT EXISTS idx_image_download_targets_lookup
      ON image_download_targets(target_type, shop_profile_id, target_key);
    CREATE INDEX IF NOT EXISTS idx_image_download_targets_spu_lookup
      ON image_download_targets(shop_profile_id, target_key, task_id)
      WHERE target_type = 'spu';
  `);

  if (!hasColumn(database, "temu_lifecycle_skc_current", "image_url")) {
    database.exec(
      "ALTER TABLE temu_lifecycle_skc_current ADD COLUMN image_url TEXT",
    );
  }
  if (!hasColumn(database, "temu_lifecycle_skc_current", "image_asset_id")) {
    database.exec(
      "ALTER TABLE temu_lifecycle_skc_current ADD COLUMN image_asset_id INTEGER REFERENCES image_assets(id)",
    );
  }
  if (!hasColumn(database, "zhihou_new_order_items", "image_asset_id")) {
    database.exec(
      "ALTER TABLE zhihou_new_order_items ADD COLUMN image_asset_id INTEGER REFERENCES image_assets(id)",
    );
  }
  if (!hasColumn(database, "zhihou_new_order_items", "image_target_key")) {
    database.exec(
      "ALTER TABLE zhihou_new_order_items ADD COLUMN image_target_key TEXT",
    );
  }
}

export function migrateTemuShopProfiles(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS temu_shop_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      account_label TEXT NOT NULL CHECK (length(trim(account_label)) > 0),
      profile_key TEXT NOT NULL UNIQUE,
      mall_id TEXT UNIQUE,
      cdp_port INTEGER NOT NULL UNIQUE CHECK (cdp_port BETWEEN 1024 AND 65535),
      fingerprint_seed TEXT NOT NULL UNIQUE,
      locale TEXT NOT NULL DEFAULT 'zh-CN',
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      runtime_status TEXT NOT NULL DEFAULT 'STOPPED'
        CHECK (runtime_status IN ('STOPPED', 'STARTING', 'READY', 'LOGIN_REQUIRED', 'RISK_BLOCKED', 'ERROR')),
      process_id INTEGER,
      last_started_at TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS temu_shop_user_grants (
      shop_profile_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (shop_profile_id, user_id),
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_temu_shop_user_grants_user
      ON temu_shop_user_grants(user_id, shop_profile_id);

    CREATE TABLE IF NOT EXISTS temu_browser_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT CHECK (status IS NULL OR status IN ('STOPPED', 'STARTING', 'READY', 'LOGIN_REQUIRED', 'RISK_BLOCKED', 'ERROR')),
      message TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_temu_browser_events_shop_created
      ON temu_browser_events(shop_profile_id, created_at DESC, id DESC);
  `);
}
