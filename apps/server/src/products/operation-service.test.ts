import type { UserAccount } from "@temu-analytics/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database } from "../database/index.js";
import {
  createProductOperation,
  deleteProductOperation,
  listProductOperations,
  updateProductOperation,
} from "./operation-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
const firstSpu = `__operation_test_spu_1_${suffix}__`;
const secondSpu = `__operation_test_spu_2_${suffix}__`;
let shopId = 0;
let actor: UserAccount;

beforeAll(() => {
  const user = database
    .prepare(
      `SELECT id, username, role, enabled, must_change_password, created_at, updated_at
       FROM users WHERE id = 1`,
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
  actor = {
    id: user.id,
    username: user.username,
    role: user.role,
    enabled: user.enabled === 1,
    mustChangePassword: user.must_change_password === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
  const result = database
    .prepare(
      `INSERT INTO temu_shop_profiles
       (name, account_label, profile_key, cdp_port, fingerprint_seed)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      `Operation Test ${suffix}`,
      `operation-test-${suffix}`,
      `temu/operation-test-${suffix}`,
      15101,
      `operation-fingerprint-${suffix}`,
    );
  shopId = Number(result.lastInsertRowid);
  database
    .prepare(
      "INSERT INTO products (shop_profile_id, spu) VALUES (?, ?), (?, ?)",
    )
    .run(shopId, firstSpu, shopId, secondSpu);
});

afterAll(() => {
  database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(shopId);
});

describe("product operation service", () => {
  it("creates records with actor identity and lists by operation time", () => {
    createProductOperation(
      shopId,
      firstSpu,
      {
        operatedAt: "2026-08-23T02:00:00.000Z",
        content: "调整主图",
        note: null,
      },
      actor,
    );
    const newest = createProductOperation(
      shopId,
      firstSpu,
      {
        operatedAt: "2026-08-24T03:00:00.000Z",
        content: "修改标题",
        note: "观察点击率",
      },
      actor,
    );
    createProductOperation(
      shopId,
      secondSpu,
      {
        operatedAt: "2026-08-25T04:00:00.000Z",
        content: "其他 SPU 操作",
        note: null,
      },
      actor,
    );

    const records = listProductOperations(shopId, firstSpu);
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe(newest.id);
    expect(records.map((record) => record.content)).toEqual([
      "修改标题",
      "调整主图",
    ]);
    expect(records[0]).toMatchObject({
      createdByUsername: actor.username,
      updatedByUsername: actor.username,
    });
  });

  it("updates, deletes and audits a record", () => {
    const record = createProductOperation(
      shopId,
      firstSpu,
      {
        operatedAt: "2026-08-22T01:00:00.000Z",
        content: "原操作",
        note: null,
      },
      actor,
    );
    const updated = updateProductOperation(
      shopId,
      firstSpu,
      record.id,
      {
        operatedAt: "2026-08-26T05:00:00.000Z",
        content: "更新后的操作",
        note: "更新后的备注",
      },
      actor,
    );
    expect(updated).toMatchObject({
      content: "更新后的操作",
      note: "更新后的备注",
      updatedByUsername: actor.username,
    });

    deleteProductOperation(shopId, firstSpu, record.id, actor);
    expect(
      listProductOperations(shopId, firstSpu).some(
        (item) => item.id === record.id,
      ),
    ).toBe(false);
    const audit = database
      .prepare(
        `SELECT action, operator_username
         FROM product_operation_audit
         WHERE shop_profile_id = ? AND operation_record_id = ?
         ORDER BY id`,
      )
      .all(shopId, record.id) as Array<{
      action: string;
      operator_username: string;
    }>;
    expect(audit.map((item) => item.action)).toEqual([
      "create",
      "update",
      "delete",
    ]);
    expect(
      audit.every((item) => item.operator_username === actor.username),
    ).toBe(true);
  });

  it("validates shop SPU, date and field lengths", () => {
    expect(() =>
      createProductOperation(
        shopId,
        "__missing_spu__",
        {
          operatedAt: new Date().toISOString(),
          content: "操作",
          note: null,
        },
        actor,
      ),
    ).toThrow("当前店铺未找到该 SPU");
    expect(() =>
      createProductOperation(
        shopId,
        firstSpu,
        { operatedAt: "invalid", content: "操作", note: null },
        actor,
      ),
    ).toThrow("操作日期时间无效");
    expect(() =>
      createProductOperation(
        shopId,
        firstSpu,
        {
          operatedAt: new Date().toISOString(),
          content: "   ",
          note: null,
        },
        actor,
      ),
    ).toThrow("操作内容不能为空");
    expect(() =>
      createProductOperation(
        shopId,
        firstSpu,
        {
          operatedAt: new Date().toISOString(),
          content: "a".repeat(1001),
          note: null,
        },
        actor,
      ),
    ).toThrow("操作内容不能超过 1000 个字符");
    expect(() =>
      createProductOperation(
        shopId,
        firstSpu,
        {
          operatedAt: new Date().toISOString(),
          content: "操作",
          note: "a".repeat(3001),
        },
        actor,
      ),
    ).toThrow("备注不能超过 3000 个字符");
  });
});
