import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type {
  ImportCommitResponse,
  ImportPreview,
  ProductSummary,
} from '@temu-analytics/shared';
import { paths } from '../config.js';
import { database } from '../database/index.js';
import { createUserBackup } from '../backup/user-backup-service.js';
import { storeEmbeddedImage } from './image-service.js';
import { notifyImageTaskProcessor } from './image-task-service.js';
import { parseTemuWorkbook } from './parser.js';
import type { ParsedProductRow, PendingImport, StoredImage } from './types.js';

const pendingImports = new Map<string, PendingImport>();
const TOKEN_TTL_MS = 30 * 60 * 1000;

interface CountRow {
  count: number;
}

interface BatchRow {
  id: number;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toSummary(row: ParsedProductRow, imageUrl: string | null = null): ProductSummary {
  return {
    date: row.date,
    spu: row.spu,
    firstListedAt: row.firstListedAt,
    imageUrl,
    imageSource: row.embeddedImage ? 'embedded' : row.remoteImageUrl ? 'remote' : 'none',
    impressions: row.impressions,
    clicks: row.clicks,
    visitors: row.visitors,
    cartUsers: row.cartUsers,
    orders: row.orders,
    detailPaidBuyers: row.detailPaidBuyers,
    detailPaymentConversionRate: row.detailPaymentConversionRate,
    impressionOrderConversionRate: row.impressionOrderConversionRate,
    searchImpressions: row.searchImpressions,
    clickThroughRate: rate(row.clicks, row.impressions),
    cartRate: rate(row.cartUsers, row.visitors),
    orderRate: rate(row.orders, row.visitors),
  };
}

function cleanExpiredTokens(): void {
  const now = Date.now();
  for (const [token, pending] of pendingImports) {
    if (now - pending.createdAt > TOKEN_TTL_MS) {
      pendingImports.delete(token);
      void fs.rm(pending.temporaryFilePath, { force: true });
    }
  }
}

export async function createImportPreview(
  temporaryFilePath: string,
  originalFileName: string,
  ownerId: number,
): Promise<ImportPreview> {
  cleanExpiredTokens();
  const fileBuffer = await fs.readFile(temporaryFilePath);
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
  const parsed = await parseTemuWorkbook(temporaryFilePath, originalFileName);
  const errorCount = parsed.issues.filter((issue) => issue.severity === 'error').length;
  const existingRow = database
    .prepare('SELECT COUNT(*) AS count FROM daily_metrics WHERE owner_id = ? AND data_date = ?')
    .get(ownerId, parsed.dataDate) as CountRow;
  const token = nanoid(24);
  const sample = parsed.rows.slice(0, 8).map((row) => toSummary(row));

  pendingImports.set(token, {
    token,
    ownerId,
    originalFileName,
    temporaryFilePath,
    fileHash,
    createdAt: Date.now(),
    parsed,
    sample,
  });

  return {
    token,
    fileName: originalFileName,
    dataDate: parsed.dataDate,
    rowCount: parsed.rows.length,
    validRowCount: errorCount === 0 ? parsed.rows.length : Math.max(0, parsed.rows.length - errorCount),
    duplicateDate: existingRow.count > 0,
    existingRowCount: existingRow.count,
    embeddedImageCount: parsed.embeddedImageCount,
    remoteImageCount: parsed.remoteImageCount,
    issues: parsed.issues,
    sample,
  };
}

async function storeEmbeddedImageOnly(row: ParsedProductRow): Promise<StoredImage | null> {
  if (!row.embeddedImage) return null;
  try {
    return await storeEmbeddedImage(row.embeddedImage);
  } catch {
    return null;
  }
}

export async function commitPendingImport(
  token: string,
  overwrite: boolean,
  ownerId: number,
): Promise<ImportCommitResponse> {
  cleanExpiredTokens();
  const pending = pendingImports.get(token);
  if (!pending || pending.ownerId !== ownerId) throw new Error('导入预检已过期，请重新上传文件。');
  if (pending.parsed.issues.some((issue) => issue.severity === 'error')) {
    throw new Error('文件存在阻止导入的错误，请修正后重新上传。');
  }

  const existingRows = database
    .prepare('SELECT COUNT(*) AS count FROM daily_metrics WHERE owner_id = ? AND data_date = ?')
    .get(ownerId, pending.parsed.dataDate) as CountRow;
  if (existingRows.count > 0 && !overwrite) {
    throw new Error('该统计日期已有数据，请确认覆盖后再提交。');
  }

  try {
    createUserBackup(ownerId, 'automatic');
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知错误';
    throw new Error(`自动备份失败，已取消本次导入：${reason}`);
  }

  const imageBySpu = new Map<string, StoredImage | null>();
  for (const row of pending.parsed.rows) {
    imageBySpu.set(row.spu, await storeEmbeddedImageOnly(row));
  }

  const storedFileName = `${pending.parsed.dataDate}_${Date.now()}_${path.basename(pending.originalFileName)}`;
  const storedFilePath = path.join(paths.imports, storedFileName);
  await fs.copyFile(pending.temporaryFilePath, storedFilePath);

  const transaction = database.transaction(() => {
    const replacedBatch = database
      .prepare(
        `SELECT id FROM import_batches
        WHERE owner_id = ? AND data_date = ? AND status = 'completed'
        ORDER BY id DESC LIMIT 1`,
      )
      .get(ownerId, pending.parsed.dataDate) as BatchRow | undefined;

    const batchResult = database
      .prepare(
        `INSERT INTO import_batches
        (owner_id, file_name, stored_file_name, file_hash, data_date, row_count, status, issues_json, replaced_batch_id)
        VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      )
      .run(
        ownerId,
        pending.originalFileName,
        storedFileName,
        pending.fileHash,
        pending.parsed.dataDate,
        pending.parsed.rows.length,
        JSON.stringify(pending.parsed.issues),
        replacedBatch?.id ?? null,
      );
    const batchId = Number(batchResult.lastInsertRowid);

    if (existingRows.count > 0) {
      const previousRows = database
        .prepare('SELECT * FROM daily_metrics WHERE owner_id = ? AND data_date = ?')
        .all(ownerId, pending.parsed.dataDate) as Array<Record<string, unknown>>;
      const savePrevious = database.prepare(
        `INSERT INTO import_replaced_metrics
        (owner_id, replacement_batch_id, original_batch_id, data_date, spu, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const previous of previousRows) {
        savePrevious.run(
          ownerId,
          batchId,
          Number(previous.batch_id),
          String(previous.data_date),
          String(previous.spu),
          JSON.stringify(previous),
        );
      }
      database.prepare('DELETE FROM daily_metrics WHERE owner_id = ? AND data_date = ?').run(ownerId, pending.parsed.dataDate);
      if (replacedBatch) {
        database.prepare("UPDATE import_batches SET status = 'rolled_back', rolled_back_at = CURRENT_TIMESTAMP WHERE id = ?").run(replacedBatch.id);
      }
      if (replacedBatch) {
        database.prepare(`
          UPDATE remote_image_tasks SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP,
            completed_at = CURRENT_TIMESTAMP
          WHERE batch_id = ? AND status IN ('pending', 'processing')
        `).run(replacedBatch.id);
      }
    }

    const upsertProduct = database.prepare(
      `INSERT INTO products (owner_id, spu, first_listed_at, image_asset_id, remote_image_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, spu) DO UPDATE SET
         first_listed_at = COALESCE(excluded.first_listed_at, products.first_listed_at),
         image_asset_id = COALESCE(excluded.image_asset_id, products.image_asset_id),
         remote_image_url = COALESCE(excluded.remote_image_url, products.remote_image_url),
         updated_at = CURRENT_TIMESTAMP`,
    );
    const insertMetric = database.prepare(
      `INSERT INTO daily_metrics
       (owner_id, data_date, spu, batch_id, first_listed_at, impressions, clicks, visitors, cart_users,
        orders, detail_paid_buyers, detail_payment_conversion_rate,
        impression_order_conversion_rate, search_impressions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const enqueueRemoteImage = database.prepare(`
      INSERT OR IGNORE INTO remote_image_tasks (owner_id, batch_id, spu, image_url)
      SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM remote_image_tasks
        WHERE owner_id = ? AND spu = ? AND image_url = ? AND status = 'completed'
      )
    `);
    let queuedImageCount = 0;

    for (const row of pending.parsed.rows) {
      const image = imageBySpu.get(row.spu) ?? null;
      upsertProduct.run(ownerId, row.spu, row.firstListedAt, image?.assetId ?? null, row.remoteImageUrl);
      if (!image && row.remoteImageUrl) {
        queuedImageCount += enqueueRemoteImage.run(
          ownerId,
          batchId,
          row.spu,
          row.remoteImageUrl,
          ownerId,
          row.spu,
          row.remoteImageUrl,
        ).changes;
      }
      insertMetric.run(
        ownerId,
        row.date,
        row.spu,
        batchId,
        row.firstListedAt,
        row.impressions,
        row.clicks,
        row.visitors,
        row.cartUsers,
        row.orders,
        row.detailPaidBuyers,
        row.detailPaymentConversionRate,
        row.impressionOrderConversionRate,
        row.searchImpressions,
      );
    }

    return { batchId, queuedImageCount };
  });

  try {
    const { batchId, queuedImageCount } = transaction();
    pendingImports.delete(token);
    await fs.rm(pending.temporaryFilePath, { force: true });
    if (queuedImageCount > 0) notifyImageTaskProcessor();
    return {
      batchId,
      dataDate: pending.parsed.dataDate,
      importedRows: pending.parsed.rows.length,
      replacedRows: existingRows.count,
      imageCount: [...imageBySpu.values()].filter(Boolean).length,
      queuedImageCount,
    };
  } catch (error) {
    await fs.rm(storedFilePath, { force: true });
    throw error;
  }
}
