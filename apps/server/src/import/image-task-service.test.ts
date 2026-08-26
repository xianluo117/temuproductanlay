import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../database/index.js";
import {
  getBatchImageProgress,
  stopImageTaskProcessor,
} from "./image-task-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
const spu = `__image_task_test_spu_${suffix}__`;
let shopId = 0;
let batchId = 0;

beforeAll(() => {
  stopImageTaskProcessor();
  const shop = database
    .prepare(
      `INSERT INTO temu_shop_profiles
       (name, account_label, profile_key, cdp_port, fingerprint_seed)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      `Image Task Test ${suffix}`,
      `image-task-${suffix}`,
      `temu/image-task-${suffix}`,
      15103,
      `image-task-fingerprint-${suffix}`,
    );
  shopId = Number(shop.lastInsertRowid);
  database
    .prepare("INSERT INTO products (shop_profile_id, spu) VALUES (?, ?)")
    .run(shopId, spu);
  const result = database
    .prepare(
      `INSERT INTO import_batches
       (shop_profile_id, file_name, stored_file_name, file_hash, data_date,
        row_count, status, issues_json)
       VALUES (?, 'task-test.xlsx', 'task-test.xlsx', ?, '2099-01-01', 1,
        'completed', '[]')`,
    )
    .run(shopId, `task-test-${suffix}`);
  batchId = Number(result.lastInsertRowid);
});

afterAll(() => {
  database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(shopId);
});

describe("remote image task progress", () => {
  it("returns completed progress for a batch without tasks", () => {
    expect(getBatchImageProgress(batchId, shopId)).toEqual({
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      percent: 100,
    });
  });

  it("aggregates all task statuses within the shop", () => {
    const insert = database.prepare(
      `INSERT INTO remote_image_tasks
       (shop_profile_id, batch_id, spu, image_url, status)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run(shopId, batchId, spu, "https://example.test/1.jpg", "pending");
    insert.run(
      shopId,
      batchId,
      spu,
      "https://example.test/2.jpg",
      "processing",
    );
    insert.run(shopId, batchId, spu, "https://example.test/3.jpg", "completed");
    insert.run(shopId, batchId, spu, "https://example.test/4.jpg", "failed");
    insert.run(shopId, batchId, spu, "https://example.test/5.jpg", "cancelled");

    expect(getBatchImageProgress(batchId, shopId)).toEqual({
      total: 5,
      pending: 1,
      processing: 1,
      completed: 1,
      failed: 1,
      cancelled: 1,
      percent: 60,
    });
  });
});
