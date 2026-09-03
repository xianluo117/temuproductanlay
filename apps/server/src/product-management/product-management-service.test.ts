import type { UserAccount } from "@temu-analytics/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../database/index.js";
import { autoCreateLifecycleProductRecords } from "../temu-shops/lifecycle-auto-service.js";
import { listProductManagementTrafficLimitSkcs } from "./product-management-traffic-limit-service.js";
import {
  createProductManagementRecord,
  deleteProductManagementRecord,
  getProductManagementRecord,
  getProductManagementColumnPreferences,
  getProductManagementSettings,
  listProductManagementRecords,
  updateProductManagementColumnPreferences,
} from "./product-management-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
let shopId = 0;
let syncId = 0;
let admin: UserAccount;

beforeAll(() => {
  const user = database
    .prepare(
      `SELECT id, username, role, enabled, must_change_password, created_at, updated_at
       FROM users WHERE username = 'admin'`,
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
  admin = {
    id: user.id,
    username: user.username,
    role: user.role,
    enabled: user.enabled === 1,
    mustChangePassword: user.must_change_password === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };

  shopId = Number(
    database
      .prepare(
        `INSERT INTO temu_shop_profiles
         (name, account_label, profile_key, cdp_port, fingerprint_seed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        `Product Management Test ${suffix}`,
        `product-management-${suffix}`,
        `temu/product-management-${suffix}`,
        16000 + Math.floor(Math.random() * 1000),
        `product-management-fingerprint-${suffix}`,
      ).lastInsertRowid,
  );
  syncId = Number(
    database
      .prepare(
        `INSERT INTO temu_lifecycle_sync_batches
         (shop_profile_id, requested_by_user_id, page_size, status,
          total_pages, total_spus, total_skcs, total_skus, completed_at)
         VALUES (?, ?, 50, 'completed', 1, 2, 3, 4, CURRENT_TIMESTAMP)`,
      )
      .run(shopId, admin.id).lastInsertRowid,
  );

  const insertSpu = database.prepare(
    `INSERT INTO temu_lifecycle_spu_current
     (shop_profile_id, sync_batch_id, spu, product_id, product_code,
      lowest_review_price, traffic_limit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSkc = database.prepare(
    `INSERT INTO temu_lifecycle_skc_current
     (spu_row_id, sync_batch_id, skc_id, skc_code, attribute_json,
      lowest_review_price, traffic_limit_price)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSku = database.prepare(
    `INSERT INTO temu_lifecycle_sku_current
     (skc_row_id, sync_batch_id, sku_id, sku_code, size_name,
      specification_json, lowest_supplier_price, suggested_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const firstSpuId = Number(
    insertSpu.run(
      shopId,
      syncId,
      `SPU-A-${suffix}`,
      `PRODUCT-A-${suffix}`,
      "Z38-Y22-junlv",
      32,
      68,
    ).lastInsertRowid,
  );
  const firstSkcId = Number(
    insertSkc.run(
      firstSpuId,
      syncId,
      `SKC-A-${suffix}`,
      "Z38-Y22-junlv",
      JSON.stringify([{ name: "颜色", value: "军绿" }]),
      32,
      68,
    ).lastInsertRowid,
  );
  const lowerLimitSkcId = Number(
    insertSkc.run(
      firstSpuId,
      syncId,
      `SKC-A-LIMIT-${suffix}`,
      "OTHER-CODE-black",
      JSON.stringify([{ name: "颜色", value: "黑色" }]),
      45,
      60,
    ).lastInsertRowid,
  );
  insertSku.run(
    lowerLimitSkcId,
    syncId,
    `SKU-A-LIMIT-${suffix}`,
    "OTHER-CODE-black-S",
    "S",
    JSON.stringify([{ name: "尺码", value: "S" }]),
    45,
    58,
  );
  insertSku.run(
    firstSkcId,
    syncId,
    `SKU-A1-${suffix}`,
    "Z38-Y22-junlv-M",
    "M",
    JSON.stringify([{ name: "尺码", value: "M" }]),
    35,
    72,
  );
  insertSku.run(
    firstSkcId,
    syncId,
    `SKU-A2-${suffix}`,
    "Z38-Y22-junlv-L",
    "L",
    JSON.stringify([{ name: "尺码", value: "L" }]),
    32,
    68,
  );

  const secondSpuId = Number(
    insertSpu.run(
      shopId,
      syncId,
      `SPU-B-${suffix}`,
      `PRODUCT-B-${suffix}`,
      "HB30-GY058-grey",
      40,
      null,
    ).lastInsertRowid,
  );
  const secondSkcId = Number(
    insertSkc.run(
      secondSpuId,
      syncId,
      `SKC-B-${suffix}`,
      "HB30-GY058-grey",
      JSON.stringify([{ name: "颜色", value: "灰色" }]),
      40,
      null,
    ).lastInsertRowid,
  );
  insertSku.run(
    secondSkcId,
    syncId,
    `SKU-B1-${suffix}`,
    "HB30-GY058-grey-S",
    "S",
    JSON.stringify([{ name: "尺码", value: "S" }]),
    40,
    null,
  );

  autoCreateLifecycleProductRecords(shopId, syncId);
  database
    .prepare(
      `UPDATE products SET remote_image_url = ?
       WHERE shop_profile_id = ? AND spu = ?`,
    )
    .run(
      `https://img.example.invalid/${suffix}.jpg`,
      shopId,
      `SPU-A-${suffix}`,
    );
  database
    .prepare("UPDATE products SET first_listed_at = ? WHERE shop_profile_id = ? AND spu = ?")
    .run("2026-08-15 10:20:30", shopId, `SPU-A-${suffix}`);
});

afterAll(() => {
  if (shopId > 0) {
    database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(shopId);
  }
});

describe("product management lifecycle integration", () => {
  it("creates lifecycle records with truncated codes and calculated values", () => {
    const records = listProductManagementRecords(shopId, admin, "shop").records;
    const z38 = records.find((record) => record.productCode === "Z38-Y22");
    const hb30 = records.find((record) => record.productCode === "HB30-GY058");
    const settings = getProductManagementSettings();
    const expectedZ38Total = Number(
      (38 + 0.3 * settings.shippingCostPerKg).toFixed(2),
    );
    const expectedHb30Total = Number(
      (30 + 0.3 * settings.shippingCostPerKg).toFixed(2),
    );

    expect(z38).toMatchObject({
      serialNumber: "22",
      goodsValue: 38,
      totalCost: expectedZ38Total,
    });
    expect(hb30).toMatchObject({
      serialNumber: "058",
      goodsValue: 30,
      totalCost: expectedHb30Total,
    });
    const sources = database
      .prepare(
        `SELECT product_code, source_type
         FROM product_management_records WHERE shop_profile_id = ?`,
      )
      .all(shopId) as Array<{ product_code: string; source_type: string }>;
    expect(sources.every((row) => row.source_type === "lifecycle")).toBe(true);
  });

  it("returns hierarchical lifecycle details with separated prices", () => {
    const summary = listProductManagementRecords(shopId, admin, "shop", {
      productCode: "Z38-Y22",
    }).records[0];
    expect(summary?.lifecycleMatch.details).toEqual([]);
    const record = getProductManagementRecord(summary!.id, shopId, admin);
    expect(record?.lifecycleMatch).toMatchObject({
      matchType: "skc",
      lowestSupplierPrice: 32,
      trafficLimitPrice: 68,
    });
    expect(record?.lifecycleMatch.details[0]?.skcs[0]).toMatchObject({
      displayCode: "Z38-Y22",
      lowestSupplierPrice: 32,
      trafficLimitPrice: 68,
    });
    expect(record?.lifecycleMatch.details[0]?.skcs[0]?.skus).toHaveLength(2);
    expect(record?.spuLinks[0]).toMatchObject({
      trafficLimitPrice: 58,
    });
    expect(record?.spuLinks[0]?.trafficLimitProfitMargin).not.toBeNull();
    expect(record?.spuLinks[0]?.trafficLimitSuggestedActivityDiscount).not.toBeNull();
    expect(record?.spuLinks[0]?.trafficLimitFinalActivityDiscount).not.toBeNull();
    expect(record?.spuLinks[0]?.trafficLimitActivityPrice).not.toBeNull();
    expect(record?.spuLinks[0]?.trafficLimitTrafficPrice).not.toBeNull();
    expect(record?.spuLinks[0]?.trafficLimitRoas).not.toBeNull();
  });

  it("keeps manual product codes unchanged and stores their serial number", () => {
    const created = createProductManagementRecord(shopId, admin, {
      productCode: "Z26-Y37-white",
      weightKg: 0.3,
      goodsValue: null,
      purchaseLinks: [],
      spuLinks: [],
    });
    expect(created).toMatchObject({
      productCode: "Z26-Y37-white",
      serialNumber: "37",
      goodsValue: 26,
    });
    const source = database
      .prepare(
        "SELECT source_type FROM product_management_records WHERE id = ?",
      )
      .get(created.id) as { source_type: string };
    expect(source.source_type).toBe("manual");
    deleteProductManagementRecord(created.id, shopId, admin);
  });

  it("returns all traffic-limited SKCs for manual operation decisions", () => {
    const record = listProductManagementRecords(shopId, admin, "shop", {
      productCode: "Z38-Y22",
    }).records[0];
    const spu = record?.spuLinks[0]?.spu;
    expect(record).toBeDefined();
    expect(spu).toBeTruthy();
    const items = listProductManagementTrafficLimitSkcs(
      record!.id,
      shopId,
      spu!,
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.trafficLimitPrice)).toEqual([68, 58]);
    expect(items[0]?.skus).toHaveLength(2);
    expect(items[1]?.skus).toHaveLength(1);
  });

  it("stores product management columns per user", () => {
    const original = getProductManagementColumnPreferences(admin.id);
    const updated = updateProductManagementColumnPreferences(admin.id, {
      visibleColumns: ["productCode", "serialNumber", "trafficLimitPrice"],
    });
    expect(updated.visibleColumns).toEqual([
      "productCode",
      "serialNumber",
      "trafficLimitPrice",
    ]);
    expect(
      listProductManagementRecords(shopId, admin, "shop").columnPreferences,
    ).toEqual(updated);
    const otherUserId = Number(
      database
        .prepare(
          `INSERT INTO users
           (username, password_hash, role, enabled, must_change_password)
           VALUES (?, 'test-only', 'user', 1, 0)`,
        )
        .run(`product-columns-${suffix}`).lastInsertRowid,
    );
    expect(getProductManagementColumnPreferences(otherUserId)).not.toEqual(
      updated,
    );
    database.prepare("DELETE FROM users WHERE id = ?").run(otherUserId);
    updateProductManagementColumnPreferences(admin.id, original);
  });

  it("paginates by product master records and returns paging metadata", () => {
    const firstPage = listProductManagementRecords(
      shopId,
      admin,
      "shop",
      {},
      { page: 1, pageSize: 20 },
    );
    expect(firstPage).toMatchObject({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
    });
    expect(firstPage.records).toHaveLength(2);
  });

  it("returns remote SPU images while local downloads are incomplete", () => {
    const record = listProductManagementRecords(shopId, admin, "shop", {
      spu: `SPU-A-${suffix}`,
    }).records[0];
    expect(record?.spuLinks[0]).toMatchObject({
      localImageUrl: null,
      remoteImageUrl: `https://img.example.invalid/${suffix}.jpg`,
      displayImageUrl: `https://img.example.invalid/${suffix}.jpg`,
      imageStatus: "remote_only",
    });
  });

  it("exposes and filters SPU first listed time from SPU data", () => {
    const matching = listProductManagementRecords(shopId, admin, "shop", {
      firstListedAtStart: "2026-08-15",
      firstListedAtEnd: "2026-08-15",
    }).records;
    expect(matching).toHaveLength(1);
    expect(matching[0]?.spuLinks[0]).toMatchObject({
      spu: `SPU-A-${suffix}`,
      firstListedAt: "2026-08-15 10:20:30",
    });

    const excluded = listProductManagementRecords(shopId, admin, "shop", {
      firstListedAtStart: "2026-08-16",
    }).records;
    expect(excluded).toHaveLength(0);
  });

  it("supports OR keywords within a field and AND across fields", () => {
    const spuOr = listProductManagementRecords(shopId, admin, "shop", {
      spu: `MISSING ${`SPU-A-${suffix}`}`,
    });
    expect(spuOr.records.map((record) => record.productCode)).toEqual([
      "Z38-Y22",
    ]);

    const skcOr = listProductManagementRecords(shopId, admin, "shop", {
      skc: `MISSING ${`SKC-B-${suffix}`}`,
    });
    expect(skcOr.records.map((record) => record.productCode)).toEqual([
      "HB30-GY058",
    ]);

    const skuOr = listProductManagementRecords(shopId, admin, "shop", {
      sku: `MISSING ${`SKU-A2-${suffix}`}`,
    });
    expect(skuOr.records.map((record) => record.productCode)).toEqual([
      "Z38-Y22",
    ]);

    const fieldsAnd = listProductManagementRecords(shopId, admin, "shop", {
      spu: `SPU-A-${suffix}`,
      sku: `SKU-A1-${suffix}`,
      productCode: "Y22",
    });
    expect(fieldsAnd.records.map((record) => record.productCode)).toEqual([
      "Z38-Y22",
    ]);
    expect(
      listProductManagementRecords(shopId, admin, "shop", {
        spu: `SPU-B-${suffix}`,
        sku: `SKU-A1-${suffix}`,
      }).records,
    ).toHaveLength(0);
  });
});
