import type { GlobalOperationInput, GlobalOperationRecord } from '@temu-analytics/shared';
import { database } from '../database/index.js';

interface GlobalOperationRow { id: number; operated_at: string; content: string; note: string | null; created_at: string; updated_at: string }

function mapRow(row: GlobalOperationRow): GlobalOperationRecord {
  return { id: row.id, operatedAt: row.operated_at, content: row.content, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at };
}

function normalizeInput(input: GlobalOperationInput): GlobalOperationInput {
  const content = input.content.trim();
  const note = input.note?.trim() || null;
  const operatedAt = new Date(input.operatedAt);
  if (Number.isNaN(operatedAt.getTime())) throw new Error('操作日期时间无效。');
  if (!content) throw new Error('操作内容不能为空。');
  if (content.length > 1000) throw new Error('操作内容不能超过 1000 个字符。');
  if (note && note.length > 3000) throw new Error('备注不能超过 3000 个字符。');
  return { operatedAt: operatedAt.toISOString(), content, note };
}

function getGlobalOperation(ownerId: number, id: number): GlobalOperationRecord {
  const row = database.prepare(`
    SELECT id, operated_at, content, note, created_at, updated_at
    FROM global_operation_records WHERE owner_id = ? AND id = ?
  `).get(ownerId, id) as GlobalOperationRow | undefined;
  if (!row) throw new Error('全局操作记录不存在。');
  return mapRow(row);
}

export function listGlobalOperations(): GlobalOperationRecord[];
export function listGlobalOperations(ownerId: number): GlobalOperationRecord[];
export function listGlobalOperations(ownerId = 1): GlobalOperationRecord[] {
  return (database.prepare(`
    SELECT id, operated_at, content, note, created_at, updated_at
    FROM global_operation_records WHERE owner_id = ? ORDER BY operated_at DESC, id DESC
  `).all(ownerId) as GlobalOperationRow[]).map(mapRow);
}

export function createGlobalOperation(input: GlobalOperationInput): GlobalOperationRecord;
export function createGlobalOperation(ownerId: number, input: GlobalOperationInput): GlobalOperationRecord;
export function createGlobalOperation(ownerOrInput: number | GlobalOperationInput, requestedInput?: GlobalOperationInput): GlobalOperationRecord {
  const ownerId = typeof ownerOrInput === 'number' ? ownerOrInput : 1;
  const input = (typeof ownerOrInput === 'number' ? requestedInput : ownerOrInput)!;
  const value = normalizeInput(input);
  const result = database.prepare(`
    INSERT INTO global_operation_records (owner_id, operated_at, content, note) VALUES (?, ?, ?, ?)
  `).run(ownerId, value.operatedAt, value.content, value.note);
  return getGlobalOperation(ownerId, Number(result.lastInsertRowid));
}

export function updateGlobalOperation(id: number, input: GlobalOperationInput): GlobalOperationRecord;
export function updateGlobalOperation(ownerId: number, id: number, input: GlobalOperationInput): GlobalOperationRecord;
export function updateGlobalOperation(ownerOrId: number, idOrInput: number | GlobalOperationInput, requestedInput?: GlobalOperationInput): GlobalOperationRecord {
  const legacy = typeof idOrInput !== 'number';
  const ownerId = legacy ? 1 : ownerOrId;
  const id = legacy ? ownerOrId : idOrInput;
  const input = (legacy ? idOrInput : requestedInput) as GlobalOperationInput;
  const value = normalizeInput(input);
  const result = database.prepare(`
    UPDATE global_operation_records SET operated_at = ?, content = ?, note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE owner_id = ? AND id = ?
  `).run(value.operatedAt, value.content, value.note, ownerId, id);
  if (result.changes === 0) throw new Error('全局操作记录不存在。');
  return getGlobalOperation(ownerId, id);
}

export function deleteGlobalOperation(id: number): void;
export function deleteGlobalOperation(ownerId: number, id: number): void;
export function deleteGlobalOperation(ownerOrId: number, requestedId?: number): void {
  const ownerId = requestedId === undefined ? 1 : ownerOrId;
  const id = requestedId ?? ownerOrId;
  const result = database.prepare('DELETE FROM global_operation_records WHERE owner_id = ? AND id = ?').run(ownerId, id);
  if (result.changes === 0) throw new Error('全局操作记录不存在。');
}
