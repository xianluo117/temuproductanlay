import { afterEach, describe, expect, it } from "vitest";
import { database } from "../database/index.js";
import {
  DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
  getImageDownloadConcurrencySettings,
  updateImageDownloadConcurrencySettings,
} from "./image-download-settings-service.js";

const SETTINGS_KEY = "image_download_concurrency";

function clearSettings(): void {
  database.prepare("DELETE FROM system_settings WHERE key = ?").run(SETTINGS_KEY);
}

afterEach(clearSettings);

describe("image download concurrency settings", () => {
  it("uses default values when settings are missing", () => {
    clearSettings();
    expect(getImageDownloadConcurrencySettings()).toEqual({
      legacyImportConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      globalQueueConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      updatedAt: null,
    });
  });

  it("persists independent concurrency limits", () => {
    const updated = updateImageDownloadConcurrencySettings({
      legacyImportConcurrency: 7,
      globalQueueConcurrency: 23,
    });
    expect(updated).toMatchObject({
      legacyImportConcurrency: 7,
      globalQueueConcurrency: 23,
    });
    expect(updated.updatedAt).toEqual(expect.any(String));
    expect(getImageDownloadConcurrencySettings()).toEqual(updated);
  });

  it("falls back per field when stored JSON is invalid", () => {
    database
      .prepare(
        "INSERT OR REPLACE INTO system_settings (key, value_json) VALUES (?, ?)",
      )
      .run(
        SETTINGS_KEY,
        JSON.stringify({
          legacyImportConcurrency: 0,
          globalQueueConcurrency: 31,
        }),
      );
    expect(getImageDownloadConcurrencySettings()).toMatchObject({
      legacyImportConcurrency: DEFAULT_IMAGE_DOWNLOAD_CONCURRENCY,
      globalQueueConcurrency: 31,
    });
  });

  it.each([
    { legacyImportConcurrency: 0, globalQueueConcurrency: 10 },
    { legacyImportConcurrency: 51, globalQueueConcurrency: 10 },
    { legacyImportConcurrency: 1.5, globalQueueConcurrency: 10 },
    { legacyImportConcurrency: 10, globalQueueConcurrency: 0 },
    { legacyImportConcurrency: 10, globalQueueConcurrency: 51 },
    { legacyImportConcurrency: 10, globalQueueConcurrency: 2.5 },
  ])("rejects out-of-range or non-integer values: %o", (input) => {
    expect(() => updateImageDownloadConcurrencySettings(input)).toThrow(
      "图片下载并发上限必须是 1–50 的整数。",
    );
  });
});
