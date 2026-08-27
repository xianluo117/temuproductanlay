import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrateToMultiUser } from "./migrations.js";

const databases: Database.Database[] = [];

function createLegacyDatabase(): Database.Database {
  const database = new Database(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE image_assets (id INTEGER PRIMARY KEY);
    CREATE TABLE system_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE import_batches (
      id INTEGER PRIMARY KEY, file_name TEXT, stored_file_name TEXT, file_hash TEXT,
      data_date TEXT, row_count INTEGER, status TEXT, issues_json TEXT,
      replaced_batch_id INTEGER, imported_at TEXT, rolled_back_at TEXT
    );
    CREATE TABLE products (
      spu TEXT PRIMARY KEY, first_listed_at TEXT, image_asset_id INTEGER,
      remote_image_url TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE daily_metrics (
      id INTEGER PRIMARY KEY, data_date TEXT, spu TEXT, batch_id INTEGER,
      first_listed_at TEXT, impressions INTEGER, clicks INTEGER, visitors INTEGER,
      cart_users INTEGER, orders INTEGER, detail_paid_buyers INTEGER,
      detail_payment_conversion_rate REAL, impression_order_conversion_rate REAL,
      search_impressions INTEGER, created_at TEXT
    );
    CREATE TABLE product_operation_records (
      id INTEGER PRIMARY KEY, spu TEXT, operated_at TEXT, content TEXT, note TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE global_operation_records (
      id INTEGER PRIMARY KEY, operated_at TEXT, content TEXT, note TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE remote_image_tasks (
      id INTEGER PRIMARY KEY, batch_id INTEGER, spu TEXT, image_url TEXT,
      status TEXT, attempt_count INTEGER, last_error TEXT, next_attempt_at TEXT,
      created_at TEXT, started_at TEXT, completed_at TEXT, updated_at TEXT
    );
    CREATE TABLE import_replaced_metrics (
      id INTEGER PRIMARY KEY, replacement_batch_id INTEGER, original_batch_id INTEGER,
      data_date TEXT, spu TEXT, payload_json TEXT
    );
  `);
  return database;
}

function columns(database: Database.Database, table: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

function createShopSchemaDatabase(): Database.Database {
  const database = new Database(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE products (
      shop_profile_id INTEGER NOT NULL,
      spu TEXT NOT NULL,
      PRIMARY KEY (shop_profile_id, spu)
    );
  `);
  return database;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("migrateToMultiUser", () => {
  it("将不含 owner_id 的旧版业务表迁移为租户表", () => {
    const database = createLegacyDatabase();

    migrateToMultiUser(database, { minimumImpressions: 50 });

    expect(columns(database, "products")).toContain("owner_id");
    expect(columns(database, "import_batches")).toContain("owner_id");
    expect(
      database
        .prepare("SELECT value_json FROM user_settings WHERE owner_id = 1")
        .get(),
    ).toEqual({ value_json: JSON.stringify({ minimumImpressions: 50 }) });
  });

  it("已是租户结构时可重复执行", () => {
    const database = createLegacyDatabase();
    migrateToMultiUser(database, {});

    expect(() => migrateToMultiUser(database, {})).not.toThrow();
    expect(columns(database, "products")).toContain("owner_id");
  });

  it("已是店铺结构时不再创建 owner_id 索引", () => {
    const database = createShopSchemaDatabase();

    expect(() => migrateToMultiUser(database, {})).not.toThrow();
    expect(columns(database, "products")).toContain("shop_profile_id");
    expect(columns(database, "products")).not.toContain("owner_id");
  });
});
