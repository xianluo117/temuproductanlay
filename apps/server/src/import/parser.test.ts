import { describe, expect, it } from 'vitest';
import { extractDataDate, parseTemuWorkbook } from './parser.js';

const sampleFile = '../../Temu商品数据_20260824_115757.xlsx';

describe('Temu Excel parser', () => {
  it('extracts the data date from a Temu file name', () => {
    expect(extractDataDate('Temu商品数据_20260824_115757.xlsx')).toBe('2026-08-24');
  });

  it('parses metrics and embedded images from the supplied workbook', async () => {
    const workbook = await parseTemuWorkbook(sampleFile, 'Temu商品数据_20260824_115757.xlsx');
    expect(workbook.dataDate).toBe('2026-08-24');
    expect(workbook.rows).toHaveLength(25);
    expect(workbook.embeddedImageCount).toBe(25);
    expect(workbook.remoteImageCount).toBe(25);
    expect(workbook.issues).toHaveLength(0);
    expect(workbook.rows[0]).toMatchObject({
      spu: '4308587831',
      impressions: 836,
      clicks: 52,
      orders: 3,
    });
    expect(workbook.rows[0]!.detailPaymentConversionRate).toBeCloseTo(0.0357, 6);
  });
});
