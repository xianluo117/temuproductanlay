import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "../config.js";

const cachePrefix = "y2-inventory-export-shop-";

export function y2InventoryExportCachePath(shopId: number): string {
  return path.join(paths.temp, `${cachePrefix}${shopId}.xlsx`);
}

export async function invalidateY2InventoryExportCache(shopId: number): Promise<void> {
  await fs.rm(y2InventoryExportCachePath(shopId), { force: true });
}
