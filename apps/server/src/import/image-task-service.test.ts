import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '../database/index.js';
import { getBatchImageProgress, stopImageTaskProcessor } from './image-task-service.js';

const spu = '__image_task_test_spu__';
let batchId = 0;

function cleanup(): void {
  database.prepare('DELETE FROM remote_image_tasks WHERE spu = ?').run(spu);
  database.prepare('DELETE FROM products WHERE spu = ?').run(spu);
  if (batchId > 0) database.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId);
}

beforeAll(() => {
  stopImageTaskProcessor();
  cleanup();
  database.prepare('INSERT INTO products (spu) VALUES (?)').run(spu);
  const result = database.prepare(`
    INSERT INTO import_batches
      (file_name, stored_file_name, file_hash, data_date, row_count, status, issues_json)
    VALUES ('task-test.xlsx', 'task-test.xlsx', 'task-test', '2099-01-01', 1, 'completed', '[]')
  `).run();
  batchId = Number(result.lastInsertRowid);
});

afterAll(() => {
  cleanup();
});

describe('remote image task progress', () => {
  it('returns a completed progress for a batch without tasks', () => {
    expect(getBatchImageProgress(batchId)).toEqual({
      total: 0, pending: 0, processing: 0, completed: 0, failed: 0, cancelled: 0, percent: 100,
    });
  });

  it('aggregates pending, processing, completed, failed and cancelled tasks', () => {
    const insert = database.prepare(`
      INSERT INTO remote_image_tasks (batch_id, spu, image_url, status)
      VALUES (?, ?, ?, ?)
    `);
    insert.run(batchId, spu, 'https://example.test/1.jpg', 'pending');
    insert.run(batchId, spu, 'https://example.test/2.jpg', 'processing');
    insert.run(batchId, spu, 'https://example.test/3.jpg', 'completed');
    insert.run(batchId, spu, 'https://example.test/4.jpg', 'failed');
    insert.run(batchId, spu, 'https://example.test/5.jpg', 'cancelled');

    expect(getBatchImageProgress(batchId)).toEqual({
      total: 5, pending: 1, processing: 1, completed: 1, failed: 1, cancelled: 1, percent: 60,
    });
  });
});
