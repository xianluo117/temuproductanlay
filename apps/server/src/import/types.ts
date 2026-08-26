import type {
  DailyMetric,
  ImportIssue,
  ProductSummary,
} from "@temu-analytics/shared";

export interface ParsedImage {
  rowNumber: number;
  extension: string;
  buffer: Buffer;
}

export interface ParsedProductRow extends DailyMetric {
  rowNumber: number;
  remoteImageUrl: string | null;
  embeddedImage: ParsedImage | null;
}

export interface ParsedWorkbook {
  fileName: string;
  dataDate: string;
  rows: ParsedProductRow[];
  issues: ImportIssue[];
  embeddedImageCount: number;
  remoteImageCount: number;
}

export interface StoredImage {
  assetId: number;
  publicUrl: string;
  source: "embedded" | "remote";
}

export interface PendingImport {
  token: string;
  shopId: number;
  originalFileName: string;
  temporaryFilePath: string;
  fileHash: string;
  createdAt: number;
  parsed: ParsedWorkbook;
  sample: ProductSummary[];
}
