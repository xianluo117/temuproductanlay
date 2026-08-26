import type {
  GlobalOperationInput,
  GlobalOperationRecord,
  UserAccount,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";

interface GlobalOperationRow {
  id: number;
  operated_at: string;
  content: string;
  note: string | null;
  created_by_username: string;
  updated_by_username: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: GlobalOperationRow): GlobalOperationRecord {
  return {
    id: row.id,
    operatedAt: row.operated_at,
    content: row.content,
    note: row.note,
    createdByUsername: row.created_by_username,
    updatedByUsername: row.updated_by_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeInput(input: GlobalOperationInput): GlobalOperationInput {
  const content = input.content.trim();
  const note = input.note?.trim() || null;
  const operatedAt = new Date(input.operatedAt);
  if (Number.isNaN(operatedAt.getTime())) throw new Error("操作日期时间无效。");
  if (!content) throw new Error("操作内容不能为空。");
  if (content.length > 1000) throw new Error("操作内容不能超过 1000 个字符。");
  if (note && note.length > 3000) throw new Error("备注不能超过 3000 个字符。");
  return { operatedAt: operatedAt.toISOString(), content, note };
}

const operationSelect = `
  SELECT operation.id, operation.operated_at, operation.content, operation.note,
    creator.username AS created_by_username, updater.username AS updated_by_username,
    operation.created_at, operation.updated_at
  FROM global_operation_records operation
  JOIN users creator ON creator.id = operation.created_by_user_id
  JOIN users updater ON updater.id = operation.updated_by_user_id`;

function getGlobalOperation(shopId: number, id: number): GlobalOperationRecord {
  const row = database
    .prepare(
      `${operationSelect}
    WHERE operation.shop_profile_id = ? AND operation.id = ?
  `,
    )
    .get(shopId, id) as GlobalOperationRow | undefined;
  if (!row) throw new Error("全局操作记录不存在。");
  return mapRow(row);
}

function addAudit(
  shopId: number,
  recordId: number | null,
  action: "create" | "update" | "delete",
  actor: UserAccount,
  payload: unknown,
): void {
  database
    .prepare(
      `
    INSERT INTO global_operation_audit
    (shop_profile_id, operation_record_id, action, operator_user_id, operator_username, payload_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      shopId,
      recordId,
      action,
      actor.id,
      actor.username,
      JSON.stringify(payload),
    );
}

export function listGlobalOperations(shopId: number): GlobalOperationRecord[] {
  return (
    database
      .prepare(
        `${operationSelect}
    WHERE operation.shop_profile_id = ?
    ORDER BY operation.operated_at DESC, operation.id DESC
  `,
      )
      .all(shopId) as GlobalOperationRow[]
  ).map(mapRow);
}

export function createGlobalOperation(
  shopId: number,
  input: GlobalOperationInput,
  actor: UserAccount,
): GlobalOperationRecord {
  const value = normalizeInput(input);
  const result = database
    .prepare(
      `
    INSERT INTO global_operation_records
    (shop_profile_id, operated_at, content, note, created_by_user_id, updated_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      shopId,
      value.operatedAt,
      value.content,
      value.note,
      actor.id,
      actor.id,
    );
  const record = getGlobalOperation(shopId, Number(result.lastInsertRowid));
  addAudit(shopId, record.id, "create", actor, record);
  return record;
}

export function updateGlobalOperation(
  shopId: number,
  id: number,
  input: GlobalOperationInput,
  actor: UserAccount,
): GlobalOperationRecord {
  const before = getGlobalOperation(shopId, id);
  const value = normalizeInput(input);
  const result = database
    .prepare(
      `
    UPDATE global_operation_records
    SET operated_at = ?, content = ?, note = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE shop_profile_id = ? AND id = ?
  `,
    )
    .run(value.operatedAt, value.content, value.note, actor.id, shopId, id);
  if (result.changes === 0) throw new Error("全局操作记录不存在。");
  const record = getGlobalOperation(shopId, id);
  addAudit(shopId, id, "update", actor, { before, after: record });
  return record;
}

export function deleteGlobalOperation(
  shopId: number,
  id: number,
  actor: UserAccount,
): void {
  const before = getGlobalOperation(shopId, id);
  const transaction = database.transaction(() => {
    addAudit(shopId, id, "delete", actor, before);
    const result = database
      .prepare(
        "DELETE FROM global_operation_records WHERE shop_profile_id = ? AND id = ?",
      )
      .run(shopId, id);
    if (result.changes === 0) throw new Error("全局操作记录不存在。");
  });
  transaction();
}
