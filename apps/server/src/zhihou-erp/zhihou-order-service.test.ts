import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { database } from "../database/index.js";
import {
  decryptZhihouPassword,
  encryptZhihouPassword,
} from "./credential-crypto.js";
import {
  getZhihouOrderReferences,
  getZhihouOrderSummary,
} from "./order-summary-service.js";
import { matchZhihouSku } from "./sku-match-service.js";

const createdRecordIds: number[] = [];
const createdSyncIds: number[] = [];

function firstShopId(): number {
  const row = database
    .prepare("SELECT id FROM temu_shop_profiles ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!row) throw new Error("测试需要至少一个 Temu 店铺档案。");
  return row.id;
}

function adminId(): number {
  const row = database
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!row) throw new Error("测试需要管理员账号。");
  return row.id;
}

function createProductBinding(sku: string, parentSpu: string): number {
  const recordId = Number(
    database
      .prepare(
        `INSERT INTO product_management_records
          (shop_profile_id, created_by_user_id, product_code, source_type)
         VALUES (?, ?, ?, 'manual')`,
      )
      .run(firstShopId(), adminId(), `ZH-TEST-${sku}`).lastInsertRowid,
  );
  createdRecordIds.push(recordId);
  const linkId = Number(
    database
      .prepare(
        `INSERT INTO product_management_spu_links (record_id, spu)
         VALUES (?, ?)`,
      )
      .run(recordId, parentSpu).lastInsertRowid,
  );
  database
    .prepare(
      `INSERT INTO product_management_bindings (spu_link_id, sku_id, sku_code)
       VALUES (?, ?, ?)`,
    )
    .run(linkId, sku, `CODE-${sku}`);
  database
    .prepare(
      `INSERT INTO product_management_purchase_links (record_id, url, sort_order)
       VALUES (?, ?, 0)`,
    )
    .run(recordId, `https://source.example/${encodeURIComponent(sku)}`);
  return recordId;
}

function createLifecycleSpecification(input: {
  sku: string;
  parentSpu: string;
  color: string | null;
  size: string | null;
  siblingSkus?: Array<{ sku: string; size: string }>;
}): void {
  const shopId = firstShopId();
  const batchId = Number(
    database
      .prepare(
        `INSERT INTO temu_lifecycle_sync_batches
          (shop_profile_id, requested_by_user_id, page_size, status,
           total_pages, total_spus, total_skcs, total_skus, completed_at)
         VALUES (?, ?, 50, 'completed', 1, 1, 1, 1, CURRENT_TIMESTAMP)`,
      )
      .run(shopId, adminId()).lastInsertRowid,
  );
  const spuRowId = Number(
    database
      .prepare(
        `INSERT INTO temu_lifecycle_spu_current
          (shop_profile_id, sync_batch_id, spu, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(shopId, batchId, input.parentSpu).lastInsertRowid,
  );
  const skcRowId = Number(
    database
      .prepare(
        `INSERT INTO temu_lifecycle_skc_current
          (spu_row_id, sync_batch_id, skc_id, skc_code, attribute_json, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        spuRowId,
        batchId,
        `SKC-${input.sku}`,
        `SKC-CODE-${input.sku}`,
        input.color ? JSON.stringify([{ name: "颜色", value: input.color }]) : null,
      ).lastInsertRowid,
  );
  const insertSku = database.prepare(
    `INSERT INTO temu_lifecycle_sku_current
      (skc_row_id, sync_batch_id, sku_id, sku_code, size_name,
       specification_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  );
  insertSku.run(
    skcRowId,
    batchId,
    input.sku,
    `CODE-${input.sku}`,
    input.size,
    input.size ? JSON.stringify([{ name: "尺码", value: input.size }]) : null,
  );
  for (const sibling of input.siblingSkus ?? []) {
    insertSku.run(
      skcRowId,
      batchId,
      sibling.sku,
      `CODE-${input.sku}`,
      sibling.size,
      JSON.stringify([{ name: "尺码", value: sibling.size }]),
    );
  }
}

function matrixCells(summary: ReturnType<typeof getZhihouOrderSummary>) {
  return summary.matrices.flatMap((matrix) =>
    matrix.colorRows.flatMap((row) => Object.values(row.cells)),
  );
}

function createCompletedSync(input: {
  sku: string;
  color: string;
  size: string;
  quantities: number[];
}): number {
  const syncId = Number(
    database
      .prepare(
        `INSERT INTO zhihou_order_sync_batches
          (requested_by_user_id, status, page_count, order_count, item_count,
           started_at, completed_at)
         VALUES (?, 'completed', 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
      .run(adminId(), input.quantities.length, input.quantities.length)
      .lastInsertRowid,
  );
  createdSyncIds.push(syncId);
  input.quantities.forEach((quantity, index) => {
    const orderNo = `ZH-ORDER-${syncId}-${index}`;
    const orderId = Number(
      database
        .prepare(
          `INSERT INTO zhihou_new_orders
            (sync_batch_id, erp_order_id, order_no, store_name, country_code)
           VALUES (?, ?, ?, '测试店铺', 'US')`,
        )
        .run(syncId, String(10_000_000_000_000_000n + BigInt(index)), orderNo)
        .lastInsertRowid,
    );
    database
      .prepare(
        `INSERT INTO zhihou_new_order_items
          (sync_batch_id, order_id, external_item_key, zhihou_sku, color, size,
           quantity, specification_image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        syncId,
        orderId,
        `${orderNo}:item`,
        input.sku,
        input.color,
        input.size,
        quantity,
        "https://images.example/color.jpg",
      );
  });
  return syncId;
}

afterEach(() => {
  for (const syncId of createdSyncIds.splice(0))
    database
      .prepare("DELETE FROM zhihou_order_sync_batches WHERE id = ?")
      .run(syncId);
  for (const recordId of createdRecordIds.splice(0))
    database
      .prepare("DELETE FROM product_management_records WHERE id = ?")
      .run(recordId);
});

describe("智猴凭据与新订单汇总", () => {
  it("使用认证加密保存密码并拒绝篡改密文", () => {
    config.zhihouCredentialKey = randomBytes(32).toString("base64");
    const encrypted = encryptZhihouPassword("Secret-123");
    expect(encrypted).not.toContain("Secret-123");
    expect(decryptZhihouPassword(encrypted)).toBe("Secret-123");
    const parts = encrypted.split(".");
    parts[2] = `${parts[2]![0] === "A" ? "B" : "A"}${parts[2]!.slice(1)}`;
    expect(() => decryptZhihouPassword(parts.join("."))).toThrow(
      "智猴密码解密失败",
    );
  });

  it("优先使用 SKU ID 匹配并回溯上级 SPU 与货源链接", () => {
    const sku = `UNIQUE-SKU-${Date.now()}`;
    const recordId = createProductBinding(sku, "PARENT-SPU-001");
    const result = matchZhihouSku(sku.toLowerCase());
    expect(result.status).toBe("matched");
    expect(result.matchType).toBe("sku_id");
    expect(result.productManagementRecordId).toBe(recordId);
    expect(result.parentSpu).toBe("PARENT-SPU-001");
    expect(result.purchaseLinks).toEqual([
      `https://source.example/${encodeURIComponent(sku)}`,
    ]);
  });

  it("按上级 SPU、颜色和尺码汇总件数并返回关联订单", () => {
    const sku = `SUMMARY-SKU-${Date.now()}`;
    createProductBinding(sku, "PARENT-SPU-002");
    createCompletedSync({
      sku,
      color: "黑色",
      size: "L",
      quantities: [2, 3],
    });
    const summary = getZhihouOrderSummary();
    const row = matrixCells(summary).find((item) => item.zhihouSkus.includes(sku));
    expect(summary.matrices[0]?.requiredQuantity).toBe(5);
    expect(summary.matrices[0]?.colorRows[0]?.requiredQuantity).toBe(5);
    expect(row).toMatchObject({
      parentSpu: "PARENT-SPU-002",
      color: "黑色",
      size: "L",
      requiredQuantity: 5,
      matchStatus: "matched",
      orderCount: 2,
    });
    const references = getZhihouOrderReferences(row!.key);
    expect(references.orders).toHaveLength(2);
    expect(references.orders.reduce((sum, item) => sum + item.quantity, 0)).toBe(
      5,
    );
  });

  it("生命周期颜色和尺码优先于订单规格", () => {
    const sku = `LIFECYCLE-SKU-${Date.now()}`;
    const parentSpu = `PARENT-SPU-LIFECYCLE-${Date.now()}`;
    createProductBinding(sku, parentSpu);
    createLifecycleSpecification({ sku, parentSpu, color: "军绿色", size: "XL" });
    createCompletedSync({
      sku,
      color: "订单黑色",
      size: "订单L",
      quantities: [4],
    });

    const summary = getZhihouOrderSummary();
    const row = matrixCells(summary).find((item) => item.zhihouSkus.includes(sku));
    expect(row).toMatchObject({
      color: "军绿色",
      size: "XL",
      requiredQuantity: 4,
      matchStatus: "matched",
    });
    expect(summary.matrices[0]?.colorRows[0]).toMatchObject({
      color: "军绿色",
      requiredQuantity: 4,
    });
    expect(summary.matrices[0]?.sizes).toEqual(["XL"]);
  });

  it("生命周期规格缺失时使用订单颜色和尺码兜底", () => {
    const sku = `FALLBACK-SKU-${Date.now()}`;
    const parentSpu = `PARENT-SPU-FALLBACK-${Date.now()}`;
    createProductBinding(sku, parentSpu);
    createLifecycleSpecification({ sku, parentSpu, color: null, size: null });
    createCompletedSync({
      sku,
      color: "订单蓝色",
      size: "订单M",
      quantities: [2],
    });

    const summary = getZhihouOrderSummary();
    const row = matrixCells(summary).find((item) => item.zhihouSkus.includes(sku));
    expect(row).toMatchObject({ color: "订单蓝色", size: "订单M", requiredQuantity: 2 });
  });

  it("SKU ID 唯一命中时不把同一 SKC 的兄弟尺码判定为冲突", () => {
    const sku = `EXACT-SKU-${Date.now()}`;
    const parentSpu = `PARENT-SPU-EXACT-${Date.now()}`;
    createProductBinding(sku, parentSpu);
    createLifecycleSpecification({
      sku,
      parentSpu,
      color: "土黄色",
      size: "M",
      siblingSkus: [
        { sku: `${sku}-S`, size: "S" },
        { sku: `${sku}-L`, size: "L" },
        { sku: `${sku}-XL`, size: "XL" },
      ],
    });
    createCompletedSync({ sku, color: "订单颜色", size: "订单尺码", quantities: [1] });

    const summary = getZhihouOrderSummary();
    const row = matrixCells(summary).find((item) => item.zhihouSkus.includes(sku));
    expect(row).toMatchObject({
      color: "土黄色",
      size: "M",
      matchStatus: "matched",
      requiredQuantity: 1,
    });
    expect(summary.conflictRowCount).toBe(0);
    expect(summary.matrices[0]?.sizes).toEqual(["M"]);
  });
});
