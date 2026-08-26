import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractDataDate, parseTemuWorkbook } from "./parser.js";

const fileName = "Temu商品数据_20260824_115757.xlsx";
let temporaryDirectory = "";
let sampleFile = "";

beforeAll(async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "temu-parser-"));
  sampleFile = path.join(temporaryDirectory, fileName);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("商品数据");
  worksheet.addRow([
    "SPU",
    "图片",
    "图片URL",
    "首次加入站点时间",
    "曝光量",
    "点击量",
    "访客量",
    "加购人数",
    "订单量",
    "商详支付买家数",
    "商详支付转化率",
    "曝光订单转化率",
    "（曝光量）搜索数据",
  ]);
  worksheet.addRow([
    "4308587831",
    "",
    "https://example.test/product.jpg",
    "2026-08-20",
    836,
    52,
    40,
    10,
    3,
    1,
    "3.57%",
    "0.36%",
    120,
  ]);
  const imageId = workbook.addImage({
    base64:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    extension: "png",
  });
  worksheet.addImage(imageId, {
    tl: { col: 1, row: 1 },
    ext: { width: 20, height: 20 },
  });
  await workbook.xlsx.writeFile(sampleFile);
});

afterAll(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("Temu Excel parser", () => {
  it("extracts the data date from a Temu file name", () => {
    expect(extractDataDate(fileName)).toBe("2026-08-24");
  });

  it("parses metrics, remote URL and embedded image", async () => {
    const workbook = await parseTemuWorkbook(sampleFile, fileName);
    expect(workbook.dataDate).toBe("2026-08-24");
    expect(workbook.rows).toHaveLength(1);
    expect(workbook.embeddedImageCount).toBe(1);
    expect(workbook.remoteImageCount).toBe(1);
    expect(workbook.issues).toHaveLength(0);
    expect(workbook.rows[0]).toMatchObject({
      spu: "4308587831",
      firstListedAt: "2026-08-20",
      remoteImageUrl: "https://example.test/product.jpg",
      impressions: 836,
      clicks: 52,
      visitors: 40,
      cartUsers: 10,
      orders: 3,
      detailPaidBuyers: 1,
      searchImpressions: 120,
    });
    expect(workbook.rows[0]!.embeddedImage?.extension).toBe("png");
    expect(workbook.rows[0]!.detailPaymentConversionRate).toBeCloseTo(
      0.0357,
      6,
    );
    expect(workbook.rows[0]!.impressionOrderConversionRate).toBeCloseTo(
      0.0036,
      6,
    );
  });
});
