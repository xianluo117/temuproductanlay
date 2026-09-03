import ExcelJS from 'exceljs';
import type { CellValue, ImageRange, Worksheet } from 'exceljs';
import type { ImportIssue } from '@temu-analytics/shared';
import type { ParsedImage, ParsedProductRow, ParsedWorkbook } from './types.js';

const EXPECTED_HEADERS = [
  'SPU',
  '图片',
  '图片URL',
  '首次加入站点时间',
  '曝光量',
  '点击量',
  '访客量',
  '加购人数',
  '订单量',
  '商详支付买家数',
  '商详支付转化率',
  '曝光订单转化率',
  '（曝光量）搜索数据',
] as const;

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return cellText(value.result as CellValue);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join('');
    }
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return value.hyperlink;
    }
  }
  return String(value).trim();
}

function parseDate(value: CellValue): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 86_400_000).toISOString().slice(0, 10);
  }
  const text = cellText(value).trim();
  if (!text || text === '-') return null;
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`;
}

function parseNonNegativeInteger(
  value: CellValue,
  row: number,
  field: string,
  issues: ImportIssue[],
): number {
  const text = cellText(value).replace(/,/g, '').trim();
  if (!text || text === '-') return 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push({ row, field, severity: 'error', message: `${field}不是有效的非负数：${text}` });
    return 0;
  }
  if (!Number.isInteger(parsed)) {
    issues.push({ row, field, severity: 'warning', message: `${field}已四舍五入为整数：${text}` });
  }
  return Math.round(parsed);
}

function parseRate(
  value: CellValue,
  row: number,
  field: string,
  issues: ImportIssue[],
): number | null {
  const text = cellText(value).trim();
  if (!text || text === '-') return null;
  const normalized = text.endsWith('%') ? text.slice(0, -1) : text;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    issues.push({ row, field, severity: 'error', message: `${field}不是有效百分比：${text}` });
    return null;
  }
  const decimal = text.endsWith('%') || parsed > 1 ? parsed / 100 : parsed;
  if (decimal > 1) {
    issues.push({ row, field, severity: 'warning', message: `${field}大于100%：${text}` });
  }
  return decimal;
}

export function extractDataDate(fileName: string): string {
  const match = fileName.match(/(?:^|_)(\d{4})(\d{2})(\d{2})(?:_|\.)/);
  if (!match) {
    throw new Error('无法从文件名提取统计日期，请使用包含 YYYYMMDD 的 Temu 数据文件名。');
  }
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`文件名中的统计日期无效：${date}`);
  }
  return date;
}

function extractHttpUrl(value: CellValue): string | null {
  if (typeof value === 'object' && value && 'hyperlink' in value && typeof value.hyperlink === 'string') {
    return /^https?:\/\//i.test(value.hyperlink) ? value.hyperlink : null;
  }
  const text = cellText(value);
  return text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null;
}

function getImageRow(range: ImageRange): number | null {
  const topLeft = range.tl;
  if (!topLeft) return null;
  const rawRow = typeof topLeft.row === 'number' ? topLeft.row : Number(topLeft.row);
  if (!Number.isFinite(rawRow)) return null;
  return Math.floor(rawRow) + 1;
}

function collectImages(workbook: ExcelJS.Workbook, worksheet: Worksheet): Map<number, ParsedImage> {
  const images = new Map<number, ParsedImage>();
  for (const positioned of worksheet.getImages()) {
    const rowNumber = getImageRow(positioned.range);
    if (!rowNumber || rowNumber < 2) continue;
    const imageId = Number(positioned.imageId);
    if (!Number.isFinite(imageId)) continue;
    const media = workbook.getImage(imageId);
    const rawBuffer = media?.buffer;
    if (!rawBuffer) continue;
    images.set(rowNumber, {
      rowNumber,
      extension: media.extension || 'png',
      buffer: Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer),
    });
  }
  return images;
}

function validateHeaders(worksheet: Worksheet): void {
  const actual = EXPECTED_HEADERS.map((_, index) => cellText(worksheet.getCell(1, index + 1).value));
  const missing = EXPECTED_HEADERS.filter((header) => !actual.includes(header));
  if (missing.length > 0) {
    throw new Error(`Excel 缺少必需列：${missing.join('、')}`);
  }
}

export async function parseTemuWorkbook(filePath: string, fileName: string): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet('商品数据') ?? workbook.worksheets[0];
  if (!worksheet) throw new Error('Excel 中未找到可读取的工作表。');

  validateHeaders(worksheet);
  const dataDate = extractDataDate(fileName);
  const issues: ImportIssue[] = [];
  const embeddedImages = collectImages(workbook, worksheet);
  const rows: ParsedProductRow[] = [];
  const seenSpu = new Set<string>();

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const spu = cellText(row.getCell(1).value).replace(/\.0$/, '').trim();
    const hasAnyMetric = [5, 6, 7, 8, 9, 10, 13].some((column) => cellText(row.getCell(column).value));
    if (!spu && !hasAnyMetric) continue;
    if (!/^\d+$/.test(spu)) {
      issues.push({ row: rowNumber, field: 'SPU', severity: 'error', message: `SPU 无效：${spu || '空值'}` });
      continue;
    }
    if (seenSpu.has(spu)) {
      issues.push({ row: rowNumber, field: 'SPU', severity: 'error', message: `文件中存在重复 SPU：${spu}` });
      continue;
    }
    seenSpu.add(spu);

    const firstListedAt = parseDate(row.getCell(4).value);
    if (cellText(row.getCell(4).value) && !firstListedAt) {
      issues.push({ row: rowNumber, field: '首次加入站点时间', severity: 'warning', message: '首次加入站点时间格式无法识别，已留空。' });
    }

    rows.push({
      rowNumber,
      date: dataDate,
      spu,
      firstListedAt,
      remoteImageUrl: extractHttpUrl(row.getCell(3).value),
      embeddedImage: embeddedImages.get(rowNumber) ?? null,
      impressions: parseNonNegativeInteger(row.getCell(5).value, rowNumber, '曝光量', issues),
      clicks: parseNonNegativeInteger(row.getCell(6).value, rowNumber, '点击量', issues),
      visitors: parseNonNegativeInteger(row.getCell(7).value, rowNumber, '访客量', issues),
      cartUsers: parseNonNegativeInteger(row.getCell(8).value, rowNumber, '加购人数', issues),
      orders: parseNonNegativeInteger(row.getCell(9).value, rowNumber, '订单量', issues),
      detailPaidBuyers: parseNonNegativeInteger(row.getCell(10).value, rowNumber, '商详支付买家数', issues),
      detailPaymentConversionRate: parseRate(row.getCell(11).value, rowNumber, '商详支付转化率', issues),
      clickOrderConversionRate: null,
      impressionOrderConversionRate: parseRate(row.getCell(12).value, rowNumber, '曝光订单转化率', issues),
      searchImpressions: parseNonNegativeInteger(row.getCell(13).value, rowNumber, '（曝光量）搜索数据', issues),
    });
  }

  if (rows.length === 0) throw new Error('Excel 中没有可导入的有效商品数据。');

  return {
    fileName,
    dataDate,
    rows,
    issues,
    embeddedImageCount: rows.filter((row) => row.embeddedImage).length,
    remoteImageCount: rows.filter((row) => row.remoteImageUrl).length,
  };
}
