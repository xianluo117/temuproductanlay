import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '../database/index.js';
import { authenticateUser, getSession, registerUser, createSession, setActiveOwner, updateUser } from './auth-service.js';
import { getProducts, parseSpuSearchTokens } from '../analytics/analytics-service.js';
import { getSpuComparison, listSpuComparisonCandidates } from '../analytics/comparison-service.js';
import { createProductOperationsBatch, listProductOperations } from '../products/operation-service.js';

const suffix = Math.random().toString(36).slice(2, 10);
const firstName = `tenant_a_${suffix}`;
const secondName = `tenant_b_${suffix}`;
let firstId = 0;
let secondId = 0;

beforeAll(() => {
  firstId = registerUser({ username: firstName, password: 'Password123!' }).id;
  secondId = registerUser({ username: secondName, password: 'Password123!' }).id;
  database.prepare('INSERT INTO products (owner_id, spu) VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)')
    .run(firstId, 'SAME-SPU', secondId, 'SAME-SPU', firstId, 'COMPARE-A', firstId, 'COMPARE-B', secondId, 'COMPARE-A');
  const batch = database.prepare(`INSERT INTO import_batches (owner_id, file_name, stored_file_name, file_hash, data_date, row_count, status) VALUES (?, ?, ?, ?, ?, ?, 'completed')`);
  const firstBatch = Number(batch.run(firstId, 'a.xlsx', 'a.xlsx', 'a', '2026-08-24', 5).lastInsertRowid);
  const secondBatch = Number(batch.run(secondId, 'b.xlsx', 'b.xlsx', 'b', '2026-08-24', 2).lastInsertRowid);
  const metric = database.prepare(`INSERT INTO daily_metrics
    (owner_id, data_date, spu, batch_id, impressions, clicks, visitors, cart_users, orders, detail_paid_buyers, detail_payment_conversion_rate, impression_order_conversion_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  metric.run(firstId, '2026-08-24', 'SAME-SPU', firstBatch, 100, 10, 8, 4, 1, 1, 0.25, 0.01);
  metric.run(secondId, '2026-08-24', 'SAME-SPU', secondBatch, 900, 90, 70, 30, 9, 8, 0.2667, 0.01);
  metric.run(firstId, '2026-08-23', 'COMPARE-A', firstBatch, 80, 8, 7, 3, 1, 1, 0.3333, 0.0125);
  metric.run(firstId, '2026-08-24', 'COMPARE-A', firstBatch, 120, 18, 14, 7, 3, 2, 0.2857, 0.025);
  metric.run(firstId, '2026-08-23', 'COMPARE-B', firstBatch, 100, 12, 9, 4, 2, 2, 0.5, 0.02);
  metric.run(firstId, '2026-08-24', 'COMPARE-B', firstBatch, 160, 24, 20, 10, 5, 4, 0.4, 0.03125);
  metric.run(secondId, '2026-08-24', 'COMPARE-A', secondBatch, 999, 99, 80, 40, 10, 9, 0.225, 0.01001);
});

afterAll(() => {
  database.prepare('DELETE FROM users WHERE id IN (?, ?)').run(firstId, secondId);
});

describe('authentication and tenant isolation', () => {
  it('authenticates registered users and rejects wrong passwords', () => {
    expect(authenticateUser({ username: firstName, password: 'Password123!' }).id).toBe(firstId);
    expect(() => authenticateUser({ username: firstName, password: 'wrong-password' })).toThrow('用户名或密码错误');
  });

  it('isolates identical SPUs by owner', () => {
    expect(getProducts(firstId, { date: '2026-08-24', search: 'SAME-SPU' })[0]?.impressions).toBe(100);
    expect(getProducts(secondId, { date: '2026-08-24', search: 'SAME-SPU' })[0]?.impressions).toBe(900);
  });

  it('prevents normal users from switching owners and invalidates disabled sessions', () => {
    const session = createSession(firstId);
    const auth = getSession(session.id)!;
    expect(() => setActiveOwner(session.id, auth.user, secondId)).toThrow('无权切换数据账号');
    updateUser(1, firstId, { enabled: false });
    expect(getSession(session.id)).toBeNull();
    updateUser(1, firstId, { enabled: true });
  });

  it('parses and exact-matches multiple SPUs while preserving tenant isolation', () => {
    expect(parseSpuSearchTokens(' SAME-SPU， MISSING, SAME-SPU ')).toEqual(['SAME-SPU', 'MISSING']);
    const first = getProducts(firstId, { date: '2026-08-24', search: 'SAME-SPU MISSING' });
    const second = getProducts(secondId, { date: '2026-08-24', search: 'SAME-SPU,MISSING' });
    expect(first.map((item) => item.impressions)).toEqual([100]);
    expect(second.map((item) => item.impressions)).toEqual([900]);
  });

  it('compares 2-5 SPUs on their latest common date with tenant-isolated histories', () => {
    const candidates = listSpuComparisonCandidates(firstId);
    expect(candidates.map((item) => item.spu)).toEqual(['COMPARE-A', 'COMPARE-B', 'SAME-SPU']);
    const comparison = getSpuComparison(firstId, ['COMPARE-A', 'COMPARE-B']);
    expect(comparison.selectedDate).toBe('2026-08-24');
    expect(comparison.commonDates).toEqual(['2026-08-24', '2026-08-23']);
    expect(comparison.products.map((item) => item.selected.impressions)).toEqual([120, 160]);
    expect(comparison.products[0]?.history.map((item) => item.date)).toEqual(['2026-08-23', '2026-08-24']);
    expect(getSpuComparison(firstId, ['COMPARE-A', 'COMPARE-B'], '2026-08-23').selectedDate).toBe('2026-08-23');
    expect(() => getSpuComparison(firstId, ['COMPARE-A', 'COMPARE-A'])).toThrow('请选择 2-5 个不同的 SPU');
    expect(() => getSpuComparison(firstId, ['COMPARE-A', 'MISSING'])).toThrow('未找到 SPU');
    expect(() => getSpuComparison(secondId, ['COMPARE-A', 'COMPARE-B'])).toThrow('未找到 SPU');
  });

  it('sorts conversion rates and creates batch operations with partial success', () => {
    const sorted = getProducts(firstId, { date: '2026-08-24', sort: 'detailPaymentConversionRate', order: 'asc' });
    expect(sorted.map((item) => item.spu)).toEqual(['SAME-SPU', 'COMPARE-A', 'COMPARE-B']);
    const result = createProductOperationsBatch(firstId, ['SAME-SPU', 'MISSING', 'SAME-SPU'], {
      operatedAt: '2026-08-24T10:00:00.000Z', content: '批量测试操作', note: null,
    });
    expect(result.successCount).toBe(1);
    expect(result.succeededSpus).toEqual(['SAME-SPU']);
    expect(result.failures).toEqual([{ spu: 'MISSING', reason: '当前数据账号中未找到该 SPU。' }]);
    expect(listProductOperations(firstId, 'SAME-SPU').some((item) => item.content === '批量测试操作')).toBe(true);
    expect(listProductOperations(secondId, 'SAME-SPU').some((item) => item.content === '批量测试操作')).toBe(false);
  });
});
