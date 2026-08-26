import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import {
  migrateProductManagement,
  migrateTemuShopProfiles,
  migrateToMultiUser,
} from "./migrations.js";
import { migrateBusinessDataToShops } from "./shop-data-migration.js";

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  FOREIGN KEY (replaced_batch_id) REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_date ON import_batches(data_date, status);

CREATE TABLE IF NOT EXISTS image_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  source_type TEXT NOT NULL CHECK (source_type IN ('embedded', 'remote')),
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  spu TEXT PRIMARY KEY,
  first_listed_at TEXT,
  image_asset_id INTEGER,
  remote_image_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (image_asset_id) REFERENCES image_assets(id)
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  UNIQUE (data_date, spu),
  FOREIGN KEY (spu) REFERENCES products(spu) ON UPDATE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(data_date);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_spu_date ON daily_metrics(spu, data_date);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_orders ON daily_metrics(data_date, orders DESC);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_impressions ON daily_metrics(data_date, impressions DESC);

CREATE TABLE IF NOT EXISTS product_operation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spu TEXT NOT NULL,
  operated_at TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (spu) REFERENCES products(spu) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_operations_spu_date
  ON product_operation_records(spu, operated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS global_operation_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operated_at TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_global_operations_date
  ON global_operation_records(operated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS remote_image_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  spu TEXT NOT NULL,
  image_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id, spu, image_url),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id),
  FOREIGN KEY (spu) REFERENCES products(spu) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_remote_image_tasks_queue
  ON remote_image_tasks(status, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_remote_image_tasks_batch
  ON remote_image_tasks(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_remote_image_tasks_spu_url
  ON remote_image_tasks(spu, image_url, status);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_replaced_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  replacement_batch_id INTEGER NOT NULL,
  original_batch_id INTEGER NOT NULL,
  data_date TEXT NOT NULL,
  spu TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY (replacement_batch_id) REFERENCES import_batches(id),
  FOREIGN KEY (original_batch_id) REFERENCES import_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_replaced_metrics_batch ON import_replaced_metrics(replacement_batch_id);
`;

const defaultSettings = {
  anomalyThresholds: {
    impressionsDrop: 0.3,
    clickThroughRateDrop: 0.25,
    cartRateDrop: 0.3,
    conversionRateDrop: 0.3,
    consecutiveZeroOrderDays: 3,
    minimumImpressions: 50,
  },
};

function ensureDirectories(): void {
  for (const directory of [
    path.dirname(paths.database),
    paths.images,
    paths.imports,
    paths.backups,
    paths.temp,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

ensureDirectories();

export const database: Database.Database = new Database(paths.database);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");
database.exec(schema);
migrateToMultiUser(database, defaultSettings.anomalyThresholds);
migrateTemuShopProfiles(database);
migrateBusinessDataToShops(database, defaultSettings.anomalyThresholds);
migrateProductManagement(database);

database
  .prepare(
    `INSERT OR IGNORE INTO system_settings (key, value_json)
     VALUES ('anomaly_thresholds', ?)`,
  )
  .run(JSON.stringify(defaultSettings.anomalyThresholds));

export function closeDatabase(): void {
  database.close();
}
