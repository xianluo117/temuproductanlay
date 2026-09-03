import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { paths } from "../config.js";
import { database } from "../database/index.js";
import { resetMissingImageAsset } from "../import/image-asset-health-service.js";
import { queueImageTarget } from "../import/image-association-service.js";
import { stopImageTaskProcessor } from "../import/image-task-service.js";
import { storeTrafficPage } from "./traffic-sync-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
const spu = `TRAFFIC-IMAGE-${suffix}`;
const imageUrl = `https://images.example.invalid/${suffix}.jpg`;
let shopId = 0;
let syncId = 0;

beforeAll(() => {
  stopImageTaskProcessor();
  shopId = Number(
    database
      .prepare(
        `INSERT INTO temu_shop_profiles
         (name, account_label, profile_key, cdp_port, fingerprint_seed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        `Traffic Image ${suffix}`,
        `traffic-image-${suffix}`,
        `temu/traffic-image-${suffix}`,
        17103,
        `traffic-image-fingerprint-${suffix}`,
      ).lastInsertRowid,
  );
  const admin = database
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number };
  syncId = Number(
    database
      .prepare(
        `INSERT INTO traffic_sync_batches
         (shop_profile_id, requested_by_user_id, time_dimension, page_size, status)
         VALUES (?, ?, 0, 50, 'running')`,
      )
      .run(shopId, admin.id).lastInsertRowid,
  );
});

afterAll(() => {
  database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(shopId);
});

describe("Temu 流量图片关联", () => {
  it("识别流量接口返回的首次加入站点时间，并保留已有日期", () => {
    const dateSpu = `${spu}-DATE`;
    const page = {
      syncId,
      pageNumber: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      requestBody: {},
      httpStatus: 200,
      durationMs: 10,
      payload: {},
      items: [{
        spu: dateSpu,
        dataDate: "2099-02-02",
        firstBindSiteTimeStr: "2026-05-07 14:30:04.316",
        firstBindSiteTime: 1778135404000,
      }],
    };
    storeTrafficPage(shopId, page);

    const values = database
      .prepare(
        `SELECT p.first_listed_at AS product_date,
                m.first_listed_at AS metric_date
         FROM products p
         JOIN daily_metrics m
           ON m.shop_profile_id = p.shop_profile_id AND m.spu = p.spu
         WHERE p.shop_profile_id = ? AND p.spu = ?`,
      )
      .get(shopId, dateSpu) as { product_date: string; metric_date: string };
    expect(values).toEqual({
      product_date: "2026-05-07",
      metric_date: "2026-05-07",
    });

    storeTrafficPage(shopId, {
      ...page,
      items: [{ spu: dateSpu, dataDate: "2099-02-03" }],
    });
    const preserved = database
      .prepare("SELECT first_listed_at FROM products WHERE shop_profile_id = ? AND spu = ?")
      .get(shopId, dateSpu) as { first_listed_at: string };
    expect(preserved.first_listed_at).toBe("2026-05-07");
  });

  it("映射 Temu 商品流量字段并计算加购率所需数据", () => {
    const metricSpu = `${spu}-METRIC`;
    storeTrafficPage(shopId, {
      syncId,
      pageNumber: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      requestBody: {},
      httpStatus: 200,
      durationMs: 10,
      payload: {},
      items: [{
        spu: metricSpu,
        dataDate: "2099-02-03",
        goodsVisitorsUserNum: 156,
        cartCrtUserNum: 23,
        fullPaymentUserNum: 13,
        businessDetailPaymentUserNum: 6,
        searchExposeNum: 632,
      }],
    });

    const values = database
      .prepare(
        `SELECT visitors, cart_users, detail_paid_buyers, search_impressions
         FROM daily_metrics WHERE shop_profile_id = ? AND spu = ?`,
      )
      .get(shopId, metricSpu) as {
      visitors: number;
      cart_users: number;
      detail_paid_buyers: number;
      search_impressions: number;
    };
    expect(values).toEqual({
      visitors: 156,
      cart_users: 23,
      detail_paid_buyers: 13,
      search_impressions: 632,
    });
  });

  it("优先使用 Temu 的完成付款用户数作为支付买家", () => {
    const paidSpu = `${spu}-PAID`;
    storeTrafficPage(shopId, {
      syncId, pageNumber: 1, pageSize: 50, total: 1, totalPages: 1,
      requestBody: {}, httpStatus: 200, durationMs: 10, payload: {},
      items: [{ spu: paidSpu, dataDate: "2099-02-05", fullPaymentUserNum: 13, businessDetailPaymentUserNum: 6 }],
    });
    const row = database.prepare("SELECT detail_paid_buyers FROM daily_metrics WHERE shop_profile_id = ? AND spu = ?").get(shopId, paidSpu) as { detail_paid_buyers: number };
    expect(row.detail_paid_buyers).toBe(13);
  });

  it("分别存储 Temu 的商详支付、点击订单和曝光订单转化率", () => {
    const rateSpu = `${spu}-RATE`;
    storeTrafficPage(shopId, {
      syncId,
      pageNumber: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      requestBody: {},
      httpStatus: 200,
      durationMs: 10,
      payload: {},
      items: [{
        spu: rateSpu,
        dataDate: "2099-02-04",
        impressionCount: 323,
        clickCount: 32,
        orderPayOrderNum: 3,
        businessDetailPaymentUserRate: 2.5,
        clickOrderRatio: 9.375,
        orderPayImpressionRate: 0.928792569659443,
      }],
    });

    const rates = database
      .prepare(
        `SELECT detail_payment_conversion_rate, click_order_conversion_rate,
                impression_order_conversion_rate
         FROM daily_metrics WHERE shop_profile_id = ? AND spu = ?`,
      )
      .get(shopId, rateSpu) as {
      detail_payment_conversion_rate: number;
      click_order_conversion_rate: number;
      impression_order_conversion_rate: number;
    };
    expect(rates.detail_payment_conversion_rate).toBeCloseTo(0.025);
    expect(rates.click_order_conversion_rate).toBeCloseTo(0.09375);
    expect(rates.impression_order_conversion_rate).toBeCloseTo(3 / 323);
  });

  it("按店铺和 SPU 创建全局下载目标，并复用同 URL 任务", () => {
    const page = {
      syncId,
      pageNumber: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      requestBody: {},
      httpStatus: 200,
      durationMs: 10,
      payload: {},
      items: [{ spu, imageUrl, dataDate: "2099-02-01" }],
    };
    storeTrafficPage(shopId, page);
    storeTrafficPage(shopId, page);

    const product = database
      .prepare(
        "SELECT remote_image_url FROM products WHERE shop_profile_id = ? AND spu = ?",
      )
      .get(shopId, spu) as { remote_image_url: string };
    expect(product.remote_image_url).toBe(imageUrl);

    const taskCount = database
      .prepare(
        "SELECT COUNT(*) AS count FROM image_download_tasks WHERE normalized_url = ?",
      )
      .get(imageUrl) as { count: number };
    expect(taskCount.count).toBe(1);

    const target = database
      .prepare(
        `SELECT source_type, priority FROM image_download_targets
         WHERE target_type = 'spu' AND shop_profile_id = ? AND target_key = ?`,
      )
      .get(shopId, spu) as { source_type: string; priority: number };
    expect(target).toEqual({ source_type: "traffic", priority: 300 });
  });

  it("已有完整本地文件时立即复用资产", () => {
    const reuseSpu = `${spu}-REUSE`;
    database
      .prepare("INSERT INTO products (shop_profile_id, spu) VALUES (?, ?)")
      .run(shopId, reuseSpu);
    const fileName = `${suffix}.jpg`;
    fs.writeFileSync(path.join(paths.images, fileName), Buffer.from("existing-image"));
    const assetId = Number(
      database
        .prepare(
          `INSERT INTO image_assets
           (content_hash, file_name, mime_type, byte_size, source_type, source_url)
           VALUES (?, ?, 'image/jpeg', 14, 'remote', ?)`,
        )
        .run(`hash-${suffix}`, fileName, imageUrl).lastInsertRowid,
    );
    database
      .prepare(
        `UPDATE image_download_tasks SET status = 'completed', asset_id = ?,
         completed_at = CURRENT_TIMESTAMP WHERE normalized_url = ?`,
      )
      .run(assetId, imageUrl);

    queueImageTarget({
      url: imageUrl,
      targetType: "spu",
      shopId,
      targetKey: reuseSpu,
      sourceType: "traffic",
      priority: 300,
    });

    const product = database
      .prepare(
        "SELECT image_asset_id FROM products WHERE shop_profile_id = ? AND spu = ?",
      )
      .get(shopId, reuseSpu) as { image_asset_id: number };
    expect(product.image_asset_id).toBe(assetId);
  });

  it("数据库资产存在但文件缺失时清除失效关联并重新入队", () => {
    const missingSpu = `${spu}-MISSING`;
    database
      .prepare("INSERT INTO products (shop_profile_id, spu) VALUES (?, ?)")
      .run(shopId, missingSpu);
    const missingUrl = `${imageUrl}?missing=1`;
    const assetId = Number(
      database
        .prepare(
          `INSERT INTO image_assets
           (content_hash, file_name, mime_type, byte_size, source_type, source_url)
           VALUES (?, ?, 'image/jpeg', 1, 'remote', ?)`,
        )
        .run(`missing-hash-${suffix}`, `missing-${suffix}.jpg`, missingUrl)
        .lastInsertRowid,
    );
    const taskId = Number(
      database
        .prepare(
          `INSERT INTO image_download_tasks
           (normalized_url, status, asset_id, completed_at)
           VALUES (?, 'completed', ?, CURRENT_TIMESTAMP)`,
        )
        .run(missingUrl, assetId).lastInsertRowid,
    );
    database
      .prepare(
        `INSERT INTO image_download_targets
         (task_id, target_type, shop_profile_id, target_key, source_type, priority)
         VALUES (?, 'spu', ?, ?, 'traffic', 300)`,
      )
      .run(taskId, shopId, missingSpu);
    database
      .prepare(
        "UPDATE products SET image_asset_id = ?, remote_image_url = ? WHERE shop_profile_id = ? AND spu = ?",
      )
      .run(assetId, missingUrl, shopId, missingSpu);

    expect(resetMissingImageAsset(assetId)).toBe(1);
    const task = database
      .prepare("SELECT status, asset_id FROM image_download_tasks WHERE id = ?")
      .get(taskId) as { status: string; asset_id: number | null };
    expect(task).toEqual({ status: "pending", asset_id: null });
    const product = database
      .prepare(
        "SELECT image_asset_id FROM products WHERE shop_profile_id = ? AND spu = ?",
      )
      .get(shopId, missingSpu) as { image_asset_id: number | null };
    expect(product.image_asset_id).toBeNull();
  });
});
