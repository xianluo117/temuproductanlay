import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { nanoid } from 'nanoid';
import { database } from '../database/index.js';
import { paths } from '../config.js';
import type { BackupInfo, BackupManifest, BackupType } from './backup-service.js';

interface UserBackupPayload {
  version: 1;
  ownerId: number;
  tables: Record<string, Array<Record<string, unknown>>>;
}

const OWNER_TABLES = [
  'import_batches',
  'products',
  'daily_metrics',
  'product_operation_records',
  'global_operation_records',
  'remote_image_tasks',
  'import_replaced_metrics',
  'user_settings',
] as const;

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timestamp(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().replace(/[:.]/g, '-').replace('Z', '');
}

function manifestFor(ownerId: number, type: BackupType, now: Date): BackupManifest {
  const stats = database.prepare(`
    SELECT MIN(data_date) AS earliestDataDate, MAX(data_date) AS latestDataDate,
      COUNT(*) AS metricRowCount, COUNT(DISTINCT spu) AS productCount
    FROM daily_metrics WHERE owner_id = ?
  `).get(ownerId) as { earliestDataDate: string | null; latestDataDate: string | null; metricRowCount: number; productCount: number };
  const batches = database.prepare("SELECT COUNT(*) AS count FROM import_batches WHERE owner_id = ? AND status = 'completed'").get(ownerId) as { count: number };
  return {
    version: 2,
    type,
    ownerId,
    createdAt: now.toISOString(),
    localDate: localDate(now),
    earliestDataDate: stats.earliestDataDate,
    latestDataDate: stats.latestDataDate,
    importBatchCount: batches.count,
    metricRowCount: stats.metricRowCount,
    productCount: stats.productCount,
  };
}

function payloadFor(ownerId: number): UserBackupPayload {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of OWNER_TABLES) {
    tables[table] = database.prepare(`SELECT * FROM ${table} WHERE owner_id = ?`).all(ownerId) as Array<Record<string, unknown>>;
  }
  const assets = database.prepare(`
    SELECT DISTINCT a.* FROM image_assets a JOIN products p ON p.image_asset_id = a.id WHERE p.owner_id = ?
  `).all(ownerId) as Array<Record<string, unknown>>;
  tables.image_assets = assets;
  return { version: 1, ownerId, tables };
}

function removeExpired(ownerId: number): void {
  const files = listUserBackups(ownerId).filter((item) => item.type === 'automatic');
  const dates = [...new Set(files.map((item) => item.localDate).sort().reverse())].slice(0, 3);
  for (const item of files) {
    if (!dates.includes(item.localDate) || files.some((other) => other.fileName !== item.fileName && other.localDate === item.localDate && other.createdAt > item.createdAt)) {
      fs.rmSync(path.join(paths.backups, item.fileName), { force: true });
    }
  }
}

export function createUserBackup(ownerId: number, type: BackupType = 'manual', now = new Date()): BackupInfo {
  const manifest = manifestFor(ownerId, type, now);
  const payload = payloadFor(ownerId);
  const fileName = `temu-analytics-${type}-${timestamp(now)}-user-${ownerId}.zip`;
  const output = path.join(paths.backups, fileName);
  const temporary = `${output}.tmp`;
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('user-data.json', Buffer.from(JSON.stringify(payload)));
  for (const asset of payload.tables.image_assets ?? []) {
    const name = String(asset.file_name);
    const source = path.join(paths.images, name);
    if (fs.existsSync(source)) zip.addLocalFile(source, 'images');
  }
  for (const batch of payload.tables.import_batches ?? []) {
    const name = String(batch.stored_file_name);
    const source = path.join(paths.imports, name);
    if (fs.existsSync(source)) zip.addLocalFile(source, 'imports');
  }
  zip.writeZip(temporary);
  fs.renameSync(temporary, output);
  if (type === 'automatic') removeExpired(ownerId);
  return { ...manifest, fileName, byteSize: fs.statSync(output).size };
}

function readUserBackup(filePath: string): { manifest: BackupManifest; payload: UserBackupPayload; zip: AdmZip } {
  const zip = new AdmZip(filePath);
  const manifestEntry = zip.getEntry('manifest.json');
  const payloadEntry = zip.getEntry('user-data.json');
  if (!manifestEntry || !payloadEntry) throw new Error('用户备份文件结构不完整。');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as BackupManifest;
  const payload = JSON.parse(payloadEntry.getData().toString('utf8')) as UserBackupPayload;
  if (!manifest.ownerId || payload.version !== 1) throw new Error('不是有效的用户业务数据备份。');
  return { manifest, payload, zip };
}

export function listUserBackups(ownerId: number): BackupInfo[] {
  return fs.readdirSync(paths.backups, { withFileTypes: true }).flatMap((entry): BackupInfo[] => {
    if (!entry.isFile() || !entry.name.endsWith(`-user-${ownerId}.zip`)) return [];
    const fullPath = path.join(paths.backups, entry.name);
    try {
      const { manifest } = readUserBackup(fullPath);
      if (manifest.ownerId !== ownerId) return [];
      return [{ ...manifest, fileName: entry.name, byteSize: fs.statSync(fullPath).size }];
    } catch { return []; }
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function insertRows(table: string, rows: Array<Record<string, unknown>>, ownerId: number): void {
  for (const raw of rows) {
    const row: Record<string, unknown> = { ...raw, ...('owner_id' in raw ? { owner_id: ownerId } : {}) };
    const columns = Object.keys(row);
    if (columns.length === 0) continue;
    const placeholders = columns.map(() => '?').join(', ');
    database.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]));
  }
}

export async function restoreUserBackup(filePath: string, ownerId: number): Promise<BackupManifest> {
  const { manifest, payload, zip } = readUserBackup(filePath);
  createUserBackup(ownerId, 'pre_restore');
  const transaction = database.transaction(() => {
    database.prepare('DELETE FROM user_settings WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM global_operation_records WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM import_replaced_metrics WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM remote_image_tasks WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM product_operation_records WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM daily_metrics WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM products WHERE owner_id = ?').run(ownerId);
    database.prepare('DELETE FROM import_batches WHERE owner_id = ?').run(ownerId);
    insertRows('image_assets', payload.tables.image_assets ?? [], ownerId);
    for (const table of ['import_batches', 'products', 'daily_metrics', 'product_operation_records', 'global_operation_records', 'remote_image_tasks', 'import_replaced_metrics', 'user_settings']) {
      insertRows(table, payload.tables[table] ?? [], ownerId);
    }
  });
  transaction();
  const temporary = path.join(paths.temp, `user-restore-${nanoid(10)}`);
  await fsp.mkdir(temporary, { recursive: true });
  try {
    zip.extractAllTo(temporary, true);
    for (const directory of ['images', 'imports'] as const) {
      const source = path.join(temporary, directory);
      if (fs.existsSync(source)) await fsp.cp(source, paths[directory], { recursive: true, force: true });
    }
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
  return { ...manifest, ownerId };
}

export async function restoreStoredUserBackup(fileName: string, ownerId: number): Promise<BackupManifest> {
  const safeName = path.basename(fileName);
  if (safeName !== fileName || !safeName.endsWith(`-user-${ownerId}.zip`)) throw new Error('备份文件不属于当前数据账号。');
  return restoreUserBackup(path.join(paths.backups, safeName), ownerId);
}
