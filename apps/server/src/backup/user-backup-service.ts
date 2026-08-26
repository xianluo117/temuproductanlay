import AdmZip from "adm-zip";
import { nanoid } from "nanoid";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { database } from "../database/index.js";
import type {
  BackupInfo,
  BackupManifest,
  BackupType,
} from "./backup-service.js";

interface ShopBackupPayload {
  version: 1;
  shopId: number;
  tables: Record<string, Array<Record<string, unknown>>>;
}

const SHOP_TABLES = [
  "import_batches",
  "products",
  "traffic_sync_batches",
  "traffic_raw_responses",
  "daily_metrics",
  "product_operation_records",
  "global_operation_records",
  "remote_image_tasks",
  "import_replaced_metrics",
  "shop_settings",
] as const;

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestamp(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("Z", "");
}

function manifestFor(
  shopId: number,
  type: BackupType,
  now: Date,
): BackupManifest {
  const stats = database
    .prepare(
      `
    SELECT MIN(data_date) AS earliestDataDate, MAX(data_date) AS latestDataDate,
      COUNT(*) AS metricRowCount, COUNT(DISTINCT spu) AS productCount
    FROM daily_metrics WHERE shop_profile_id = ?
  `,
    )
    .get(shopId) as {
    earliestDataDate: string | null;
    latestDataDate: string | null;
    metricRowCount: number;
    productCount: number;
  };
  const batches = database
    .prepare(
      "SELECT COUNT(*) AS count FROM import_batches WHERE shop_profile_id = ? AND status = 'completed'",
    )
    .get(shopId) as { count: number };
  return {
    version: 2,
    type,
    shopId,
    createdAt: now.toISOString(),
    localDate: localDate(now),
    earliestDataDate: stats.earliestDataDate,
    latestDataDate: stats.latestDataDate,
    importBatchCount: batches.count,
    metricRowCount: stats.metricRowCount,
    productCount: stats.productCount,
  };
}

function payloadFor(shopId: number): ShopBackupPayload {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of SHOP_TABLES) {
    tables[table] = database
      .prepare(`SELECT * FROM ${table} WHERE shop_profile_id = ?`)
      .all(shopId) as Array<Record<string, unknown>>;
  }
  const assets = database
    .prepare(
      `
    SELECT DISTINCT a.* FROM image_assets a JOIN products p ON p.image_asset_id = a.id WHERE p.shop_profile_id = ?
  `,
    )
    .all(shopId) as Array<Record<string, unknown>>;
  tables.image_assets = assets;
  return { version: 1, shopId, tables };
}

function removeExpired(shopId: number): void {
  const files = listShopBackups(shopId).filter(
    (item) => item.type === "automatic",
  );
  const dates = [
    ...new Set(
      files
        .map((item) => item.localDate)
        .sort()
        .reverse(),
    ),
  ].slice(0, 3);
  for (const item of files) {
    if (
      !dates.includes(item.localDate) ||
      files.some(
        (other) =>
          other.fileName !== item.fileName &&
          other.localDate === item.localDate &&
          other.createdAt > item.createdAt,
      )
    ) {
      fs.rmSync(path.join(paths.backups, item.fileName), { force: true });
    }
  }
}

export function createShopBackup(
  shopId: number,
  type: BackupType = "manual",
  now = new Date(),
): BackupInfo {
  const manifest = manifestFor(shopId, type, now);
  const payload = payloadFor(shopId);
  const fileName = `temu-analytics-${type}-${timestamp(now)}-shop-${shopId}.zip`;
  const output = path.join(paths.backups, fileName);
  const temporary = `${output}.tmp`;
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile("shop-data.json", Buffer.from(JSON.stringify(payload)));
  for (const asset of payload.tables.image_assets ?? []) {
    const name = String(asset.file_name);
    const source = path.join(paths.images, name);
    if (fs.existsSync(source)) zip.addLocalFile(source, "images");
  }
  for (const batch of payload.tables.import_batches ?? []) {
    const name = String(batch.stored_file_name);
    const source = path.join(paths.imports, name);
    if (fs.existsSync(source)) zip.addLocalFile(source, "imports");
  }
  zip.writeZip(temporary);
  fs.renameSync(temporary, output);
  if (type === "automatic") removeExpired(shopId);
  return { ...manifest, fileName, byteSize: fs.statSync(output).size };
}

function readShopBackup(filePath: string): {
  manifest: BackupManifest;
  payload: ShopBackupPayload;
  zip: AdmZip;
} {
  const zip = new AdmZip(filePath);
  const manifestEntry = zip.getEntry("manifest.json");
  const payloadEntry = zip.getEntry("shop-data.json");
  if (!manifestEntry || !payloadEntry)
    throw new Error("店铺备份文件结构不完整。");
  const manifest = JSON.parse(
    manifestEntry.getData().toString("utf8"),
  ) as BackupManifest;
  const payload = JSON.parse(
    payloadEntry.getData().toString("utf8"),
  ) as ShopBackupPayload;
  if (!manifest.shopId || payload.version !== 1)
    throw new Error("不是有效的店铺业务数据备份。");
  return { manifest, payload, zip };
}

export function listShopBackups(shopId: number): BackupInfo[] {
  return fs
    .readdirSync(paths.backups, { withFileTypes: true })
    .flatMap((entry): BackupInfo[] => {
      if (!entry.isFile() || !entry.name.endsWith(`-shop-${shopId}.zip`))
        return [];
      const fullPath = path.join(paths.backups, entry.name);
      try {
        const { manifest } = readShopBackup(fullPath);
        if (manifest.shopId !== shopId) return [];
        return [
          {
            ...manifest,
            fileName: entry.name,
            byteSize: fs.statSync(fullPath).size,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function insertRows(
  table: string,
  rows: Array<Record<string, unknown>>,
  shopId: number,
): void {
  for (const raw of rows) {
    const row: Record<string, unknown> = {
      ...raw,
      ...("shop_profile_id" in raw ? { shop_profile_id: shopId } : {}),
    };
    const columns = Object.keys(row);
    if (columns.length === 0) continue;
    const placeholders = columns.map(() => "?").join(", ");
    database
      .prepare(
        `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
      )
      .run(...columns.map((column) => row[column]));
  }
}

export async function restoreShopBackup(
  filePath: string,
  shopId: number,
): Promise<BackupManifest> {
  const { manifest, payload, zip } = readShopBackup(filePath);
  if (manifest.shopId !== shopId || payload.shopId !== shopId) {
    throw new Error("备份文件不属于当前店铺。");
  }
  createShopBackup(shopId, "pre_restore");
  const transaction = database.transaction(() => {
    database
      .prepare("DELETE FROM traffic_raw_responses WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM shop_settings WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM global_operation_records WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM import_replaced_metrics WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM remote_image_tasks WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare(
        "DELETE FROM product_operation_records WHERE shop_profile_id = ?",
      )
      .run(shopId);
    database
      .prepare("DELETE FROM daily_metrics WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM traffic_sync_batches WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM products WHERE shop_profile_id = ?")
      .run(shopId);
    database
      .prepare("DELETE FROM import_batches WHERE shop_profile_id = ?")
      .run(shopId);
    insertRows("image_assets", payload.tables.image_assets ?? [], shopId);
    for (const table of [
      "import_batches",
      "products",
      "traffic_sync_batches",
      "traffic_raw_responses",
      "daily_metrics",
      "product_operation_records",
      "global_operation_records",
      "remote_image_tasks",
      "import_replaced_metrics",
      "shop_settings",
    ]) {
      insertRows(table, payload.tables[table] ?? [], shopId);
    }
  });
  transaction();
  const temporary = path.join(paths.temp, `shop-restore-${nanoid(10)}`);
  await fsp.mkdir(temporary, { recursive: true });
  try {
    zip.extractAllTo(temporary, true);
    for (const directory of ["images", "imports"] as const) {
      const source = path.join(temporary, directory);
      if (fs.existsSync(source))
        await fsp.cp(source, paths[directory], {
          recursive: true,
          force: true,
        });
    }
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
  return { ...manifest, shopId };
}

export async function restoreStoredShopBackup(
  fileName: string,
  shopId: number,
): Promise<BackupManifest> {
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !safeName.endsWith(`-shop-${shopId}.zip`))
    throw new Error("备份文件不属于当前店铺。");
  return restoreShopBackup(path.join(paths.backups, safeName), shopId);
}
