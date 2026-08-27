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

  const legacySchema = hasColumn(database, "products", "owner_id");
  const alreadyMigrated = hasColumn(database, "products", "shop_profile_id");
  if (legacySchema && !alreadyMigrated) {
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
  } else if (!alreadyMigrated) {
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
