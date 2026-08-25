import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { database } from '../database/index.js';
import {
  createGlobalOperation,
  deleteGlobalOperation,
  listGlobalOperations,
  updateGlobalOperation,
} from './global-operation-service.js';

function cleanup(): void {
  database.prepare("DELETE FROM global_operation_records WHERE content LIKE '__global_test_%'").run();
}

beforeEach(cleanup);
afterAll(cleanup);

describe('global operation service', () => {
  it('creates records and lists them by operation time descending', () => {
    createGlobalOperation({ operatedAt: '2026-08-23T02:00:00.000Z', content: '__global_test_old', note: null });
    const newest = createGlobalOperation({ operatedAt: '2026-08-24T03:00:00.000Z', content: '__global_test_new', note: '全部产品' });
    const records = listGlobalOperations().filter((record) => record.content.startsWith('__global_test_'));
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe(newest.id);
    expect(records.map((record) => record.content)).toEqual(['__global_test_new', '__global_test_old']);
  });

  it('updates and deletes a record', () => {
    const record = createGlobalOperation({ operatedAt: '2026-08-22T01:00:00.000Z', content: '__global_test_original', note: null });
    const updated = updateGlobalOperation(record.id, { operatedAt: '2026-08-25T04:00:00.000Z', content: '__global_test_updated', note: '更新备注' });
    expect(updated).toMatchObject({ content: '__global_test_updated', note: '更新备注' });
    deleteGlobalOperation(record.id);
    expect(listGlobalOperations().some((item) => item.id === record.id)).toBe(false);
  });

  it('validates date, required content and field lengths', () => {
    expect(() => createGlobalOperation({ operatedAt: 'invalid', content: '__global_test_date', note: null })).toThrow('操作日期时间无效');
    expect(() => createGlobalOperation({ operatedAt: new Date().toISOString(), content: '   ', note: null })).toThrow('操作内容不能为空');
    expect(() => createGlobalOperation({ operatedAt: new Date().toISOString(), content: 'a'.repeat(1001), note: null })).toThrow('操作内容不能超过 1000 个字符');
    expect(() => createGlobalOperation({ operatedAt: new Date().toISOString(), content: '__global_test_note', note: 'a'.repeat(3001) })).toThrow('备注不能超过 3000 个字符');
  });
});
