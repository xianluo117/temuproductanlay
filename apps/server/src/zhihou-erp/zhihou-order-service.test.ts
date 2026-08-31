import type { UserAccount } from "@temu-analytics/shared";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { database } from "../database/index.js";
import {
  deleteY2Inventory,
  zhihouInventoryPickOptions,
} from "../inventory/y2-inventory-service.js";
import { deleteZhihouStockPick } from "./stock-pick-service.js";
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
const createdInventoryProductIds: number[] = [];

function firstShopId(): number {
  const row = database
    .prepare("SELECT id FROM temu_shop_profiles ORDER BY id LIMIT 1")
    .get() as { id: number } | undefined;
  if (!row) throw new Error("测试需要至少一个 Temu 店铺档案。");
  return row.id;
}

function adminUser(): UserAccount {
  const row = database
    .prepare(
      `SELECT id, username, role, enabled, must_change_password, created_at, updated_at
       FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`,
    )
    .get() as {
    id: number;
    username: string;
    role: "admin" | "user";
    enabled: number;
    must_change_password: number;
    created_at: string;
    updated_at: string;
  };
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    enabled: row.enabled === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
  imageUrl?: string;
  imageAssetId?: number;
  siblingSkus?: Array<{ sku: string; size: string }>;
}): { skcRowId: number; skuRowIds: Map<string, number> } {
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
         (spu_row_id, sync_batch_id, skc_id, skc_code, attribute_json,
          image_url, image_asset_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      )
      .run(
        spuRowId,
        batchId,
        `SKC-${input.sku}`,
        `SKC-CODE-${input.sku}`,
        input.color ? JSON.stringify([{ name: "颜色", value: input.color }]) : null,
        input.imageUrl ?? null,
        input.imageAssetId ?? null,
      ).lastInsertRowid,
  );
  const insertSku = database.prepare(
    `INSERT INTO temu_lifecycle_sku_current
      (skc_row_id, sync_batch_id, sku_id, sku_code, size_name,
       specification_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  );
  const skuRowIds = new Map<string, number>();
  const targetSkuResult = insertSku.run(
    skcRowId,
    batchId,
    input.sku,
    `CODE-${input.sku}`,
    input.size,
    input.size ? JSON.stringify([{ name: "尺码", value: input.size }]) : null,
  );
  skuRowIds.set(input.sku, Number(targetSkuResult.lastInsertRowid));
  for (const sibling of input.siblingSkus ?? []) {
    const siblingResult = insertSku.run(
      skcRowId,
      batchId,
      sibling.sku,
      `CODE-${sibling.sku}`,
      sibling.size,
      JSON.stringify([{ name: "尺码", value: sibling.size }]),
    );
    skuRowIds.set(sibling.sku, Number(siblingResult.lastInsertRowid));
  }
  return { skcRowId, skuRowIds };
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
  storeNames?: string[];
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
    const storeName = input.storeNames?.[index] ?? "测试店铺";
    const orderId = Number(
      database
        .prepare(
          `INSERT INTO zhihou_new_orders
            (sync_batch_id, erp_order_id, order_no, store_name, country_code)
           VALUES (?, ?, ?, ?, 'US')`,
        )
        .run(
          syncId,
          String(10_000_000_000_000_000n + BigInt(index)),
          orderNo,
          storeName,
        )
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

function createInventorySpecification(input: {
  recordId: number;
  productCode: string;
  color: string;
  skcRowId: number | null;
  size: string;
  quantity: number;
  skuRowId?: number | null;
}): number {
  const productId = Number(database.prepare(
    `INSERT INTO y2_inventory_products
      (product_management_record_id, product_code, sizes_json)
     VALUES (?, ?, ?)`,
  ).run(input.recordId, input.productCode, JSON.stringify([input.size])).lastInsertRowid);
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'y2_inventory_product_codes'").get()) {
    database.prepare(
      "INSERT OR IGNORE INTO y2_inventory_product_codes (inventory_product_id, product_code) VALUES (?, ?)",
    ).run(productId, input.productCode);
  }
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'y2_inventory_product_spus'").get()) {
    database.prepare(
      "INSERT OR IGNORE INTO y2_inventory_product_spus (inventory_product_id, spu) VALUES (?, ?)",
    ).run(productId, `TEST-SPU-${input.productCode}`);
  }
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'y2_inventory_product_spus'").get()) {
    database.prepare(
      "INSERT OR IGNORE INTO y2_inventory_product_spus (inventory_product_id, spu) VALUES (?, ?)",
    ).run(productId, `TEST-SPU-${input.productCode}`);
  }
  createdInventoryProductIds.push(productId);
  const colorRowId = Number(database.prepare(
    `INSERT INTO y2_inventory_colors
      (inventory_product_id, color_name, normalized_color, skc_row_id, match_status)
     VALUES (?, ?, ?, ?, 'matched')`,
  ).run(productId, input.color, input.color.trim().toUpperCase(), input.skcRowId).lastInsertRowid);
  return Number(database.prepare(
    `INSERT INTO y2_inventory_cells
      (color_row_id, size_name, normalized_size, quantity, sku_row_id, match_status)
     VALUES (?, ?, ?, ?, ?, 'matched')`,
  ).run(
    colorRowId,
    input.size,
    input.size.trim().toUpperCase(),
    input.quantity,
    input.skuRowId ?? null,
  ).lastInsertRowid);
}

afterEach(() => {
  for (const inventoryProductId of createdInventoryProductIds.splice(0)) {
    database.prepare(
      `DELETE FROM zhihou_inventory_adjustment_logs
       WHERE inventory_cell_id IN (
         SELECT cell.id
         FROM y2_inventory_cells cell
         JOIN y2_inventory_colors color ON color.id = cell.color_row_id
         WHERE color.inventory_product_id = ?
       )`,
    ).run(inventoryProductId);
    database.prepare(
      `DELETE FROM zhihou_stock_pick_items
       WHERE inventory_cell_id IN (
         SELECT cell.id
         FROM y2_inventory_cells cell
         JOIN y2_inventory_colors color ON color.id = cell.color_row_id
         WHERE color.inventory_product_id = ?
       )`,
    ).run(inventoryProductId);
    database.prepare("DELETE FROM y2_inventory_products WHERE id = ?").run(inventoryProductId);
  }
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
  it("拒绝删除已被配货记录引用的Y2库存", () => {
    const suffix = Date.now();
    const recordId = createProductBinding(`DELETE-SKU-${suffix}`, `DELETE-SPU-${suffix}`);
    const inventoryCellId = createInventorySpecification({
      recordId,
      productCode: `DELETE-CODE-${suffix}`,
      color: "黑色",
      skcRowId: null,
      size: "L",
      quantity: 10,
    });
    const pickBatchId = Number(database.prepare(
      "INSERT INTO zhihou_stock_pick_batches (created_by_user_id) VALUES (?)",
    ).run(adminId()).lastInsertRowid);
    const pickItemId = Number(database.prepare(
      `INSERT INTO zhihou_stock_pick_items
       (batch_id, target_key, target_zhihou_sku, target_color, target_size,
        inventory_cell_id, source_color, source_size, picked_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      pickBatchId,
      `DELETE-TARGET-${suffix}`,
      `DELETE-SKU-${suffix}`,
      "黑色",
      "L",
      inventoryCellId,
      "黑色",
      "L",
    ).lastInsertRowid);

    const productId = (database
      .prepare("SELECT id FROM y2_inventory_products WHERE product_code = ?")
      .get(`DELETE-CODE-${suffix}`) as { id: number }).id;
    expect(() => deleteY2Inventory(adminUser(), productId)).toThrow("当前仍有 1 件被配货占用");
    expect(database.prepare("SELECT 1 FROM y2_inventory_products WHERE product_code = ?")
      .get(`DELETE-CODE-${suffix}`)).toBeTruthy();

    database.prepare("DELETE FROM zhihou_stock_pick_items WHERE id = ?").run(pickItemId);
    database.prepare("DELETE FROM zhihou_stock_pick_batches WHERE id = ?").run(pickBatchId);
  });

  it("允许撤销已修正库存的配货记录并返还库存", () => {
    const suffix = Date.now();
    const recordId = createProductBinding(`RESTORE-SKU-${suffix}`, `RESTORE-SPU-${suffix}`);
    const inventoryCellId = createInventorySpecification({
      recordId,
      productCode: `RESTORE-CODE-${suffix}`,
      color: "蓝色",
      skcRowId: null,
      size: "M",
      quantity: 7,
    });
    const pickBatchId = Number(database.prepare(
      "INSERT INTO zhihou_stock_pick_batches (created_by_user_id) VALUES (?)",
    ).run(adminId()).lastInsertRowid);
    const pickItemId = Number(database.prepare(
      `INSERT INTO zhihou_stock_pick_items
       (batch_id, target_key, target_zhihou_sku, target_color, target_size,
        inventory_cell_id, source_color, source_size, picked_quantity,
        matched_quantity, adjusted_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      pickBatchId,
      `RESTORE-TARGET-${suffix}`,
      `RESTORE-SKU-${suffix}`,
      "蓝色",
      "M",
      inventoryCellId,
      "蓝色",
      "M",
      3,
      3,
      3,
    ).lastInsertRowid);
    database.prepare(
      "UPDATE y2_inventory_cells SET quantity = 4 WHERE id = ?",
    ).run(inventoryCellId);
    database.prepare(
      `INSERT INTO zhihou_inventory_adjustment_logs
       (pick_item_id, inventory_cell_id, quantity, before_quantity, after_quantity, adjusted_by_user_id)
       VALUES (?, ?, 3, 7, 4, ?)`,
    ).run(pickItemId, inventoryCellId, adminId());

    deleteZhihouStockPick(pickItemId);

    expect((database.prepare(
      "SELECT quantity FROM y2_inventory_cells WHERE id = ?",
    ).get(inventoryCellId) as { quantity: number }).quantity).toBe(7);
    expect(database.prepare(
      "SELECT 1 FROM zhihou_stock_pick_items WHERE id = ?",
    ).get(pickItemId)).toBeUndefined();
    expect(database.prepare(
      "SELECT 1 FROM zhihou_inventory_adjustment_logs WHERE pick_item_id = ?",
    ).get(pickItemId)).toBeUndefined();
  });

  it("允许删除已完成库存修正的Y2库存并清理历史关联", () => {
    const suffix = Date.now();
    const recordId = createProductBinding(`DELETE-ADJUSTED-SKU-${suffix}`, `DELETE-ADJUSTED-SPU-${suffix}`);
    const productCode = `DELETE-ADJUSTED-CODE-${suffix}`;
    const inventoryCellId = createInventorySpecification({
      recordId,
      productCode,
      color: "白色",
      skcRowId: null,
      size: "M",
      quantity: 2,
    });
    const productId = (database.prepare(
      "SELECT id FROM y2_inventory_products WHERE product_code = ?",
    ).get(productCode) as { id: number }).id;
    const pickBatchId = Number(database.prepare(
      "INSERT INTO zhihou_stock_pick_batches (created_by_user_id) VALUES (?)",
    ).run(adminId()).lastInsertRowid);
    const pickItemId = Number(database.prepare(
      `INSERT INTO zhihou_stock_pick_items
       (batch_id, target_key, target_zhihou_sku, target_color, target_size,
        inventory_cell_id, source_color, source_size, picked_quantity, matched_quantity, adjusted_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)`,
    ).run(
      pickBatchId,
      `DELETE-ADJUSTED-TARGET-${suffix}`,
      `DELETE-ADJUSTED-SKU-${suffix}`,
      "白色",
      "M",
      inventoryCellId,
      "白色",
      "M",
    ).lastInsertRowid);
    database.prepare(
      `INSERT INTO zhihou_inventory_adjustment_logs
       (pick_item_id, inventory_cell_id, quantity, before_quantity, after_quantity, adjusted_by_user_id)
       VALUES (?, ?, 1, 2, 1, ?)`,
    ).run(pickItemId, inventoryCellId, adminId());

    deleteY2Inventory(adminUser(), productId);

    expect(database.prepare("SELECT 1 FROM y2_inventory_products WHERE id = ?").get(productId)).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM zhihou_inventory_adjustment_logs WHERE pick_item_id = ?").get(pickItemId)).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM zhihou_stock_pick_items WHERE id = ?").get(pickItemId)).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM zhihou_stock_pick_batches WHERE id = ?").get(pickBatchId)).toBeUndefined();
    expect(database.prepare(
      "SELECT action FROM y2_inventory_change_logs WHERE inventory_product_id IS NULL AND product_code = ? AND action = 'delete' ORDER BY id DESC LIMIT 1",
    ).get(productCode)).toBeTruthy();
  });

  it("仍有未修正配货占用时不能删除Y2库存", () => {
    const suffix = Date.now();
    const recordId = createProductBinding(`DELETE-PENDING-SKU-${suffix}`, `DELETE-PENDING-SPU-${suffix}`);
    const productCode = `DELETE-PENDING-CODE-${suffix}`;
    const inventoryCellId = createInventorySpecification({
      recordId,
      productCode,
      color: "白色",
      skcRowId: null,
      size: "M",
      quantity: 2,
    });
    const productId = (database.prepare(
      "SELECT id FROM y2_inventory_products WHERE product_code = ?",
    ).get(productCode) as { id: number }).id;
    const pickBatchId = Number(database.prepare(
      "INSERT INTO zhihou_stock_pick_batches (created_by_user_id) VALUES (?)",
    ).run(adminId()).lastInsertRowid);
    database.prepare(
      `INSERT INTO zhihou_stock_pick_items
       (batch_id, target_key, target_zhihou_sku, target_color, target_size,
        inventory_cell_id, source_color, source_size, picked_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      pickBatchId,
      `DELETE-PENDING-TARGET-${suffix}`,
      `DELETE-PENDING-SKU-${suffix}`,
      "白色",
      "M",
      inventoryCellId,
      "白色",
      "M",
    );

    expect(() => deleteY2Inventory(adminUser(), productId)).toThrow("当前仍有 1 件被配货占用");
    expect(database.prepare("SELECT 1 FROM y2_inventory_products WHERE id = ?").get(productId)).toBeTruthy();
  });

  it("删除没有业务引用的Y2库存并写入删除日志", () => {
    const suffix = Date.now();
    const recordId = createProductBinding(`DELETE-FREE-SKU-${suffix}`, `DELETE-FREE-SPU-${suffix}`);
    const productCode = `DELETE-FREE-CODE-${suffix}`;
    createInventorySpecification({
      recordId,
      productCode,
      color: "白色",
      skcRowId: null,
      size: "M",
      quantity: 2,
    });
    const productId = (database.prepare(
      "SELECT id FROM y2_inventory_products WHERE product_code = ?",
    ).get(productCode) as { id: number }).id;

    deleteY2Inventory(adminUser(), productId);

    expect(database.prepare("SELECT 1 FROM y2_inventory_products WHERE id = ?").get(productId)).toBeUndefined();
    expect(database.prepare(
      "SELECT action FROM y2_inventory_change_logs WHERE inventory_product_id IS NULL AND product_code = ? AND action = 'delete' ORDER BY id DESC LIMIT 1",
    ).get(productCode)).toBeTruthy();
  });

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

  it("按生命周期本地图、Temu 远端图、ERP 本地图、ERP 远端图生成候选顺序", () => {
    const sku = `IMAGE-SKU-${Date.now()}`;
    const parentSpu = `PARENT-SPU-IMAGE-${Date.now()}`;
    createProductBinding(sku, parentSpu);
    const insertAsset = database.prepare(
      `INSERT INTO image_assets
       (content_hash, file_name, mime_type, byte_size, source_type)
       VALUES (?, ?, 'image/jpeg', 1, 'remote')`,
    );
    const lifecycleAssetId = Number(
      insertAsset.run(`lifecycle-image-hash-${sku}`, `lifecycle-image-${sku}.jpg`).lastInsertRowid,
    );
    const erpAssetId = Number(
      insertAsset.run(`erp-image-hash-${sku}`, `erp-image-${sku}.jpg`).lastInsertRowid,
    );
    createLifecycleSpecification({
      sku,
      parentSpu,
      color: "黑色",
      size: "L",
      imageUrl: "https://temu.example/skc.jpg",
      imageAssetId: lifecycleAssetId,
    });
    const syncId = createCompletedSync({ sku, color: "黑色", size: "L", quantities: [1] });
    database
      .prepare(
        `UPDATE zhihou_new_order_items
         SET image_asset_id = ?, specification_image_url = ?, main_image_url = ?
         WHERE sync_batch_id = ?`,
      )
      .run(erpAssetId, "https://erp.example/spec.jpg", "https://erp.example/main.jpg", syncId);

    const row = matrixCells(getZhihouOrderSummary()).find((item) => item.zhihouSkus.includes(sku));
    expect(row?.imageUrls).toEqual([
      `/api/images/${encodeURIComponent(`lifecycle-image-${sku}.jpg`)}`,
      "https://temu.example/skc.jpg",
      `/api/images/${encodeURIComponent(`erp-image-${sku}.jpg`)}`,
      "https://erp.example/spec.jpg",
      "https://erp.example/main.jpg",
    ]);
  });

  it("返回店铺列表并按智猴店铺过滤订单汇总", () => {
    const sku = `STORE-SKU-${Date.now()}`;
    createProductBinding(sku, "PARENT-SPU-STORE");
    createCompletedSync({
      sku,
      color: "黑色",
      size: "L",
      quantities: [2, 3],
      storeNames: ["店铺甲", "店铺乙"],
    });

    const allStores = getZhihouOrderSummary();
    expect(allStores.storeNames).toEqual(["店铺甲", "店铺乙"]);
    expect(matrixCells(allStores).find((item) => item.zhihouSkus.includes(sku))?.requiredQuantity).toBe(5);

    const storeA = getZhihouOrderSummary({ storeName: "店铺甲" });
    const row = matrixCells(storeA).find((item) => item.zhihouSkus.includes(sku));
    expect(row).toMatchObject({ requiredQuantity: 2, orderCount: 1 });
    expect(getZhihouOrderReferences(row!.key, "店铺甲").orders).toMatchObject([
      { quantity: 2, storeName: "店铺甲" },
    ]);
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

  it("订单汇总尺码按 S、M、L、XL、XXL 排序", () => {
    const parentSpu = `PARENT-SPU-SIZE-ORDER-${Date.now()}`;
    const syncId = createCompletedSync({ sku: `SIZE-ORDER-SKU-${Date.now()}`, color: "黑色", size: "XL", quantities: [1] });
    const skuRows = ["XL", "S", "XXL", "M", "L"].map((size, index) => {
      const sku = `SIZE-ORDER-SKU-${Date.now()}-${index}`;
      createProductBinding(sku, parentSpu);
      return { sku, size };
    });
    const lifecycleBatchId = Number(
      database.prepare(
        `INSERT INTO temu_lifecycle_sync_batches (shop_profile_id, requested_by_user_id, status, started_at, completed_at)
         VALUES (?, ?, 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(firstShopId(), adminId()).lastInsertRowid,
    );
    const spuRowId = Number(
      database.prepare(
        `INSERT INTO temu_lifecycle_spu_current (shop_profile_id, sync_batch_id, spu, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(firstShopId(), lifecycleBatchId, parentSpu).lastInsertRowid,
    );
    const skcRowId = Number(
      database.prepare(
        `INSERT INTO temu_lifecycle_skc_current (spu_row_id, sync_batch_id, skc_id, skc_code, attribute_json, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(spuRowId, lifecycleBatchId, `SKC-${parentSpu}`, `SKC-CODE-${parentSpu}`, JSON.stringify([{ name: "颜色", value: "黑色" }])).lastInsertRowid,
    );
    const insertSku = database.prepare(
      `INSERT INTO temu_lifecycle_sku_current (skc_row_id, sync_batch_id, sku_id, sku_code, size_name, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    );
    for (const { sku, size } of skuRows) {
      insertSku.run(skcRowId, lifecycleBatchId, sku, `CODE-${sku}`, size);
      database.prepare(
        `INSERT INTO zhihou_new_order_items (sync_batch_id, order_id, external_item_key, zhihou_sku, color, size, quantity)
         SELECT ?, id, ?, ?, ?, ?, 1 FROM zhihou_new_orders WHERE sync_batch_id = ? LIMIT 1`,
      ).run(syncId, `size-order-${sku}`, sku, "黑色", size, syncId);
    }

    expect(getZhihouOrderSummary().matrices.find((matrix) => matrix.parentSpu === parentSpu)?.sizes)
      .toEqual(["S", "M", "L", "XL", "XXL"]);
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
  });

  it("已绑定同一SKC时忽略颜色文字差异并提供跨尺码改码候选", () => {
    const sku = `PICK-SKC-SKU-${Date.now()}`;
    const xlSku = `${sku}-XL`;
    const parentSpu = `PARENT-SPU-PICK-SKC-${Date.now()}`;
    const recordId = createProductBinding(sku, parentSpu);
    const lifecycle = createLifecycleSpecification({
      sku,
      parentSpu,
      color: "粉红色",
      size: "L",
      siblingSkus: [{ sku: xlSku, size: "XL" }],
    });
    createInventorySpecification({
      recordId,
      productCode: `ZH-TEST-${sku}`,
      color: "粉色",
      skcRowId: lifecycle.skcRowId,
      size: "XL",
      quantity: 1,
      skuRowId: lifecycle.skuRowIds.get(xlSku) ?? null,
    });
    createCompletedSync({ sku, color: "粉红色", size: "L", quantities: [1] });

    const row = matrixCells(getZhihouOrderSummary()).find((item) => item.zhihouSkus.includes(sku));
    expect(row?.inventoryPickOptions).toMatchObject([
      { color: "粉色", size: "XL", quantity: 1, isExact: false },
    ]);
  });

  it("目标SKC已知时不允许从其他SKC跨颜色配货", () => {
    const sku = `PICK-OTHER-SKC-${Date.now()}`;
    const parentSpu = `PARENT-SPU-PICK-OTHER-${Date.now()}`;
    const recordId = createProductBinding(sku, parentSpu);
    const target = createLifecycleSpecification({ sku, parentSpu, color: "粉红色", size: "L" });
    const other = createLifecycleSpecification({
      sku: `${sku}-OTHER`,
      parentSpu: `${parentSpu}-OTHER`,
      color: "粉红色",
      size: "XL",
    });
    createInventorySpecification({
      recordId,
      productCode: `ZH-TEST-${sku}`,
      color: "粉红色",
      skcRowId: other.skcRowId,
      size: "XL",
      quantity: 1,
    });

    expect(zhihouInventoryPickOptions({
      productManagementRecordId: recordId,
      productCodes: [`ZH-TEST-${sku}`],
      targetSkcRowId: target.skcRowId,
      targetColor: "粉红色",
      targetSize: "L",
      targetKey: `target-${sku}`,
    })).toEqual([]);
  });

  it("目标SKC缺失时仍按同名颜色回退生成改码候选", () => {
    const sku = `PICK-COLOR-FALLBACK-${Date.now()}`;
    const recordId = createProductBinding(sku, `PARENT-SPU-PICK-FALLBACK-${Date.now()}`);
    createInventorySpecification({
      recordId,
      productCode: `ZH-TEST-${sku}`,
      color: "黑色",
      skcRowId: null,
      size: "XL",
      quantity: 2,
    });

    expect(zhihouInventoryPickOptions({
      productManagementRecordId: recordId,
      productCodes: [`ZH-TEST-${sku}`],
      targetSkcRowId: null,
      targetColor: "黑色",
      targetSize: "L",
      targetKey: `target-${sku}`,
    })).toMatchObject([
      { color: "黑色", size: "XL", quantity: 2, isExact: false },
    ]);
  });
});
