import type Database from 'better-sqlite3';
import { hashPassword } from '../auth/password.js';

const BUSINESS_TABLES = [
  'import_replaced_metrics',
  'remote_image_tasks',
  'product_operation_records',
  'daily_metrics',
  'products',
  'global_operation_records',
  'import_batches',
] as const;

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
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

export function migrateToMultiUser(database: Database.Database, defaultThresholds: unknown): void {
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
  database.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, role, enabled, must_change_password)
    VALUES (1, 'admin', ?, 'admin', 1, 1)
  `).run(hashPassword('password'));

  const alreadyMigrated = hasColumn(database, 'products', 'owner_id');
  if (!alreadyMigrated) {
    database.pragma('foreign_keys = OFF');
    const migrate = database.transaction(() => {
      for (const table of BUSINESS_TABLES) database.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}`);
      createTenantSchema(database);
      database.exec(`
        INSERT INTO import_batches SELECT id, 1, file_name, stored_file_name, file_hash, data_date, row_count, status, issues_json, replaced_batch_id, imported_at, rolled_back_at FROM legacy_import_batches;
        INSERT INTO products SELECT 1, spu, first_listed_at, image_asset_id, remote_image_url, created_at, updated_at FROM legacy_products;
        INSERT INTO daily_metrics SELECT id, 1, data_date, spu, batch_id, first_listed_at, impressions, clicks, visitors, cart_users, orders, detail_paid_buyers, detail_payment_conversion_rate, impression_order_conversion_rate, search_impressions, created_at FROM legacy_daily_metrics;
        INSERT INTO product_operation_records SELECT id, 1, spu, operated_at, content, note, created_at, updated_at FROM legacy_product_operation_records;
        INSERT INTO global_operation_records SELECT id, 1, operated_at, content, note, created_at, updated_at FROM legacy_global_operation_records;
        INSERT INTO remote_image_tasks SELECT id, 1, batch_id, spu, image_url, status, attempt_count, last_error, next_attempt_at, created_at, started_at, completed_at, updated_at FROM legacy_remote_image_tasks;
        INSERT INTO import_replaced_metrics SELECT id, 1, replacement_batch_id, original_batch_id, data_date, spu, payload_json FROM legacy_import_replaced_metrics;
      `);
      for (const table of BUSINESS_TABLES) database.exec(`DROP TABLE legacy_${table}`);
    });
    migrate();
    database.pragma('foreign_keys = ON');
  } else {
    createTenantSchema(database);
  }

  const existingThreshold = database.prepare("SELECT value_json FROM system_settings WHERE key = 'anomaly_thresholds'").get() as { value_json: string } | undefined;
  database.prepare(`INSERT OR IGNORE INTO user_settings (owner_id, key, value_json) VALUES (1, 'anomaly_thresholds', ?)`)
    .run(existingThreshold?.value_json ?? JSON.stringify(defaultThresholds));
}
