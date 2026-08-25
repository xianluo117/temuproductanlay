import type { ProductBatchOperationResult, ProductOperationInput, ProductOperationRecord } from '@temu-analytics/shared';
import { database } from '../database/index.js';

interface OperationRow { id: number; spu: string; operated_at: string; content: string; note: string | null; created_at: string; updated_at: string }

function mapRow(row: OperationRow): ProductOperationRecord {
  return { id: row.id, spu: row.spu, operatedAt: row.operated_at, content: row.content, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at };
}

function ensureProduct(ownerId: number, spu: string): void {
  const product = database.prepare('SELECT 1 FROM products WHERE owner_id = ? AND spu = ?').get(ownerId, spu);
  if (!product) throw new Error('未找到该 SPU，无法保存操作记录。');
}

function normalizeInput(input: ProductOperationInput): ProductOperationInput {
  const content = input.content.trim();
  const note = input.note?.trim() || null;
  const operatedAt = new Date(input.operatedAt);
  if (Number.isNaN(operatedAt.getTime())) throw new Error('操作日期时间无效。');
  if (!content) throw new Error('操作内容不能为空。');
  if (content.length > 1000) throw new Error('操作内容不能超过 1000 个字符。');
  if (note && note.length > 3000) throw new Error('备注不能超过 3000 个字符。');
  return { operatedAt: operatedAt.toISOString(), content, note };
}

function getProductOperation(ownerId: number, spu: string, id: number): ProductOperationRecord {
  const row = database.prepare(`
    SELECT id, spu, operated_at, content, note, created_at, updated_at
    FROM product_operation_records WHERE owner_id = ? AND id = ? AND spu = ?
  `).get(ownerId, id, spu) as OperationRow | undefined;
  if (!row) throw new Error('操作记录不存在。');
  return mapRow(row);
}

export function listProductOperations(spu: string): ProductOperationRecord[];
export function listProductOperations(ownerId: number, spu: string): ProductOperationRecord[];
export function listProductOperations(ownerOrSpu: number | string, requestedSpu?: string): ProductOperationRecord[] {
  const ownerId = typeof ownerOrSpu === 'number' ? ownerOrSpu : 1;
  const spu = typeof ownerOrSpu === 'string' ? ownerOrSpu : requestedSpu!;
  ensureProduct(ownerId, spu);
  return (database.prepare(`
    SELECT id, spu, operated_at, content, note, created_at, updated_at
    FROM product_operation_records WHERE owner_id = ? AND spu = ? ORDER BY operated_at DESC, id DESC
  `).all(ownerId, spu) as OperationRow[]).map(mapRow);
}

export function createProductOperation(spu: string, input: ProductOperationInput): ProductOperationRecord;
export function createProductOperation(ownerId: number, spu: string, input: ProductOperationInput): ProductOperationRecord;
export function createProductOperation(ownerOrSpu: number | string, spuOrInput: string | ProductOperationInput, requestedInput?: ProductOperationInput): ProductOperationRecord {
  const ownerId = typeof ownerOrSpu === 'number' ? ownerOrSpu : 1;
  const spu = typeof ownerOrSpu === 'string' ? ownerOrSpu : spuOrInput as string;
  const input = (typeof ownerOrSpu === 'string' ? spuOrInput : requestedInput) as ProductOperationInput;
  ensureProduct(ownerId, spu);
  const value = normalizeInput(input);
  const result = database.prepare(`
    INSERT INTO product_operation_records (owner_id, spu, operated_at, content, note) VALUES (?, ?, ?, ?, ?)
  `).run(ownerId, spu, value.operatedAt, value.content, value.note);
  return getProductOperation(ownerId, spu, Number(result.lastInsertRowid));
}

export function createProductOperationsBatch(ownerId: number, spus: string[], input: ProductOperationInput): ProductBatchOperationResult {
  const uniqueSpus = [...new Set(spus.map((spu) => spu.trim()).filter(Boolean))];
  if (uniqueSpus.length === 0) throw new Error('请至少选择一个 SPU。');
  if (uniqueSpus.length > 500) throw new Error('单次最多为 500 个 SPU 添加操作记录。');
  const value = normalizeInput(input);
  const exists = database.prepare('SELECT 1 FROM products WHERE owner_id = ? AND spu = ?');
  const insert = database.prepare(`
    INSERT INTO product_operation_records (owner_id, spu, operated_at, content, note) VALUES (?, ?, ?, ?, ?)
  `);
  const succeededSpus: string[] = [];
  const failures: ProductBatchOperationResult['failures'] = [];
  for (const spu of uniqueSpus) {
    if (!exists.get(ownerId, spu)) {
      failures.push({ spu, reason: '当前数据账号中未找到该 SPU。' });
      continue;
    }
    try {
      insert.run(ownerId, spu, value.operatedAt, value.content, value.note);
      succeededSpus.push(spu);
    } catch (error) {
      failures.push({ spu, reason: error instanceof Error ? error.message : '保存失败。' });
    }
  }
  return { requestedCount: uniqueSpus.length, successCount: succeededSpus.length, succeededSpus, failures };
}

export function updateProductOperation(spu: string, id: number, input: ProductOperationInput): ProductOperationRecord;
export function updateProductOperation(ownerId: number, spu: string, id: number, input: ProductOperationInput): ProductOperationRecord;
export function updateProductOperation(ownerOrSpu: number | string, spuOrId: string | number, idOrInput: number | ProductOperationInput, requestedInput?: ProductOperationInput): ProductOperationRecord {
  const ownerId = typeof ownerOrSpu === 'number' ? ownerOrSpu : 1;
  const spu = typeof ownerOrSpu === 'string' ? ownerOrSpu : spuOrId as string;
  const id = (typeof ownerOrSpu === 'string' ? spuOrId : idOrInput) as number;
  const input = (typeof ownerOrSpu === 'string' ? idOrInput : requestedInput) as ProductOperationInput;
  ensureProduct(ownerId, spu);
  const value = normalizeInput(input);
  const result = database.prepare(`
    UPDATE product_operation_records SET operated_at = ?, content = ?, note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE owner_id = ? AND id = ? AND spu = ?
  `).run(value.operatedAt, value.content, value.note, ownerId, id, spu);
  if (result.changes === 0) throw new Error('操作记录不存在。');
  return getProductOperation(ownerId, spu, id);
}

export function deleteProductOperation(spu: string, id: number): void;
export function deleteProductOperation(ownerId: number, spu: string, id: number): void;
export function deleteProductOperation(ownerOrSpu: number | string, spuOrId: string | number, requestedId?: number): void {
  const ownerId = typeof ownerOrSpu === 'number' ? ownerOrSpu : 1;
  const spu = typeof ownerOrSpu === 'string' ? ownerOrSpu : spuOrId as string;
  const id = (typeof ownerOrSpu === 'string' ? spuOrId : requestedId) as number;
  ensureProduct(ownerId, spu);
  const result = database.prepare('DELETE FROM product_operation_records WHERE owner_id = ? AND id = ? AND spu = ?').run(ownerId, id, spu);
  if (result.changes === 0) throw new Error('操作记录不存在。');
}
