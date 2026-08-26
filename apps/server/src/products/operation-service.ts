import type {
  ProductBatchOperationResult,
  ProductOperationInput,
  ProductOperationRecord,
  UserAccount,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";

interface OperationRow {
  id: number;
  spu: string;
  operated_at: string;
  content: string;
  note: string | null;
  created_by_username: string;
  updated_by_username: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: OperationRow): ProductOperationRecord {
  return {
    id: row.id,
    spu: row.spu,
    operatedAt: row.operated_at,
    content: row.content,
    note: row.note,
    createdByUsername: row.created_by_username,
    updatedByUsername: row.updated_by_username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeInput(input: ProductOperationInput): ProductOperationInput {
  const content = input.content.trim();
  const note = input.note?.trim() || null;
  const operatedAt = new Date(input.operatedAt);
  if (Number.isNaN(operatedAt.getTime())) throw new Error("操作日期时间无效。");
  if (!content) throw new Error("操作内容不能为空。");
  if (content.length > 1000) throw new Error("操作内容不能超过 1000 个字符。");
  if (note && note.length > 3000) throw new Error("备注不能超过 3000 个字符。");
  return { operatedAt: operatedAt.toISOString(), content, note };
}

function ensureProduct(shopId: number, spu: string): void {
  const product = database
    .prepare("SELECT 1 FROM products WHERE shop_profile_id = ? AND spu = ?")
    .get(shopId, spu);
  if (!product) throw new Error("当前店铺未找到该 SPU，无法保存操作记录。");
}

const operationSelect = `
  SELECT operation.id, operation.spu, operation.operated_at, operation.content,
    operation.note, creator.username AS created_by_username,
    updater.username AS updated_by_username, operation.created_at, operation.updated_at
  FROM product_operation_records operation
  JOIN users creator ON creator.id = operation.created_by_user_id
  JOIN users updater ON updater.id = operation.updated_by_user_id`;

function getProductOperation(
  shopId: number,
  spu: string,
  id: number,
): ProductOperationRecord {
  const row = database
    .prepare(
      `${operationSelect}
    WHERE operation.shop_profile_id = ? AND operation.id = ? AND operation.spu = ?
  `,
    )
    .get(shopId, id, spu) as OperationRow | undefined;
  if (!row) throw new Error("操作记录不存在。");
  return mapRow(row);
}

function addAudit(
  shopId: number,
  spu: string,
  recordId: number | null,
  action: "create" | "update" | "delete",
  actor: UserAccount,
  payload: unknown,
): void {
  database
    .prepare(
      `
    INSERT INTO product_operation_audit
    (shop_profile_id, spu, operation_record_id, action, operator_user_id, operator_username, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      shopId,
      spu,
      recordId,
      action,
      actor.id,
      actor.username,
      JSON.stringify(payload),
    );
}

export function listProductOperations(
  shopId: number,
  spu: string,
): ProductOperationRecord[] {
  ensureProduct(shopId, spu);
  return (
    database
      .prepare(
        `${operationSelect}
    WHERE operation.shop_profile_id = ? AND operation.spu = ?
    ORDER BY operation.operated_at DESC, operation.id DESC
  `,
      )
      .all(shopId, spu) as OperationRow[]
  ).map(mapRow);
}

export function createProductOperation(
  shopId: number,
  spu: string,
  input: ProductOperationInput,
  actor: UserAccount,
): ProductOperationRecord {
  ensureProduct(shopId, spu);
  const value = normalizeInput(input);
  const result = database
    .prepare(
      `
    INSERT INTO product_operation_records
    (shop_profile_id, spu, operated_at, content, note, created_by_user_id, updated_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      shopId,
      spu,
      value.operatedAt,
      value.content,
      value.note,
      actor.id,
      actor.id,
    );
  const record = getProductOperation(
    shopId,
    spu,
    Number(result.lastInsertRowid),
  );
  addAudit(shopId, spu, record.id, "create", actor, record);
  return record;
}

export function createProductOperationsBatch(
  shopId: number,
  spus: string[],
  input: ProductOperationInput,
  actor: UserAccount,
): ProductBatchOperationResult {
  const uniqueSpus = [
    ...new Set(spus.map((spu) => spu.trim()).filter(Boolean)),
  ];
  if (uniqueSpus.length === 0) throw new Error("请至少选择一个 SPU。");
  if (uniqueSpus.length > 500)
    throw new Error("单次最多为 500 个 SPU 添加操作记录。");
  const value = normalizeInput(input);
  const succeededSpus: string[] = [];
  const failures: ProductBatchOperationResult["failures"] = [];
  for (const spu of uniqueSpus) {
    try {
      ensureProduct(shopId, spu);
      const result = database
        .prepare(
          `
        INSERT INTO product_operation_records
        (shop_profile_id, spu, operated_at, content, note, created_by_user_id, updated_by_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          shopId,
          spu,
          value.operatedAt,
          value.content,
          value.note,
          actor.id,
          actor.id,
        );
      const record = getProductOperation(
        shopId,
        spu,
        Number(result.lastInsertRowid),
      );
      addAudit(shopId, spu, record.id, "create", actor, record);
      succeededSpus.push(spu);
    } catch (error) {
      failures.push({
        spu,
        reason: error instanceof Error ? error.message : "保存失败。",
      });
    }
  }
  return {
    requestedCount: uniqueSpus.length,
    successCount: succeededSpus.length,
    succeededSpus,
    failures,
  };
}

export function updateProductOperation(
  shopId: number,
  spu: string,
  id: number,
  input: ProductOperationInput,
  actor: UserAccount,
): ProductOperationRecord {
  ensureProduct(shopId, spu);
  const before = getProductOperation(shopId, spu, id);
  const value = normalizeInput(input);
  const result = database
    .prepare(
      `
    UPDATE product_operation_records
    SET operated_at = ?, content = ?, note = ?, updated_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE shop_profile_id = ? AND id = ? AND spu = ?
  `,
    )
    .run(
      value.operatedAt,
      value.content,
      value.note,
      actor.id,
      shopId,
      id,
      spu,
    );
  if (result.changes === 0) throw new Error("操作记录不存在。");
  const record = getProductOperation(shopId, spu, id);
  addAudit(shopId, spu, id, "update", actor, { before, after: record });
  return record;
}

export function deleteProductOperation(
  shopId: number,
  spu: string,
  id: number,
  actor: UserAccount,
): void {
  ensureProduct(shopId, spu);
  const before = getProductOperation(shopId, spu, id);
  const transaction = database.transaction(() => {
    addAudit(shopId, spu, id, "delete", actor, before);
    const result = database
      .prepare(
        "DELETE FROM product_operation_records WHERE shop_profile_id = ? AND id = ? AND spu = ?",
      )
      .run(shopId, id, spu);
    if (result.changes === 0) throw new Error("操作记录不存在。");
  });
  transaction();
}
