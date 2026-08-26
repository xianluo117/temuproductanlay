import type { UserAccount } from "@temu-analytics/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { database } from "../database/index.js";
import {
  createGlobalOperation,
  deleteGlobalOperation,
  listGlobalOperations,
  updateGlobalOperation,
} from "./global-operation-service.js";

const suffix = Math.random().toString(36).slice(2, 10);
let shopId = 0;
let actor: UserAccount;

function cleanup(): void {
  if (shopId > 0) {
    database
      .prepare("DELETE FROM global_operation_records WHERE shop_profile_id = ?")
      .run(shopId);
  }
}

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
      `Global Operation Test ${suffix}`,
      `global-operation-${suffix}`,
      `temu/global-operation-${suffix}`,
      15102,
      `global-operation-fingerprint-${suffix}`,
    );
  shopId = Number(result.lastInsertRowid);
});

beforeEach(cleanup);
afterAll(() => {
  database.prepare("DELETE FROM temu_shop_profiles WHERE id = ?").run(shopId);
});

describe("global operation service", () => {
  it("creates records with actor identity and lists by operation time", () => {
    createGlobalOperation(
      shopId,
      {
        operatedAt: "2026-08-23T02:00:00.000Z",
        content: "__global_test_old",
        note: null,
      },
      actor,
    );
    const newest = createGlobalOperation(
      shopId,
      {
        operatedAt: "2026-08-24T03:00:00.000Z",
        content: "__global_test_new",
        note: "全部产品",
      },
      actor,
    );
    const records = listGlobalOperations(shopId);
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe(newest.id);
    expect(records.map((record) => record.content)).toEqual([
      "__global_test_new",
      "__global_test_old",
    ]);
    expect(records[0]).toMatchObject({
      createdByUsername: actor.username,
      updatedByUsername: actor.username,
    });
  });

  it("updates, deletes and audits a record", () => {
    const record = createGlobalOperation(
      shopId,
      {
        operatedAt: "2026-08-22T01:00:00.000Z",
        content: "__global_test_original",
        note: null,
      },
      actor,
    );
    const updated = updateGlobalOperation(
      shopId,
      record.id,
      {
        operatedAt: "2026-08-25T04:00:00.000Z",
        content: "__global_test_updated",
        note: "更新备注",
      },
      actor,
    );
    expect(updated).toMatchObject({
      content: "__global_test_updated",
      note: "更新备注",
      updatedByUsername: actor.username,
    });
    deleteGlobalOperation(shopId, record.id, actor);
    expect(
      listGlobalOperations(shopId).some((item) => item.id === record.id),
    ).toBe(false);
    const audit = database
      .prepare(
        `SELECT action, operator_username
         FROM global_operation_audit
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

  it("validates date, required content and field lengths", () => {
    expect(() =>
      createGlobalOperation(
        shopId,
        { operatedAt: "invalid", content: "__global_test_date", note: null },
        actor,
      ),
    ).toThrow("操作日期时间无效");
    expect(() =>
      createGlobalOperation(
        shopId,
        {
          operatedAt: new Date().toISOString(),
          content: "   ",
          note: null,
        },
        actor,
      ),
    ).toThrow("操作内容不能为空");
    expect(() =>
      createGlobalOperation(
        shopId,
        {
          operatedAt: new Date().toISOString(),
          content: "a".repeat(1001),
          note: null,
        },
        actor,
      ),
    ).toThrow("操作内容不能超过 1000 个字符");
    expect(() =>
      createGlobalOperation(
        shopId,
        {
          operatedAt: new Date().toISOString(),
          content: "__global_test_note",
          note: "a".repeat(3001),
        },
        actor,
      ),
    ).toThrow("备注不能超过 3000 个字符");
  });
});
