import type { ImageTaskProgress } from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { getImageDownloadConcurrencySettings } from "./image-download-settings-service.js";
import { downloadAndStoreImage } from "./image-service.js";

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

interface TaskRow {
  id: number;
  shop_profile_id: number;
  batch_id: number;
  spu: string;
  image_url: string;
  attempt_count: number;
}

interface ProgressRow {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
}

interface GlobalTaskRow {
  id: number;
  normalized_url: string;
  attempt_count: number;
}

let activeCount = 0;
let globalActiveCount = 0;
let timer: NodeJS.Timeout | null = null;
let stopped = false;

function emptyProgress(): ImageTaskProgress {
  return {
    total: 0,
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    percent: 100,
  };
}

export function getBatchImageProgress(
  batchId: number,
  shopId?: number,
): ImageTaskProgress {
  const row = database
    .prepare(
      `
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM remote_image_tasks WHERE batch_id = ? AND (? IS NULL OR shop_profile_id = ?)
  `,
    )
    .get(batchId, shopId ?? null, shopId ?? null) as ProgressRow;
  if (row.total === 0) return emptyProgress();
  const finished = row.completed + row.failed + row.cancelled;
  return { ...row, percent: Math.round((finished / row.total) * 100) };
}

function schedule(delayMs = 0): void {
  if (stopped || timer) return;
  timer = setTimeout(() => {
    timer = null;
    pump();
    pumpGlobalTasks();
  }, delayMs);
  timer.unref();
}

function claimTask(): TaskRow | null {
  const transaction = database.transaction(() => {
    const task = database
      .prepare(
        `
      SELECT id, shop_profile_id, batch_id, spu, image_url, attempt_count
      FROM remote_image_tasks
      WHERE status = 'pending' AND julianday(next_attempt_at) <= julianday(CURRENT_TIMESTAMP)
      ORDER BY next_attempt_at, id LIMIT 1
    `,
      )
      .get() as TaskRow | undefined;
    if (!task) return null;
    const result = database
      .prepare(
        `
      UPDATE remote_image_tasks
      SET status = 'processing', attempt_count = attempt_count + 1,
        started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `,
      )
      .run(task.id);
    return result.changes === 1
      ? { ...task, attempt_count: task.attempt_count + 1 }
      : null;
  });
  return transaction();
}

function completeTask(task: TaskRow, assetId: number): void {
  const transaction = database.transaction(() => {
    const result = database
      .prepare(
        `
      UPDATE remote_image_tasks SET status = 'completed', last_error = NULL,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing'
    `,
      )
      .run(task.id);
    if (result.changes === 0) return;
    database
      .prepare(
        `
      UPDATE products SET image_asset_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE shop_profile_id = ? AND spu = ? AND NOT EXISTS (
        SELECT 1 FROM image_assets current_asset
        WHERE current_asset.id = products.image_asset_id AND current_asset.source_type = 'embedded'
      )
    `,
      )
      .run(assetId, task.shop_profile_id, task.spu);
  });
  transaction();
}

function failTask(task: TaskRow, reason: string): void {
  if (task.attempt_count >= MAX_ATTEMPTS) {
    database
      .prepare(
        `
      UPDATE remote_image_tasks SET status = 'failed', last_error = ?,
        completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'processing'
    `,
      )
      .run(reason, task.id);
    return;
  }
  const delayMs =
    RETRY_DELAYS_MS[Math.max(0, task.attempt_count - 1)] ??
    RETRY_DELAYS_MS.at(-1)!;
  const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
  database
    .prepare(
      `
    UPDATE remote_image_tasks SET status = 'pending', last_error = ?, next_attempt_at = datetime(?),
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'processing'
  `,
    )
    .run(reason, nextAttemptAt, task.id);
}

async function processTask(task: TaskRow): Promise<void> {
  try {
    const image = await downloadAndStoreImage(task.image_url);
    if (!image) throw new Error("图片下载失败或响应内容不是有效图片。");
    completeTask(task, image.assetId);
  } catch (error) {
    failTask(
      task,
      error instanceof Error ? error.message : "未知图片下载错误。",
    );
  } finally {
    activeCount -= 1;
    schedule();
  }
}

function hasGlobalImageTaskSchema(): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'image_download_tasks'",
      )
      .get(),
  );
}

function claimGlobalTask(): GlobalTaskRow | null {
  if (!hasGlobalImageTaskSchema()) return null;
  const transaction = database.transaction(() => {
    const task = database
      .prepare(
        `SELECT id, normalized_url, attempt_count FROM image_download_tasks
         WHERE status = 'pending' AND julianday(next_attempt_at) <= julianday(CURRENT_TIMESTAMP)
         ORDER BY next_attempt_at, id LIMIT 1`,
      )
      .get() as GlobalTaskRow | undefined;
    if (!task) return null;
    const result = database
      .prepare(
        `UPDATE image_download_tasks SET status = 'processing',
         attempt_count = attempt_count + 1, started_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`,
      )
      .run(task.id);
    return result.changes === 1
      ? { ...task, attempt_count: task.attempt_count + 1 }
      : null;
  });
  return transaction();
}

function completeGlobalTask(task: GlobalTaskRow, assetId: number): void {
  const transaction = database.transaction(() => {
    database
      .prepare(
        `UPDATE image_download_tasks SET status = 'completed', asset_id = ?,
         last_error = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'processing'`,
      )
      .run(assetId, task.id);
    const targets = database
      .prepare(
        `SELECT target_type, shop_profile_id, target_key
         FROM image_download_targets WHERE task_id = ?`,
      )
      .all(task.id) as Array<{
      target_type: 'spu' | 'skc' | 'erp_sku';
      shop_profile_id: number | null;
      target_key: string;
    }>;
    for (const target of targets) {
      if (target.target_type === 'spu' && target.shop_profile_id !== null) {
        database.prepare(
          `UPDATE products SET image_asset_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE shop_profile_id = ? AND spu = ?`,
        ).run(assetId, target.shop_profile_id, target.target_key);
      } else if (target.target_type === 'skc') {
        database.prepare(
          `UPDATE temu_lifecycle_skc_current SET image_asset_id = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(assetId, Number(target.target_key));
      } else if (target.target_type === 'erp_sku') {
        database.prepare(
          `UPDATE zhihou_new_order_items SET image_asset_id = ?
           WHERE image_target_key = ?
              OR (image_target_key IS NULL AND UPPER(TRIM(zhihou_sku)) = ?)`,
        ).run(assetId, target.target_key, target.target_key);
      }
    }
  });
  transaction();
}

function failGlobalTask(task: GlobalTaskRow, reason: string): void {
  if (task.attempt_count >= MAX_ATTEMPTS) {
    database.prepare(
      `UPDATE image_download_tasks SET status = 'failed', last_error = ?,
       completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'processing'`,
    ).run(reason, task.id);
    return;
  }
  const delayMs = RETRY_DELAYS_MS[Math.max(0, task.attempt_count - 1)] ?? RETRY_DELAYS_MS.at(-1)!;
  database.prepare(
    `UPDATE image_download_tasks SET status = 'pending', last_error = ?,
     next_attempt_at = datetime(?), updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'processing'`,
  ).run(reason, new Date(Date.now() + delayMs).toISOString(), task.id);
}

async function processGlobalTask(task: GlobalTaskRow): Promise<void> {
  try {
    const image = await downloadAndStoreImage(task.normalized_url);
    if (!image) throw new Error('图片下载失败或响应内容不是有效图片。');
    completeGlobalTask(task, image.assetId);
  } catch (error) {
    failGlobalTask(task, error instanceof Error ? error.message : '未知图片下载错误。');
  } finally {
    globalActiveCount -= 1;
    schedule();
  }
}

function pumpGlobalTasks(): void {
  if (stopped || !hasGlobalImageTaskSchema()) return;
  const { globalQueueConcurrency } = getImageDownloadConcurrencySettings();
  while (globalActiveCount < globalQueueConcurrency) {
    const task = claimGlobalTask();
    if (!task) break;
    globalActiveCount += 1;
    void processGlobalTask(task);
  }
  if (globalActiveCount === 0) schedule(2_000);
}

function pump(): void {
  if (stopped) return;
  const { legacyImportConcurrency } = getImageDownloadConcurrencySettings();
  while (activeCount < legacyImportConcurrency) {
    const task = claimTask();
    if (!task) break;
    activeCount += 1;
    void processTask(task);
  }
  if (activeCount === 0) schedule(2_000);
}

export function startImageTaskProcessor(): void {
  stopped = false;
  database
    .prepare(
      `
    UPDATE remote_image_tasks SET status = 'pending', next_attempt_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE status = 'processing'
  `,
    )
    .run();
  if (hasGlobalImageTaskSchema()) {
    database
      .prepare(
        `UPDATE image_download_tasks SET status = 'pending', next_attempt_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE status = 'processing'`,
      )
      .run();
  }
  schedule();
}

export function notifyImageTaskProcessor(): void {
  if (stopped) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  schedule();
}

export function stopImageTaskProcessor(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
