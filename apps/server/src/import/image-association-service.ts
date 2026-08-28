import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { database } from "../database/index.js";
import { notifyImageTaskProcessor } from "./image-task-service.js";

export type ImageTargetType = "spu" | "skc" | "erp_sku";
export type ImageTargetSource = "traffic" | "lifecycle" | "erp";

interface TaskRow {
  id: number;
  asset_id: number | null;
  file_name: string | null;
}

function clean(value: string | null | undefined): string | null {
  const result = value?.trim() ?? "";
  return result || null;
}

export function normalizeImageUrl(value: string): string | null {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * 为业务对象注册图片来源。相同 URL 全局共用一个下载任务；相同二进制文件
 * 继续由 image_assets.content_hash 合并为单一文件资产。
 */
export function queueImageTarget(input: {
  url: string;
  targetType: ImageTargetType;
  shopId: number | null;
  targetKey: string;
  sourceType: ImageTargetSource;
  priority: number;
}): number | null {
  const url = normalizeImageUrl(input.url);
  const targetKey = clean(input.targetKey);
  if (!url || !targetKey) return null;

  const queue = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO image_download_tasks (normalized_url)
         VALUES (?)
         ON CONFLICT(normalized_url) DO NOTHING`,
      )
      .run(url);
    const task = database
      .prepare(
        `SELECT task.id, task.asset_id, asset.file_name
         FROM image_download_tasks task
         LEFT JOIN image_assets asset ON asset.id = task.asset_id
         WHERE task.normalized_url = ?`,
      )
      .get(url) as TaskRow;
    const reusableAssetId = task.asset_id !== null && task.file_name
      && fs.existsSync(path.join(paths.images, task.file_name))
      ? task.asset_id
      : null;
    if (task.asset_id !== null && reusableAssetId === null) {
      database.prepare(
        `UPDATE image_download_tasks SET status = 'pending', asset_id = NULL,
         attempt_count = 0, last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP,
         started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(task.id);
    }
    // SQLite 的 UNIQUE 允许多条 NULL，因此 ERP 临时目标必须显式查询后再更新。
    const existingTarget = database
      .prepare(
        `SELECT id, task_id, priority FROM image_download_targets
         WHERE target_type = ? AND target_key = ?
           AND ((shop_profile_id = ?) OR (shop_profile_id IS NULL AND ? IS NULL))
         LIMIT 1`,
      )
      .get(input.targetType, targetKey, input.shopId, input.shopId) as
      | { id: number; task_id: number; priority: number }
      | undefined;
    const replaces = !existingTarget || input.priority >= existingTarget.priority;
    if (existingTarget) {
      database
        .prepare(
          `UPDATE image_download_targets SET task_id = CASE WHEN ? THEN ? ELSE task_id END,
           source_type = CASE WHEN ? THEN ? ELSE source_type END,
           priority = MAX(priority, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(replaces ? 1 : 0, task.id, replaces ? 1 : 0, input.sourceType, input.priority, existingTarget.id);
    } else {
      database
        .prepare(
          `INSERT INTO image_download_targets
            (task_id, target_type, shop_profile_id, target_key, source_type, priority)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(task.id, input.targetType, input.shopId, targetKey, input.sourceType, input.priority);
    }
    if (replaces && reusableAssetId !== null) applyAssetToTarget(reusableAssetId, {
      targetType: input.targetType,
      shopId: input.shopId,
      targetKey,
    });
    return task.id;
  });
  const taskId = queue();
  notifyImageTaskProcessor();
  return taskId;
}

function applyAssetToTarget(assetId: number, target: {
  targetType: ImageTargetType;
  shopId: number | null;
  targetKey: string;
}): void {
  if (target.targetType === "spu" && target.shopId !== null) {
    database.prepare(
      `UPDATE products SET image_asset_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE shop_profile_id = ? AND spu = ?`,
    ).run(assetId, target.shopId, target.targetKey);
  } else if (target.targetType === "skc") {
    database.prepare(
      `UPDATE temu_lifecycle_skc_current SET image_asset_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(assetId, Number(target.targetKey));
  } else if (target.targetType === "erp_sku") {
    database.prepare(
      `UPDATE zhihou_new_order_items SET image_asset_id = ?
       WHERE image_target_key = ?
          OR (image_target_key IS NULL AND UPPER(TRIM(zhihou_sku)) = ?)`,
    ).run(assetId, target.targetKey, target.targetKey);
  }
}

/**
 * 生命周期或人工绑定后来出现时，将同一智猴 SKU 的暂存规格图挂到真实 SKC。
 * 不复制文件，也不重新下载；任务已完成时立即回填目标资产。
 */
export function promoteErpSkuImageToSkc(input: {
  zhihouSku: string | null;
  shopId: number;
  skcRowId: number;
}): void {
  const sourceKey = erpSkuImageKey(input.zhihouSku ?? "");
  if (!sourceKey) return;
  const source = database
    .prepare(
      `SELECT task.normalized_url
       FROM image_download_targets target
       JOIN image_download_tasks task ON task.id = target.task_id
       WHERE target.target_type = 'erp_sku'
         AND (
           target.target_key = ?
           OR (
             instr(target.target_key, ':') > 0
             AND substr(target.target_key, instr(target.target_key, ':') + 1) = ?
           )
         )
       ORDER BY target.priority DESC, target.id DESC LIMIT 1`,
    )
    .get(sourceKey, sourceKey) as { normalized_url: string } | undefined;
  if (!source) return;
  queueImageTarget({
    url: source.normalized_url,
    targetType: "skc",
    shopId: input.shopId,
    targetKey: lifecycleSkcImageKey(input.skcRowId),
    sourceType: "erp",
    priority: 200,
  });
}

export function lifecycleSkcImageKey(skcRowId: number): string {
  return String(skcRowId);
}

export function erpSkuImageKey(
  zhihouSku: string,
  syncId?: number,
): string | null {
  const value = clean(zhihouSku)?.toUpperCase() ?? null;
  if (!value) return null;
  return syncId === undefined ? value : `${syncId}:${value}`;
}
