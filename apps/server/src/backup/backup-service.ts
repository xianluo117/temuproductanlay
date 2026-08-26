import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";
import { database } from "../database/index.js";

export type BackupType = "automatic" | "manual" | "pre_restore";

export interface BackupManifest {
  version: 2;
  type: BackupType;
  shopId?: number;
  createdAt: string;
  localDate: string;
  latestDataDate: string | null;
  earliestDataDate: string | null;
  importBatchCount: number;
  metricRowCount: number;
  productCount: number;
}

export interface BackupInfo extends BackupManifest {
  fileName: string;
  byteSize: number;
}

interface BackupStatsRow {
  earliest_data_date: string | null;
  latest_data_date: string | null;
  metric_row_count: number;
  product_count: number;
  import_batch_count: number;
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timestamp(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

function getBackupStats(): BackupStatsRow {
  const dates = database
    .prepare(
      `
    SELECT MIN(data_date) AS earliest_data_date,
      MAX(data_date) AS latest_data_date,
      COUNT(*) AS metric_row_count,
      COUNT(DISTINCT shop_profile_id || ':' || spu) AS product_count
    FROM daily_metrics
  `,
    )
    .get() as Omit<BackupStatsRow, "import_batch_count">;
  const batches = database
    .prepare(
      "SELECT COUNT(*) AS count FROM import_batches WHERE status = 'completed'",
    )
    .get() as { count: number };
  return { ...dates, import_batch_count: batches.count };
}

function readManifest(zipPath: string): BackupManifest {
  const zip = new AdmZip(zipPath);
  const entry = zip.getEntry("manifest.json");
  if (!entry) throw new Error("备份缺少 manifest.json。");
  const raw = JSON.parse(
    entry.getData().toString("utf8"),
  ) as Partial<BackupManifest> & { version?: number };
  if (raw.version !== 2 || !raw.type || !raw.createdAt || !raw.localDate) {
    throw new Error("备份版本不受支持或元数据不完整。");
  }
  return raw as BackupManifest;
}

function backupFileName(type: BackupType, now: Date): string {
  return `temu-analytics-${type}-${timestamp(now)}.zip`;
}

function removeExpiredAutomaticBackups(currentFileName: string): void {
  const automatic = listBackups().filter((item) => item.type === "automatic");
  const current = automatic.find((item) => item.fileName === currentFileName);
  if (!current) return;

  for (const item of automatic) {
    if (
      item.fileName !== current.fileName &&
      item.localDate === current.localDate
    ) {
      fs.rmSync(path.join(paths.backups, item.fileName), { force: true });
    }
  }

  const remaining = listBackups().filter((item) => item.type === "automatic");
  const retainedDates = [
    ...new Set(
      remaining
        .map((item) => item.localDate)
        .sort()
        .reverse(),
    ),
  ].slice(0, 3);
  for (const item of remaining) {
    if (!retainedDates.includes(item.localDate)) {
      fs.rmSync(path.join(paths.backups, item.fileName), { force: true });
    }
  }
}

export function listBackups(): BackupInfo[] {
  return fs
    .readdirSync(paths.backups, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
    .flatMap((entry): BackupInfo[] => {
      const fullPath = path.join(paths.backups, entry.name);
      try {
        const manifest = readManifest(fullPath);
        const stat = fs.statSync(fullPath);
        if (manifest.shopId !== undefined) return [];
        return [{ ...manifest, fileName: entry.name, byteSize: stat.size }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createBackup(
  type: BackupType = "manual",
  now = new Date(),
): BackupInfo {
  database.pragma("wal_checkpoint(TRUNCATE)");
  const stats = getBackupStats();
  const manifest: BackupManifest = {
    version: 2,
    type,
    createdAt: now.toISOString(),
    localDate: localDate(now),
    latestDataDate: stats.latest_data_date,
    earliestDataDate: stats.earliest_data_date,
    importBatchCount: stats.import_batch_count,
    metricRowCount: stats.metric_row_count,
    productCount: stats.product_count,
  };
  const fileName = backupFileName(type, now);
  const outputPath = path.join(paths.backups, fileName);
  const temporaryPath = `${outputPath}.tmp`;
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  if (!fs.existsSync(paths.database))
    throw new Error("数据库文件不存在，无法创建备份。");
  zip.addLocalFile(paths.database, "database");
  if (fs.existsSync(paths.images))
    zip.addLocalFolder(
      paths.images,
      "images",
      (name) => !name.endsWith(".gitkeep"),
    );
  if (fs.existsSync(paths.imports))
    zip.addLocalFolder(
      paths.imports,
      "imports",
      (name) => !name.endsWith(".gitkeep"),
    );
  zip.writeZip(temporaryPath);
  fs.renameSync(temporaryPath, outputPath);
  if (type === "automatic") removeExpiredAutomaticBackups(fileName);
  const stat = fs.statSync(outputPath);
  return { ...manifest, fileName, byteSize: stat.size };
}

function resolveStoredBackup(fileName: string): string {
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !safeName.endsWith(".zip"))
    throw new Error("备份文件名无效。");
  const target = path.join(paths.backups, safeName);
  if (!fs.existsSync(target)) throw new Error("备份文件不存在。");
  return target;
}

function validateExtractedDatabase(databasePath: string): void {
  const candidate = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const result = candidate.pragma("integrity_check", { simple: true });
    if (result !== "ok")
      throw new Error(`数据库完整性校验失败：${String(result)}`);
    const required = candidate
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('products', 'daily_metrics', 'import_batches')",
      )
      .get() as { count: number };
    if (required.count !== 3) throw new Error("备份数据库缺少必要数据表。");
  } finally {
    candidate.close();
  }
}

export async function restoreBackup(
  backupPath: string,
): Promise<BackupManifest> {
  const zip = new AdmZip(backupPath);
  const manifest = readManifest(backupPath);
  const databaseEntry = zip.getEntry("database/temu-analytics.sqlite");
  if (!databaseEntry) throw new Error("备份文件缺少数据库。");

  createBackup("pre_restore");
  const restoreDirectory = path.join(paths.temp, `restore-${nanoid(10)}`);
  await fsp.mkdir(restoreDirectory, { recursive: true });
  try {
    zip.extractAllTo(restoreDirectory, true);
    const extractedDatabase = path.join(
      restoreDirectory,
      "database",
      "temu-analytics.sqlite",
    );
    validateExtractedDatabase(extractedDatabase);
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.close();
    await fsp.copyFile(extractedDatabase, paths.database);
    for (const directory of ["images", "imports"] as const) {
      const source = path.join(restoreDirectory, directory);
      await fsp.rm(paths[directory], { recursive: true, force: true });
      await fsp.mkdir(paths[directory], { recursive: true });
      if (fs.existsSync(source))
        await fsp.cp(source, paths[directory], { recursive: true });
    }
    return manifest;
  } finally {
    await fsp.rm(restoreDirectory, { recursive: true, force: true });
    if (backupPath.startsWith(paths.temp))
      await fsp.rm(backupPath, { force: true });
  }
}

export async function restoreStoredBackup(
  fileName: string,
): Promise<BackupManifest> {
  return restoreBackup(resolveStoredBackup(fileName));
}
