import type Database from "better-sqlite3";

/** Repairs obsolete foreign-key references left by the first shared-inventory migration. */
export function hasStaleY2InventoryForeignKeys(database: Database.Database): boolean {
  return [
    "y2_inventory_colors",
    "y2_inventory_product_codes",
    "y2_inventory_product_spus",
  ].some((table) => {
    const row = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string | null } | undefined;
    return row?.sql?.includes("y2_inventory_products_legacy") ?? false;
  });
}
