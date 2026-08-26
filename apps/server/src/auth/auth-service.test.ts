import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getProducts,
  parseSpuSearchTokens,
} from "../analytics/analytics-service.js";
import {
  getSpuComparison,
  listSpuComparisonCandidates,
} from "../analytics/comparison-service.js";
import { database } from "../database/index.js";
import {
  createProductOperationsBatch,
  listProductOperations,
} from "../products/operation-service.js";
import {
  authenticateUser,
  createSession,
  getSession,
  registerUser,
  setActiveShop,
  updateUser,
} from "./auth-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
const firstName = `shop_user_a_${suffix}`;
const secondName = `shop_user_b_${suffix}`;
let firstUserId = 0;
let secondUserId = 0;
let firstShopId = 0;
let secondShopId = 0;
let firstBatchId = 0;
let secondBatchId = 0;

function createShop(label: string, cdpPort: number): number {
  const result = database
    .prepare(
      `INSERT INTO temu_shop_profiles
       (name, account_label, profile_key, cdp_port, fingerprint_seed)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      `Test Shop ${label}`,
      `test-${label}`,
      `temu/test-${label}-${suffix}`,
      cdpPort,
      `fingerprint-${label}-${suffix}`,
    );
  return Number(result.lastInsertRowid);
}

beforeAll(() => {
  firstUserId = registerUser({
    username: firstName,
    password: "Password123!",
  }).id;
  secondUserId = registerUser({
    username: secondName,
    password: "Password123!",
  }).id;
  firstShopId = createShop("a", 15001);
  secondShopId = createShop("b", 15002);
  database
    .prepare(
      `INSERT INTO temu_shop_user_grants (shop_profile_id, user_id)
       VALUES (?, ?), (?, ?)`,
    )
    .run(firstShopId, firstUserId, secondShopId, secondUserId);

  database
    .prepare(
      `INSERT INTO products (shop_profile_id, spu)
       VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)`,
    )
    .run(
      firstShopId,
      "SAME-SPU",
      secondShopId,
      "SAME-SPU",
      firstShopId,
      "COMPARE-A",
      firstShopId,
      "COMPARE-B",
      secondShopId,
      "COMPARE-A",
    );

  const batch = database.prepare(
    `INSERT INTO import_batches
     (shop_profile_id, file_name, stored_file_name, file_hash, data_date, row_count, status)
     VALUES (?, ?, ?, ?, ?, ?, 'completed')`,
  );
  firstBatchId = Number(
    batch.run(firstShopId, "a.xlsx", "a.xlsx", `a-${suffix}`, "2026-08-24", 5)
      .lastInsertRowid,
  );
  secondBatchId = Number(
    batch.run(secondShopId, "b.xlsx", "b.xlsx", `b-${suffix}`, "2026-08-24", 2)
      .lastInsertRowid,
  );

  const metric = database.prepare(
    `INSERT INTO daily_metrics
     (shop_profile_id, data_date, spu, batch_id, impressions, clicks, visitors,
      cart_users, orders, detail_paid_buyers, detail_payment_conversion_rate,
      impression_order_conversion_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  metric.run(
    firstShopId,
    "2026-08-24",
    "SAME-SPU",
    firstBatchId,
    100,
    10,
    8,
    4,
    1,
    1,
    0.25,
    0.01,
  );
  metric.run(
    secondShopId,
    "2026-08-24",
    "SAME-SPU",
    secondBatchId,
    900,
    90,
    70,
    30,
    9,
    8,
    0.2667,
    0.01,
  );
  metric.run(
    firstShopId,
    "2026-08-23",
    "COMPARE-A",
    firstBatchId,
    80,
    8,
    7,
    3,
    1,
    1,
    0.3333,
    0.0125,
  );
  metric.run(
    firstShopId,
    "2026-08-24",
    "COMPARE-A",
    firstBatchId,
    120,
    18,
    14,
    7,
    3,
    2,
    0.2857,
    0.025,
  );
  metric.run(
    firstShopId,
    "2026-08-23",
    "COMPARE-B",
    firstBatchId,
    100,
    12,
    9,
    4,
    2,
    2,
    0.5,
    0.02,
  );
  metric.run(
    firstShopId,
    "2026-08-24",
    "COMPARE-B",
    firstBatchId,
    160,
    24,
    20,
    10,
    5,
    4,
    0.4,
    0.03125,
  );
  metric.run(
    secondShopId,
    "2026-08-24",
    "COMPARE-A",
    secondBatchId,
    999,
    99,
    80,
    40,
    10,
    9,
    0.225,
    0.01001,
  );
});

afterAll(() => {
  database
    .prepare("DELETE FROM temu_shop_profiles WHERE id IN (?, ?)")
    .run(firstShopId, secondShopId);
  database
    .prepare("DELETE FROM users WHERE id IN (?, ?)")
    .run(firstUserId, secondUserId);
});

describe("authentication and shop isolation", () => {
  it("authenticates registered users and rejects wrong passwords", () => {
    expect(
      authenticateUser({ username: firstName, password: "Password123!" }).id,
    ).toBe(firstUserId);
    expect(() =>
      authenticateUser({ username: firstName, password: "wrong-password" }),
    ).toThrow("用户名或密码错误");
  });

  it("isolates identical SPUs by shop", () => {
    expect(
      getProducts(firstShopId, {
        date: "2026-08-24",
        search: "SAME-SPU",
      })[0]?.impressions,
    ).toBe(100);
    expect(
      getProducts(secondShopId, {
        date: "2026-08-24",
        search: "SAME-SPU",
      })[0]?.impressions,
    ).toBe(900);
  });

  it("limits normal users to granted shops and invalidates disabled sessions", () => {
    const session = createSession(firstUserId);
    const auth = getSession(session.id)!;
    expect(auth.activeShop.id).toBe(firstShopId);
    expect(auth.availableShops.map((shop) => shop.id)).toEqual([firstShopId]);
    expect(() => setActiveShop(session.id, auth.user, secondShopId)).toThrow(
      "无权切换到该店铺",
    );
    updateUser(1, firstUserId, { enabled: false });
    expect(getSession(session.id)).toBeNull();
    updateUser(1, firstUserId, { enabled: true });
  });

  it("parses exact SPU tokens and compares only the current shop", () => {
    expect(parseSpuSearchTokens(" SAME-SPU， MISSING, SAME-SPU ")).toEqual([
      "SAME-SPU",
      "MISSING",
    ]);
    const first = getProducts(firstShopId, {
      date: "2026-08-24",
      search: "SAME-SPU MISSING",
    });
    const second = getProducts(secondShopId, {
      date: "2026-08-24",
      search: "SAME-SPU,MISSING",
    });
    expect(first.map((item) => item.impressions)).toEqual([100]);
    expect(second.map((item) => item.impressions)).toEqual([900]);

    const candidates = listSpuComparisonCandidates(firstShopId);
    expect(candidates.map((item) => item.spu)).toEqual([
      "COMPARE-A",
      "COMPARE-B",
      "SAME-SPU",
    ]);
    const comparison = getSpuComparison(firstShopId, [
      "COMPARE-A",
      "COMPARE-B",
    ]);
    expect(comparison.selectedDate).toBe("2026-08-24");
    expect(comparison.commonDates).toEqual(["2026-08-24", "2026-08-23"]);
    expect(
      comparison.products.map((item) => item.selected.impressions),
    ).toEqual([120, 160]);
    expect(() =>
      getSpuComparison(secondShopId, ["COMPARE-A", "COMPARE-B"]),
    ).toThrow("未找到 SPU");
  });

  it("creates batch operations with actor audit and partial success", () => {
    const actor = authenticateUser({
      username: firstName,
      password: "Password123!",
    });
    const result = createProductOperationsBatch(
      firstShopId,
      ["SAME-SPU", "MISSING", "SAME-SPU"],
      {
        operatedAt: "2026-08-24T10:00:00.000Z",
        content: "批量测试操作",
        note: null,
      },
      actor,
    );
    expect(result.successCount).toBe(1);
    expect(result.succeededSpus).toEqual(["SAME-SPU"]);
    expect(result.failures[0]).toMatchObject({ spu: "MISSING" });
    const records = listProductOperations(firstShopId, "SAME-SPU");
    expect(records.some((item) => item.content === "批量测试操作")).toBe(true);
    expect(
      records.find((item) => item.content === "批量测试操作"),
    ).toMatchObject({
      createdByUsername: firstName,
      updatedByUsername: firstName,
    });
    expect(
      listProductOperations(secondShopId, "SAME-SPU").some(
        (item) => item.content === "批量测试操作",
      ),
    ).toBe(false);
  });
});
