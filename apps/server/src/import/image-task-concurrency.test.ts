import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pendingDownloads: Array<{
  url: string;
  resolve: (value: { assetId: number }) => void;
}> = [];

vi.mock("./image-service.js", () => ({
  downloadAndStoreImage: vi.fn((url: string) =>
    new Promise<{ assetId: number }>((resolve) => {
      pendingDownloads.push({ url, resolve });
    }),
  ),
}));

const { database } = await import("../database/index.js");
const {
  startImageTaskProcessor,
  stopImageTaskProcessor,
} = await import("./image-task-service.js");
const { updateImageDownloadConcurrencySettings } = await import(
  "./image-download-settings-service.js"
);

const suffix = Math.random().toString(36).slice(2, 10);
let shopId = 0;
let batchId = 0;
const legacyUrls = Array.from(
  { length: 5 },
  (_, index) => `https://legacy-${suffix}.test/${index}.jpg`,
);
const globalUrls = Array.from(
  { length: 6 },
  (_, index) => `https://global-${suffix}.test/${index}.jpg`,
);

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs)
      throw new Error("等待图片任务调度超时。");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(() => {
  stopImageTaskProcessor();
  updateImageDownloadConcurrencySettings({
    legacyImportConcurrency: 2,
    globalQueueConcurrency: 4,
  });
  const shop = database
    .prepare(
      `INSERT INTO temu_shop_profiles
       (name, account_label, profile_key, cdp_port, fingerprint_seed)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      `Image Concurrency Test ${suffix}`,
      `image-concurrency-${suffix}`,
      `temu/image-concurrency-${suffix}`,
      16103,
      `image-concurrency-fingerprint-${suffix}`,
    );
  shopId = Number(shop.lastInsertRowid);
  database
    .prepare("INSERT INTO products (shop_profile_id, spu) VALUES (?, ?)")
    .run(shopId, `SPU-${suffix}`);
  batchId = Number(
    database
      .prepare(
        `INSERT INTO import_batches
         (shop_profile_id, file_name, stored_file_name, file_hash, data_date,
          row_count, status, issues_json)
         VALUES (?, ?, ?, ?, '2099-02-01', 1, 'completed', '[]')`,
      )
      .run(
        shopId,
        `concurrency-${suffix}.xlsx`,
        `concurrency-${suffix}.xlsx`,
        `concurrency-${suffix}`,
      ).lastInsertRowid,
  );
  const insertLegacy = database.prepare(
    `INSERT INTO remote_image_tasks
     (shop_profile_id, batch_id, spu, image_url, status, next_attempt_at)
     VALUES (?, ?, ?, ?, 'pending', '2000-01-01 00:00:00')`,
  );
  for (const url of legacyUrls)
    insertLegacy.run(shopId, batchId, `SPU-${suffix}`, url);
  const insertGlobal = database.prepare(
    `INSERT INTO image_download_tasks (normalized_url, status, next_attempt_at)
     VALUES (?, 'pending', '2000-01-01 00:00:00')`,
  );
  for (const url of globalUrls) insertGlobal.run(url);
});

afterAll(async () => {
  stopImageTaskProcessor();
  for (const download of pendingDownloads) download.resolve({ assetId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  database
    .prepare("DELETE FROM image_download_tasks WHERE normalized_url LIKE ?")
    .run(`https://global-${suffix}.test/%`);
  database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(shopId);
  database
    .prepare("DELETE FROM system_settings WHERE key = 'image_download_concurrency'")
    .run();
});

describe("image task processor concurrency", () => {
  it("applies independent limits to legacy and global queues", async () => {
    startImageTaskProcessor();
    await waitFor(() => pendingDownloads.length === 6);

    expect(
      pendingDownloads.filter((download) => legacyUrls.includes(download.url)),
    ).toHaveLength(2);
    expect(
      pendingDownloads.filter((download) => globalUrls.includes(download.url)),
    ).toHaveLength(4);

    const legacyProcessing = database
      .prepare(
        `SELECT COUNT(*) AS count FROM remote_image_tasks
         WHERE batch_id = ? AND status = 'processing'`,
      )
      .get(batchId) as { count: number };
    const globalProcessing = database
      .prepare(
        `SELECT COUNT(*) AS count FROM image_download_tasks
         WHERE normalized_url LIKE ? AND status = 'processing'`,
      )
      .get(`https://global-${suffix}.test/%`) as { count: number };
    expect(legacyProcessing.count).toBe(2);
    expect(globalProcessing.count).toBe(4);
  });
});
