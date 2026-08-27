import type Database from "better-sqlite3";

const BUSINESS_TABLES = [
  "import_batches",
  "products",
  "daily_metrics",
  "product_operation_records",
  "global_operation_records",
  "remote_image_tasks",
  "import_replaced_metrics",
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
  ).some((row) => row.name === column);
}

function businessRowCount(database: Database.Database): number {
  return BUSINESS_TABLES.reduce((total, table) => {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as {
      count: number;
    };
    return total + row.count;
  }, 0);
}

function onlyShopProfileId(database: Database.Database): number {
  const rows = database
    .prepare("SELECT id FROM temu_shop_profiles ORDER BY id")
    .all() as Array<{ id: number }>;
  if (rows.length === 1) return rows[0]!.id;
  if (businessRowCount(database) === 0 && rows.length > 0) return rows[0]!.id;

  if (rows.length === 0) {
    // 独立迁移程序可以处理尚未创建店铺档案的旧数据库。
    const result = database
      .prepare(
        `
        INSERT INTO temu_shop_profiles
          (name, account_label, profile_key, cdp_port, fingerprint_seed)
        VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        "历史业务数据店铺",
        "legacy",
        "legacy-migrated-shop",
        19242,
        "legacy-migrated-shop",
      );
    return Number(result.lastInsertRowid);
  }

  throw new Error("旧业务数据迁移无法自动选择多个 Temu 店铺档案。");
}

function createShopBusinessSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      shop_profile_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (shop_profile_id, key),
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS traffic_sync_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      requested_by_user_id INTEGER NOT NULL,
      time_dimension INTEGER NOT NULL DEFAULT 1,
      page_size INTEGER NOT NULL DEFAULT 30,
      total_pages INTEGER NOT NULL DEFAULT 0,
      total_items INTEGER NOT NULL DEFAULT 0,
      imported_items INTEGER NOT NULL DEFAULT 0,
      replaced_items INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      error_message TEXT,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_traffic_sync_batches_shop_started
      ON traffic_sync_batches(shop_profile_id, started_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS traffic_raw_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_batch_id INTEGER NOT NULL,
      shop_profile_id INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      request_json TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      error_code INTEGER,
      response_json TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (sync_batch_id, endpoint, page_number),
      FOREIGN KEY (sync_batch_id) REFERENCES traffic_sync_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS product_operation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      spu TEXT NOT NULL,
      operation_record_id INTEGER,
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
      operator_user_id INTEGER NOT NULL,
      operator_username TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (operator_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS global_operation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_profile_id INTEGER NOT NULL,
      operation_record_id INTEGER,
      action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
      operator_user_id INTEGER NOT NULL,
      operator_username TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (operator_user_id) REFERENCES users(id)
    );
  `);
}

export function ensureShopBusinessSchema(database: Database.Database): void {
  if (hasColumn(database, "products", "shop_profile_id")) {
    createShopBusinessSchema(database);
    return;
  }

  if (businessRowCount(database) > 0) {
    throw new Error(
      "检测到尚未迁移的旧版业务数据，请先关闭系统并运行 migrate-shops.bat。",
    );
  }

  // 空数据库仍需保留当前业务表，后续迁移会将其转换为店铺级结构。
  // 此处若提前删除，migrateBusinessDataToShops 会在统计或重命名表时失败。
  createShopBusinessSchema(database);
}

export function migrateBusinessDataToShops(
  database: Database.Database,
  defaultThresholds: unknown,
): void {
  if (hasColumn(database, "products", "shop_profile_id")) {
    createShopBusinessSchema(database);
    return;
  }

  const shopId =
    businessRowCount(database) === 0 ? null : onlyShopProfileId(database);
  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP INDEX IF EXISTS idx_import_batches_owner_date;
    DROP INDEX IF EXISTS idx_daily_metrics_owner_date;
    DROP INDEX IF EXISTS idx_daily_metrics_owner_spu_date;
    DROP INDEX IF EXISTS idx_product_operations_owner_spu_date;
    DROP INDEX IF EXISTS idx_global_operations_owner_date;
    DROP INDEX IF EXISTS idx_remote_image_tasks_queue;
    DROP INDEX IF EXISTS idx_remote_image_tasks_owner_batch;
  `);
  const migrate = database.transaction(() => {
    for (const table of BUSINESS_TABLES) {
      database.exec(`ALTER TABLE ${table} RENAME TO legacy_shop_${table}`);
    }

    database.exec(`
      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_profile_id INTEGER NOT NULL,
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
        FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (replaced_batch_id) REFERENCES import_batches(id)
      );
      CREATE INDEX idx_import_batches_shop_date
        ON import_batches(shop_profile_id, data_date, status);

      CREATE TABLE products (
        shop_profile_id INTEGER NOT NULL,
        spu TEXT NOT NULL,
        first_listed_at TEXT,
        image_asset_id INTEGER,
        remote_image_url TEXT,
        goods_id TEXT,
        site_id TEXT,
        product_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (shop_profile_id, spu),
        FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (image_asset_id) REFERENCES image_assets(id)
      );

      CREATE TABLE daily_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_profile_id INTEGER NOT NULL,
        data_date TEXT NOT NULL,
        spu TEXT NOT NULL,
        batch_id INTEGER,
        traffic_sync_batch_id INTEGER,
        source_type TEXT NOT NULL DEFAULT 'excel' CHECK (source_type IN ('excel', 'temu_api')),
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
        raw_item_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (shop_profile_id, data_date, spu),
        FOREIGN KEY (shop_profile_id, spu) REFERENCES products(shop_profile_id, spu) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,
        FOREIGN KEY (traffic_sync_batch_id) REFERENCES traffic_sync_batches(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_daily_metrics_shop_date ON daily_metrics(shop_profile_id, data_date);
      CREATE INDEX idx_daily_metrics_shop_spu_date ON daily_metrics(shop_profile_id, spu, data_date);

      CREATE TABLE product_operation_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_profile_id INTEGER NOT NULL,
        spu TEXT NOT NULL,
        operated_at TEXT NOT NULL,
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        note TEXT,
        created_by_user_id INTEGER NOT NULL,
        updated_by_user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_profile_id, spu) REFERENCES products(shop_profile_id, spu) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id),
        FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
      );
      CREATE INDEX idx_product_operations_shop_spu_date
        ON product_operation_records(shop_profile_id, spu, operated_at DESC, id DESC);

      CREATE TABLE global_operation_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_profile_id INTEGER NOT NULL,
        operated_at TEXT NOT NULL,
        content TEXT NOT NULL CHECK (length(trim(content)) > 0),
        note TEXT,
        created_by_user_id INTEGER NOT NULL,
        updated_by_user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id),
        FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
      );
      CREATE INDEX idx_global_operations_shop_date
        ON global_operation_records(shop_profile_id, operated_at DESC, id DESC);

      CREATE TABLE remote_image_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_profile_id INTEGER NOT NULL,
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
        UNIQUE (shop_profile_id, batch_id, spu, image_url),
        FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (shop_profile_id, spu) REFERENCES products(shop_profile_id, spu) ON UPDATE CASCADE ON DELETE CASCADE
      );
      CREATE INDEX idx_remote_image_tasks_queue ON remote_image_tasks(status, next_attempt_at, id);
      CREATE INDEX idx_remote_image_tasks_shop_batch ON remote_image_tasks(shop_profile_id, batch_id, status);

      CREATE TABLE import_replaced_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_profile_id INTEGER NOT NULL,
        replacement_batch_id INTEGER,
        replacement_traffic_sync_batch_id INTEGER,
        original_batch_id INTEGER,
        data_date TEXT NOT NULL,
        spu TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        FOREIGN KEY (shop_profile_id) REFERENCES temu_shop_profiles(id) ON DELETE CASCADE,
        FOREIGN KEY (replacement_batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (replacement_traffic_sync_batch_id) REFERENCES traffic_sync_batches(id) ON DELETE CASCADE
      );
    `);

    database
      .prepare(
        `
      INSERT INTO import_batches
      SELECT id, ?, file_name, stored_file_name, file_hash, data_date, row_count,
        status, issues_json, replaced_batch_id, imported_at, rolled_back_at
      FROM legacy_shop_import_batches
    `,
      )
      .run(shopId);
    database
      .prepare(
        `
      INSERT INTO products
      (shop_profile_id, spu, first_listed_at, image_asset_id, remote_image_url, created_at, updated_at)
      SELECT ?, spu, first_listed_at, image_asset_id, remote_image_url, created_at, updated_at
      FROM legacy_shop_products
    `,
      )
      .run(shopId);
    database
      .prepare(
        `
      INSERT INTO daily_metrics
      (id, shop_profile_id, data_date, spu, batch_id, source_type, first_listed_at,
       impressions, clicks, visitors, cart_users, orders, detail_paid_buyers,
       detail_payment_conversion_rate, impression_order_conversion_rate,
       search_impressions, created_at, updated_at)
      SELECT id, ?, data_date, spu, batch_id, 'excel', first_listed_at,
       impressions, clicks, visitors, cart_users, orders, detail_paid_buyers,
       detail_payment_conversion_rate, impression_order_conversion_rate,
       search_impressions, created_at, created_at
      FROM legacy_shop_daily_metrics
    `,
      )
      .run(shopId);
    database
      .prepare(
        `
      INSERT INTO product_operation_records
      (id, shop_profile_id, spu, operated_at, content, note, created_by_user_id,
       updated_by_user_id, created_at, updated_at)
      SELECT id, ?, spu, operated_at, content, note, owner_id, owner_id, created_at, updated_at
      FROM legacy_shop_product_operation_records
    `,
      )
      .run(shopId);
    database
      .prepare(
        `
      INSERT INTO global_operation_records
      (id, shop_profile_id, operated_at, content, note, created_by_user_id,
       updated_by_user_id, created_at, updated_at)
      SELECT id, ?, operated_at, content, note, owner_id, owner_id, created_at, updated_at
      FROM legacy_shop_global_operation_records
    `,
      )
      .run(shopId);
    database
      .prepare(
        `
      INSERT INTO remote_image_tasks
      SELECT id, ?, batch_id, spu, image_url, status, attempt_count, last_error,
        next_attempt_at, created_at, started_at, completed_at, updated_at
      FROM legacy_shop_remote_image_tasks
    `,
      )
      .run(shopId);
    database
      .prepare(
        `
      INSERT INTO import_replaced_metrics
      (id, shop_profile_id, replacement_batch_id, original_batch_id, data_date, spu, payload_json)
      SELECT id, ?, replacement_batch_id, original_batch_id, data_date, spu, payload_json
      FROM legacy_shop_import_replaced_metrics
    `,
      )
      .run(shopId);

    createShopBusinessSchema(database);

    if (shopId !== null) {
      database.exec(`
        INSERT OR IGNORE INTO temu_shop_user_grants (shop_profile_id, user_id)
        SELECT ${shopId}, id FROM users;
      `);

      const thresholdRows = database
        .prepare(
          "SELECT value_json FROM user_settings WHERE key = 'anomaly_thresholds' ORDER BY owner_id",
        )
        .all() as Array<{ value_json: string }>;
      database
        .prepare(
          "INSERT OR REPLACE INTO shop_settings (shop_profile_id, key, value_json) VALUES (?, 'anomaly_thresholds', ?)",
        )
        .run(
          shopId,
          thresholdRows[0]?.value_json ?? JSON.stringify(defaultThresholds),
        );
    }

    for (const table of [...BUSINESS_TABLES].reverse()) {
      database.exec(`DROP TABLE legacy_shop_${table}`);
    }

    if (!hasColumn(database, "sessions", "active_shop_profile_id")) {
      database.exec(
        "ALTER TABLE sessions ADD COLUMN active_shop_profile_id INTEGER",
      );
    }
    if (shopId !== null) {
      database
        .prepare(
          "UPDATE sessions SET active_shop_profile_id = ? WHERE active_shop_profile_id IS NULL",
        )
        .run(shopId);
    }
  });

  try {
    migrate();
  } finally {
    database.pragma("foreign_keys = ON");
  }
}
