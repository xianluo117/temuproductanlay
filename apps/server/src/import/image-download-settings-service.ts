import type {
  ImageDownloadConcurrencySettings,
  ImageDownloadConcurrencySettingsInput,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";

const SETTINGS_KEY = "image_download_concurrency";
export const DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY = 10;
export const MIN_IMAGE_DOWNLOAD_CONCURRENCY = 1;
export const MAX_IMAGE_DOWNLOAD_CONCURRENCY = 50;

interface SettingsRow {
  value_json: string;
  updated_at: string;
}

function validConcurrency(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_IMAGE_DOWNLOAD_CONCURRENCY &&
    value <= MAX_IMAGE_DOWNLOAD_CONCURRENCY
  );
}

export function getImageDownloadConcurrencySettings(): ImageDownloadConcurrencySettings {
  const row = database
    .prepare("SELECT value_json, updated_at FROM system_settings WHERE key = ?")
    .get(SETTINGS_KEY) as SettingsRow | undefined;
  if (!row) {
    return {
      legacyImportConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      globalQueueConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      updatedAt: null,
    };
  }

  try {
    const parsed = JSON.parse(row.value_json) as Partial<ImageDownloadConcurrencySettingsInput>;
    return {
      legacyImportConcurrency: validConcurrency(parsed.legacyImportConcurrency)
        ? parsed.legacyImportConcurrency
        : DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      globalQueueConcurrency: validConcurrency(parsed.globalQueueConcurrency)
        ? parsed.globalQueueConcurrency
        : DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      updatedAt: row.updated_at,
    };
  } catch {
    return {
      legacyImportConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      globalQueueConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      updatedAt: row.updated_at,
    };
  }
}

export function updateImageDownloadConcurrencySettings(
  input: ImageDownloadConcurrencySettingsInput,
): ImageDownloadConcurrencySettings {
  if (
    !validConcurrency(input.legacyImportConcurrency) ||
    !validConcurrency(input.globalQueueConcurrency)
  ) {
    throw new Error("图片下载并发上限必须是 1–50 的整数。");
  }

  database
    .prepare(
      `INSERT INTO system_settings (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(SETTINGS_KEY, JSON.stringify(input));
  return getImageDownloadConcurrencySettings();
}
