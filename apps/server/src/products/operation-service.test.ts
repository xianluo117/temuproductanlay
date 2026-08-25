import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '../database/index.js';
import {
  createProductOperation,
  deleteProductOperation,
  listProductOperations,
  updateProductOperation,
} from './operation-service.js';

const firstSpu = '__operation_test_spu_1__';
const secondSpu = '__operation_test_spu_2__';

function removeFixtures(): void {
  database.prepare('DELETE FROM product_operation_records WHERE spu IN (?, ?)').run(firstSpu, secondSpu);
  database.prepare('DELETE FROM products WHERE spu IN (?, ?)').run(firstSpu, secondSpu);
}

beforeAll(() => {
  removeFixtures();
  database.prepare('INSERT INTO products (spu) VALUES (?), (?)').run(firstSpu, secondSpu);
});

afterAll(() => {
  removeFixtures();
});

describe('product operation service', () => {
  it('creates records and lists them by operated time descending within each SPU', () => {
    createProductOperation(firstSpu, {
      operatedAt: '2026-08-23T02:00:00.000Z',
      content: '调整主图',
      note: null,
    });
    const newest = createProductOperation(firstSpu, {
      operatedAt: '2026-08-24T03:00:00.000Z',
      content: '修改标题',
      note: '观察点击率',
    });
    createProductOperation(secondSpu, {
      operatedAt: '2026-08-25T04:00:00.000Z',
      content: '其他 SPU 操作',
      note: null,
    });

    const records = listProductOperations(firstSpu);
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe(newest.id);
    expect(records.map((record) => record.content)).toEqual(['修改标题', '调整主图']);
    expect(records.every((record) => record.spu === firstSpu)).toBe(true);
  });

  it('updates and deletes an operation record', () => {
    const record = createProductOperation(firstSpu, {
      operatedAt: '2026-08-22T01:00:00.000Z',
      content: '原操作',
      note: null,
    });
    const updated = updateProductOperation(firstSpu, record.id, {
      operatedAt: '2026-08-26T05:00:00.000Z',
      content: '更新后的操作',
      note: '更新后的备注',
    });
    expect(updated).toMatchObject({ content: '更新后的操作', note: '更新后的备注' });

    deleteProductOperation(firstSpu, record.id);
    expect(listProductOperations(firstSpu).some((item) => item.id === record.id)).toBe(false);
  });

  it('validates the SPU, date, required content and field lengths', () => {
    expect(() => createProductOperation('__missing_spu__', {
      operatedAt: new Date().toISOString(), content: '操作', note: null,
    })).toThrow('未找到该 SPU');
    expect(() => createProductOperation(firstSpu, {
      operatedAt: 'invalid', content: '操作', note: null,
    })).toThrow('操作日期时间无效');
    expect(() => createProductOperation(firstSpu, {
      operatedAt: new Date().toISOString(), content: '   ', note: null,
    })).toThrow('操作内容不能为空');
    expect(() => createProductOperation(firstSpu, {
      operatedAt: new Date().toISOString(), content: 'a'.repeat(1001), note: null,
    })).toThrow('操作内容不能超过 1000 个字符');
    expect(() => createProductOperation(firstSpu, {
      operatedAt: new Date().toISOString(), content: '操作', note: 'a'.repeat(3001),
    })).toThrow('备注不能超过 3000 个字符');
  });
});
