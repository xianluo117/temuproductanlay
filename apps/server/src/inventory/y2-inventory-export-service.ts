import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Y2InventoryColorRow, Y2InventoryListItem } from "@temu-analytics/shared";
import { paths } from "../config.js";
import { listY2Inventory } from "./y2-inventory-service.js";
import { y2InventoryExportCachePath } from "./y2-inventory-export-cache.js";

function imageFileName(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  try {
    const parsed = new URL(imageUrl, "http://localhost");
    const fileName = path.basename(decodeURIComponent(parsed.pathname));
    return fileName && fileName !== "/" ? fileName : null;
  } catch {
    return null;
  }
}

function imageExtension(fileName: string): "jpeg" | "png" | "gif" {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "png";
  if (extension === ".gif") return "gif";
  return "jpeg";
}

function inventoryQuantity(item: Y2InventoryListItem["colors"][number], size: string): number {
  return item.cells.find((cell) => cell.size === size)?.quantity ?? 0;
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF344054" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD0D5DD" } },
      bottom: { style: "thin", color: { argb: "FFD0D5DD" } },
      left: { style: "thin", color: { argb: "FFD0D5DD" } },
      right: { style: "thin", color: { argb: "FFD0D5DD" } },
    };
  });
}

function styleDataRow(row: ExcelJS.Row): void {
  row.height = 72;
  row.eachCell((cell) => {
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE4E7EC" } },
      bottom: { style: "thin", color: { argb: "FFE4E7EC" } },
      left: { style: "thin", color: { argb: "FFE4E7EC" } },
      right: { style: "thin", color: { argb: "FFE4E7EC" } },
    };
  });
}

async function addMainImage(
  workbook: ExcelJS.Workbook,
  worksheet: ExcelJS.Worksheet,
  item: Y2InventoryListItem,
  firstRow: number,
  lastRow: number,
): Promise<void> {
  const fileName = imageFileName(item.imageUrl);
  if (!fileName) {
    worksheet.getCell(firstRow, 2).value = "无主图";
    return;
  }
  try {
    const buffer = await fs.readFile(path.join(paths.images, fileName));
    const imageId = workbook.addImage({ buffer: buffer as never, extension: imageExtension(fileName) });
    worksheet.addImage(imageId, {
      tl: { col: 1, row: firstRow - 1 },
      ext: { width: 64, height: 64 },
    });
  } catch {
    worksheet.getCell(firstRow, 2).value = "主图缺失";
  }
}

export async function buildY2InventoryWorkbook(items: Y2InventoryListItem[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Temu商品分析系统";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("Y2库存");
  const sizes = [...new Set(items.flatMap((item) => item.sizes))];
  const headers = ["货号", "主图", "SPU信息", "颜色", ...sizes, "颜色合计"];
  worksheet.columns = [
    { key: "productCode", width: 22 },
    { key: "image", width: 14 },
    { key: "spu", width: 24 },
    { key: "color", width: 18 },
    ...sizes.map((size) => ({ key: `size-${size}`, width: 12 })),
    { key: "total", width: 14 },
  ];
  worksheet.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  styleHeader(worksheet.addRow(headers));

  for (const item of items) {
    const colors: Y2InventoryColorRow[] = item.colors.length ? item.colors : [{
      id: 0, color: "暂无颜色", skcRowId: null, skcId: null, skcCode: null, imageUrl: null,
      matchStatus: "unmatched", matchMessage: null, cells: [], totalQuantity: 0,
    }];
    const firstRow = worksheet.rowCount + 1;
    for (const color of colors) {
      const row = worksheet.addRow([
        item.productCodes.join(" / ") || "未填写货号",
        "",
        item.spus.join(" / ") || "",
        color.color || "未命名颜色",
        ...sizes.map((size) => inventoryQuantity(color, size)),
        color.totalQuantity,
      ]);
      styleDataRow(row);
      for (let column = 5; column < 5 + sizes.length; column += 1) {
        const cell = row.getCell(column);
        cell.font = { color: { argb: cell.value && Number(cell.value) > 0 ? "FF039855" : "FF98A2B3" } };
      }
    }
    const lastRow = worksheet.rowCount;
    if (lastRow > firstRow) {
      for (const column of [1, 2, 3]) worksheet.mergeCells(firstRow, column, lastRow, column);
    }
    await addMainImage(workbook, worksheet, item, firstRow, lastRow);
  }

  worksheet.getColumn(2).alignment = { horizontal: "center", vertical: "middle" };
  worksheet.getColumn(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  worksheet.getColumn(3).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  worksheet.getColumn(4).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

export async function ensureY2InventoryExport(shopId: number): Promise<string> {
  await fs.mkdir(paths.temp, { recursive: true });
  const target = y2InventoryExportCachePath(shopId);
  try {
    await fs.access(target);
    return target;
  } catch {
    const workbook = await buildY2InventoryWorkbook(listY2Inventory().items);
    await fs.writeFile(target, workbook);
    return target;
  }
}

export async function rebuildY2InventoryExport(shopId: number): Promise<void> {
  await fs.mkdir(paths.temp, { recursive: true });
  const workbook = await buildY2InventoryWorkbook(listY2Inventory().items);
  await fs.writeFile(y2InventoryExportCachePath(shopId), workbook);
}
