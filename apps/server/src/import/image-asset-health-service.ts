import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { database } from "../database/index.js";

interface ImageAssetFileRow {
  id: number;
  file_name: string;
}

export function imageAssetFileExists(
  assetId: number | null,
  fileName?: string | null,
): boolean {
  if (assetId === null) return false;
  const resolvedFileName = fileName ?? (
    database
      .prepare("SELECT file_name FROM image_assets WHERE id = ?")
      .get(assetId) as { file_name: string } | undefined
  )?.file_name;
  return Boolean(
    resolvedFileName
    && fs.existsSync(path.join(paths.images, resolvedFileName)),
  );
}

/**
 * 清除指向缺失磁盘文件的业务关联，并将所有可恢复的 URL 下载任务重新入队。
 */
export function resetMissingImageAsset(assetId: number): number {
  const asset = database
    .prepare("SELECT id, file_name FROM image_assets WHERE id = ?")
    .get(assetId) as ImageAssetFileRow | undefined;
  if (!asset || imageAssetFileExists(asset.id, asset.file_name)) return 0;

  const reset = database.transaction(() => {
    database
      .prepare(
        `UPDATE products SET image_asset_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE image_asset_id = ?`,
      )
      .run(assetId);
    database
      .prepare(
        `UPDATE temu_lifecycle_skc_current
         SET image_asset_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE image_asset_id = ?`,
      )
      .run(assetId);
    database
      .prepare(
        "UPDATE zhihou_new_order_items SET image_asset_id = NULL WHERE image_asset_id = ?",
      )
      .run(assetId);
    return database
      .prepare(
        `UPDATE image_download_tasks
         SET status = 'pending', asset_id = NULL, attempt_count = 0,
             last_error = NULL, next_attempt_at = CURRENT_TIMESTAMP,
             started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE asset_id = ?`,
      )
      .run(assetId).changes;
  });
  return reset();
}
