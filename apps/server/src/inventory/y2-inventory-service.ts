import type {
  UserAccount,
  ZhihouInventoryPickOption,
  Y2InventoryBindingOptions,
  Y2InventoryChangeLog,
  Y2InventoryColorInput,
  Y2InventoryListResponse,
  Y2InventoryMatchStatus,
  Y2InventoryRecord,
  Y2InventoryRecordInput,
  Y2InventorySpuSpecInput,
  Y2InventorySummary,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { releaseInactiveZhihouStockPicks } from "../zhihou-erp/stock-pick-cleanup.js";

interface ProductRow {
  id: number;
  product_management_record_id: number | null;
  product_code: string | null;
  spu: string | null;
  image_asset_id: number | null;
  note: string | null;
  image_file_name: string | null;
  sizes_json: string;
  created_at: string;
  updated_at: string;
}

interface ColorRow {
  id: number;
  inventory_product_id: number;
  color_name: string;
  skc_row_id: number | null;
  skc_id: string | null;
  skc_code: string | null;
  match_status: Y2InventoryMatchStatus;
  match_message: string | null;
  image_url: string | null;
}

interface CellRow {
  id: number;
  color_row_id: number;
  size_name: string;
  quantity: number;
  sku_row_id: number | null;
  sku_id: string | null;
  sku_code: string | null;
  match_status: Y2InventoryMatchStatus;
  match_message: string | null;
}

interface SkcCandidate {
  row_id: number;
  skc_id: string | null;
  skc_code: string | null;
  attribute_json: string | null;
  image_url: string | null;
}

interface SkuCandidate {
  row_id: number;
  skc_row_id: number;
  sku_id: string | null;
  sku_code: string | null;
  size_name: string | null;
  specification_json: string | null;
}

function hasTable(table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function normalized(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_\-]+/g, "");
}

function normalizedSpec(value: string): string {
  const text = normalized(value);
  const aliases: Record<string, string> = {
    WHITE: "白色",
    GREEN: "绿色",
    BLACK: "黑色",
    GREY: "灰色",
    GRAY: "灰色",
    PINK: "粉色",
    RED: "红色",
    APRICOT: "杏色",
  };
  return normalized(aliases[text] ?? text);
}

function jsonAttributeValues(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const candidate = value.value ?? value.attrValue ?? value.valueName;
      return candidate === null || candidate === undefined ? [] : [String(candidate)];
    });
  } catch {
    return [];
  }
}

function matchStatus(count: number): Y2InventoryMatchStatus {
  if (count === 1) return "matched";
  return count > 1 ? "conflict" : "unmatched";
}

function matchMessage(type: "颜色" | "尺码", value: string, count: number): string | null {
  if (count === 1) return null;
  return count > 1
    ? `${type}“${value}”匹配到 ${count} 个生命周期规格，请手工选择。`
    : `未找到${type}“${value}”对应的生命周期规格。`;
}

function lifecycleCandidates(spu: string): {
  skcs: SkcCandidate[];
  skus: SkuCandidate[];
} {
  const skcs = database
    .prepare(
      `SELECT skc.id AS row_id, skc.skc_id, skc.skc_code, skc.attribute_json, skc.image_url
       FROM temu_lifecycle_skc_current skc
       JOIN temu_lifecycle_spu_current lifecycle_spu ON lifecycle_spu.id = skc.spu_row_id
       WHERE UPPER(TRIM(lifecycle_spu.spu)) = ?
       ORDER BY skc.id`,
    )
    .all(spu.trim().toUpperCase()) as SkcCandidate[];
  if (!skcs.length) return { skcs, skus: [] };
  const placeholders = skcs.map(() => "?").join(", ");
  const skus = database
    .prepare(
      `SELECT id AS row_id, skc_row_id, sku_id, sku_code, size_name, specification_json
       FROM temu_lifecycle_sku_current
       WHERE skc_row_id IN (${placeholders}) ORDER BY id`,
    )
    .all(...skcs.map((item) => item.row_id)) as SkuCandidate[];
  return { skcs, skus };
}

function matchingSkcs(color: string | undefined, candidates: SkcCandidate[]): SkcCandidate[] {
  if (!color?.trim()) return [];
  const target = normalizedSpec(color);
  return candidates.filter((candidate) => {
    const values = [
      ...jsonAttributeValues(candidate.attribute_json),
      candidate.skc_code ?? "",
    ];
    return values.some((value) => normalizedSpec(value) === target || normalizedSpec(value).endsWith(target));
  });
}

function skcColorLabel(candidate: SkcCandidate): string {
  return jsonAttributeValues(candidate.attribute_json).join(" / ")
    || candidate.skc_code
    || candidate.skc_id
    || `SKC ${candidate.row_id}`;
}

function matchingSkus(size: string, skcRowId: number, candidates: SkuCandidate[]): SkuCandidate[] {
  const target = normalizedSpec(size);
  return candidates.filter(
    (candidate) =>
      candidate.skc_row_id === skcRowId &&
      [candidate.size_name ?? "", ...jsonAttributeValues(candidate.specification_json)].some(
        (value) => normalizedSpec(value) === target,
      ),
  );
}

function inputCodes(input: Y2InventoryRecordInput): string[] {
  return [...new Set([input.productCode ?? "", ...(input.productCodes ?? [])]
    .map((value) => value.trim()).filter(Boolean))];
}

function inputSpus(input: Y2InventoryRecordInput): string[] {
  return [...new Set([input.spu ?? "", ...(input.spus ?? [])]
    .map((value) => value.trim()).filter(Boolean))];
}

function ensureProductIdentity(input: Y2InventoryRecordInput): number | null {
  const codes = inputCodes(input);
  const spus = inputSpus(input);
  if (!codes.length && !spus.length) throw new Error("货号和SPU至少填写一个。");
  const codeConditions = codes.length
    ? `UPPER(TRIM(record.product_code)) IN (${codes.map(() => "?").join(", ")})`
    : "1 = 1";
  const spuConditions = spus.length
    ? `UPPER(TRIM(link.spu)) IN (${spus.map(() => "?").join(", ")})`
    : "1 = 1";
  const records = database.prepare(
    `SELECT DISTINCT record.id
     FROM product_management_records record
     LEFT JOIN product_management_spu_links link ON link.record_id = record.id
     WHERE ${codeConditions} AND ${spuConditions}`,
  ).all(
    ...codes.map((value) => value.toUpperCase()),
    ...spus.map((value) => value.toUpperCase()),
  ) as Array<{ id: number }>;
  if (records.length > 1) throw new Error("输入的货号和SPU匹配到多条产品主档，请先清理重复数据。");
  return records[0]?.id ?? null;
}

function ensureInventoryAccess(user: UserAccount, productId: number): void {
  if (user.role === "admin") return;
  const row = database.prepare(
    `SELECT record.shop_profile_id AS shop_id
     FROM y2_inventory_products product
     JOIN product_management_records record ON record.id = product.product_management_record_id
     WHERE product.id = ?`,
  ).get(productId) as { shop_id: number } | undefined;
  if (!row || !database.prepare(
    "SELECT 1 FROM temu_shop_user_grants WHERE shop_profile_id = ? AND user_id = ?",
  ).get(row.shop_id, user.id)) throw new Error("无权访问该Y2库存。");
}

function insertColorRows(productId: number, input: Y2InventoryRecordInput, candidates: ReturnType<typeof lifecycleCandidates>): void {
  const insertColor = database.prepare(
    `INSERT INTO y2_inventory_colors
      (inventory_product_id, color_name, normalized_color, skc_row_id, skc_id, skc_code,
       match_status, match_message, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCell = database.prepare(
    `INSERT INTO y2_inventory_cells
      (color_row_id, size_name, normalized_size, quantity, sku_row_id, sku_id, sku_code,
       match_status, match_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const hasSpu = Boolean(input.spu?.trim() || input.spus?.some((value) => value.trim()));
  input.colors.forEach((colorInput, colorIndex) => {
    const enteredColor = colorInput.color?.trim() ?? "";
    const automaticSkcs = matchingSkcs(enteredColor, candidates.skcs);
    const manualSkc = colorInput.skcRowId
      ? candidates.skcs.find((candidate) => candidate.row_id === colorInput.skcRowId)
      : undefined;
    if (colorInput.skcRowId && !manualSkc) throw new Error("选择的SKC不属于当前SPU，请重新加载规格。");
    const selectedSkc = manualSkc ?? (automaticSkcs.length === 1 ? automaticSkcs[0] : undefined);
    if (!enteredColor && !selectedSkc) throw new Error("颜色和SKC绑定至少填写一项。");
    const storedColor = enteredColor || skcColorLabel(selectedSkc!);
    const status = manualSkc ? "matched" : matchStatus(automaticSkcs.length);
    const colorResult = insertColor.run(
      productId,
      storedColor,
      normalizedSpec(storedColor),
      selectedSkc?.row_id ?? null,
      selectedSkc?.skc_id ?? null,
      selectedSkc?.skc_code ?? null,
      status,
      manualSkc ? null : hasSpu ? matchMessage("颜色", storedColor, automaticSkcs.length) : "尚未填写SPU，等待后续匹配。",
      colorIndex,
    );
    const colorRowId = Number(colorResult.lastInsertRowid);
    for (const cellInput of colorInput.cells) {
      const skuCandidates = selectedSkc
        ? matchingSkus(cellInput.size, selectedSkc.row_id, candidates.skus)
        : [];
      const manualSku = cellInput.skuRowId
        ? candidates.skus.find(
            (candidate) => candidate.row_id === cellInput.skuRowId && candidate.skc_row_id === selectedSkc?.row_id,
          )
        : undefined;
      const selectedSku = manualSku ?? (skuCandidates.length === 1 ? skuCandidates[0] : undefined);
      const cellStatus = manualSku ? "matched" : matchStatus(skuCandidates.length);
      insertCell.run(
        colorRowId,
        cellInput.size.trim(),
        normalizedSpec(cellInput.size),
        cellInput.quantity,
        selectedSku?.row_id ?? null,
        selectedSku?.sku_id ?? null,
        selectedSku?.sku_code ?? null,
        cellStatus,
        manualSku ? null : selectedSkc ? matchMessage("尺码", cellInput.size, skuCandidates.length) : hasSpu ? "颜色尚未绑定SKC。" : "尚未填写SPU，等待后续匹配。",
      );
    }
  });
}

function refreshSpuSpecs(productId: number): void {
  if (!hasTable("y2_inventory_product_spu_specs")) return;
  database.prepare(
    `DELETE FROM y2_inventory_product_spu_specs
     WHERE color_row_id IN (SELECT id FROM y2_inventory_colors WHERE inventory_product_id = ?)`,
  ).run(productId);
  const spus = database.prepare(
    `SELECT id, spu FROM y2_inventory_product_spus WHERE inventory_product_id = ? ORDER BY id`,
  ).all(productId) as Array<{ id: number; spu: string }>;
  const colors = database.prepare(
    `SELECT id, color_name, skc_row_id FROM y2_inventory_colors
     WHERE inventory_product_id = ? ORDER BY sort_order, id`,
  ).all(productId) as Array<{ id: number; color_name: string; skc_row_id: number | null }>;
  const insertSpec = database.prepare(
    `INSERT OR IGNORE INTO y2_inventory_product_spu_specs
     (product_spu_id, color_row_id, cell_id, skc_row_id, sku_row_id) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const productSpu of spus) {
    const candidates = lifecycleCandidates(productSpu.spu);
    for (const color of colors) {
      const skcRowId = color.skc_row_id && candidates.skcs.some((item) => item.row_id === color.skc_row_id)
        ? color.skc_row_id
        : matchingSkcs(color.color_name, candidates.skcs)[0]?.row_id ?? null;
      const cells = database.prepare(
        `SELECT id, size_name, sku_row_id FROM y2_inventory_cells WHERE color_row_id = ? ORDER BY id`,
      ).all(color.id) as Array<{ id: number; size_name: string; sku_row_id: number | null }>;
      for (const cell of cells) {
        const skuRowId = skcRowId
          ? matchingSkus(cell.size_name, skcRowId, candidates.skus)[0]?.row_id ?? null
          : null;
        insertSpec.run(productSpu.id, color.id, cell.id, skcRowId, skuRowId ?? cell.sku_row_id);
      }
    }
  }
}

function updateReferencedInventoryQuantities(productId: number, input: Y2InventoryRecordInput): void {
  const existingColors = database.prepare(
    `SELECT id, normalized_color
     FROM y2_inventory_colors WHERE inventory_product_id = ?`,
  ).all(productId) as Array<{ id: number; normalized_color: string }>;
  const existingCells = database.prepare(
    `SELECT cell.id, cell.color_row_id, cell.normalized_size
     FROM y2_inventory_cells cell
     JOIN y2_inventory_colors color ON color.id = cell.color_row_id
     WHERE color.inventory_product_id = ?`,
  ).all(productId) as Array<{ id: number; color_row_id: number; normalized_size: string }>;
  const updateQuantity = database.prepare(
    "UPDATE y2_inventory_cells SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  );
  for (const cell of existingCells) updateQuantity.run(0, cell.id);
  for (const colorInput of input.colors) {
    const colorId = existingColors.find(
      (color) => color.normalized_color === normalizedSpec(colorInput.color?.trim() ?? ""),
    )?.id;
    if (!colorId) continue;
    for (const cellInput of colorInput.cells) {
      const cellId = existingCells.find(
        (cell) => cell.color_row_id === colorId
          && cell.normalized_size === normalizedSpec(cellInput.size.trim()),
      )?.id;
      if (cellId) updateQuantity.run(cellInput.quantity, cellId);
    }
  }
}

function insertUnreferencedColorRows(
  productId: number,
  input: Y2InventoryRecordInput,
  candidates: ReturnType<typeof lifecycleCandidates>,
): void {
  const existingColors = database
    .prepare(
      "SELECT normalized_color FROM y2_inventory_colors WHERE inventory_product_id = ?",
    )
    .all(productId) as Array<{ normalized_color: string }>;
  const existing = new Set(existingColors.map((color) => color.normalized_color));
  const colors = input.colors.filter((color) => {
    const normalizedColor = normalizedSpec(color.color?.trim() ?? "");
    return normalizedColor && !existing.has(normalizedColor);
  });
  if (colors.length) insertColorRows(productId, { ...input, colors }, candidates);
}

export function updateY2InventoryQuantity(
  user: UserAccount,
  cellId: number,
  quantity: number,
): import("@temu-analytics/shared").Y2InventoryQuantityUpdateResult {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error("库存数量必须是非负整数。");
  const cell = database.prepare(
    `SELECT cell.id, color.inventory_product_id AS product_id
     FROM y2_inventory_cells cell
     JOIN y2_inventory_colors color ON color.id = cell.color_row_id
     WHERE cell.id = ?`,
  ).get(cellId) as { id: number; product_id: number } | undefined;
  if (!cell) throw new Error("库存单元格不存在。");
  ensureInventoryAccess(user, cell.product_id);

  const update = database.transaction(() => {
    const before = getY2Inventory(cell.product_id, user);
    database.prepare(
      "UPDATE y2_inventory_cells SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(quantity, cellId);
    const after = getY2Inventory(cell.product_id, user);
    const color = after.colors.find((item) => item.cells.some((itemCell) => itemCell.id === cellId));
    writeChangeLog(
      "update",
      cell.product_id,
      after.productCode ?? after.spu ?? "",
      user.id,
      before,
      after,
    );
    return {
      inventoryProductId: cell.product_id,
      cellId,
      quantity,
      totalQuantity: after.totalQuantity,
      colorTotalQuantity: color?.totalQuantity ?? 0,
    };
  });
  return update();
}

export function saveY2Inventory(
  user: UserAccount,
  input: Y2InventoryRecordInput,
): Y2InventoryRecord {
  const recordId = ensureProductIdentity(input);
  const codes = inputCodes(input);
  const spus = inputSpus(input);
  if (!codes.length && !spus.length) throw new Error("货号和SPU至少填写一个。");
  const primaryCode = codes[0] ?? null;
  const primarySpu = spus[0] ?? null;
  const candidates = mergeLifecycleCandidates(spus);
  const save = database.transaction(() => {
    const existing = database
      .prepare(
        `SELECT id FROM y2_inventory_products
         WHERE (? IS NOT NULL AND UPPER(TRIM(product_code)) = ?)
            OR (? IS NOT NULL AND UPPER(TRIM(spu)) = ?)
         LIMIT 1`,
      )
      .get(primaryCode, primaryCode?.toUpperCase() ?? null, primarySpu, primarySpu?.toUpperCase() ?? null) as { id: number } | undefined;
    const before = existing ? getY2Inventory(existing.id) : null;
    let productId: number;
    let hasReferences = false;
    if (existing) {
      productId = existing.id;
      database
        .prepare(
          `UPDATE y2_inventory_products SET product_management_record_id = ?, product_code = ?,
             spu = ?, image_asset_id = ?, note = ?, sizes_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(recordId, primaryCode, primarySpu, input.imageAssetId, input.note?.trim() || null, JSON.stringify(input.sizes), productId);
      hasReferences = Boolean(database.prepare(
        `SELECT 1
         FROM y2_inventory_cells cell
         JOIN y2_inventory_colors color ON color.id = cell.color_row_id
         WHERE color.inventory_product_id = ?
           AND (
             EXISTS (
               SELECT 1 FROM zhihou_stock_pick_items pick
               WHERE pick.inventory_cell_id = cell.id
             )
             OR EXISTS (
               SELECT 1 FROM zhihou_inventory_adjustment_logs adjustment
               WHERE adjustment.inventory_cell_id = cell.id
             )
           )
         LIMIT 1`,
      ).get(productId));
      if (hasReferences) {
        // 已被配货或库存修正引用时，保留原规格行，同时追加本次新增的颜色行。
        updateReferencedInventoryQuantities(productId, input);
        insertUnreferencedColorRows(productId, input, candidates);
      } else {
        database.prepare("DELETE FROM y2_inventory_colors WHERE inventory_product_id = ?").run(productId);
      }
    } else {
      productId = Number(
        database
          .prepare(
            `INSERT INTO y2_inventory_products
              (product_management_record_id, product_code, spu, image_asset_id, note, sizes_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(recordId, primaryCode, primarySpu, input.imageAssetId, input.note?.trim() || null, JSON.stringify(input.sizes))
          .lastInsertRowid,
      );
    }
    if (!existing || !hasReferences) insertColorRows(productId, input, candidates);
    if (hasTable("y2_inventory_product_codes")) database.prepare("DELETE FROM y2_inventory_product_codes WHERE inventory_product_id = ?").run(productId);
    if (hasTable("y2_inventory_product_spus")) database.prepare("DELETE FROM y2_inventory_product_spus WHERE inventory_product_id = ?").run(productId);
    if (hasTable("y2_inventory_product_codes") && hasTable("y2_inventory_product_spus")) {
      const insertCode = database.prepare("INSERT INTO y2_inventory_product_codes (inventory_product_id, product_code) VALUES (?, ?)");
      const insertSpu = database.prepare("INSERT INTO y2_inventory_product_spus (inventory_product_id, spu) VALUES (?, ?)");
      for (const code of codes) insertCode.run(productId, code);
      for (const value of spus) insertSpu.run(productId, value);
    }
    refreshSpuSpecs(productId);
    const after = mapProducts([productRow(productId)], true)[0]!;
    writeChangeLog(existing ? "update" : "create", productId, primaryCode ?? primarySpu ?? "", user.id, before, after);
    return productId;
  });
  return getY2Inventory(save());
}

function productRows(search?: string): ProductRow[] {
  const keyword = search?.trim() ?? "";
  return database
    .prepare(
      `SELECT product.*,
              COALESCE(manual_asset.file_name, spu_asset.file_name) AS image_file_name
       FROM y2_inventory_products product
       LEFT JOIN image_assets manual_asset ON manual_asset.id = product.image_asset_id
       LEFT JOIN product_management_records management_record
         ON management_record.id = product.product_management_record_id
       LEFT JOIN products spu_product
         ON spu_product.shop_profile_id = management_record.shop_profile_id
        AND UPPER(TRIM(spu_product.spu)) = UPPER(TRIM(product.spu))
       LEFT JOIN image_assets spu_asset ON spu_asset.id = spu_product.image_asset_id
       WHERE (? = '' OR EXISTS (
         SELECT 1 FROM y2_inventory_product_codes code
         WHERE code.inventory_product_id = product.id AND code.product_code LIKE ?
       ) OR EXISTS (
         SELECT 1 FROM y2_inventory_product_spus spu
         WHERE spu.inventory_product_id = product.id AND spu.spu LIKE ?
       ) OR COALESCE(product.note, '') LIKE ?)
       ORDER BY updated_at DESC, id DESC`,
    )
    .all(keyword, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`) as ProductRow[];
}

function mapProducts(rows: ProductRow[], includeColors: boolean): Y2InventoryRecord[] {
  return rows.map((row) => {
    const colorRows = database
      .prepare(
        `SELECT color.*, skc.image_url
         FROM y2_inventory_colors color
         LEFT JOIN temu_lifecycle_skc_current skc ON skc.id = color.skc_row_id
         WHERE color.inventory_product_id = ? ORDER BY color.sort_order, color.id`,
      )
      .all(row.id) as ColorRow[];
    const colors = colorRows.map((color) => {
      const cells = database
        .prepare("SELECT * FROM y2_inventory_cells WHERE color_row_id = ? ORDER BY id")
        .all(color.id) as CellRow[];
      return {
        id: color.id,
        color: color.color_name,
        skcRowId: color.skc_row_id,
        skcId: color.skc_id,
        skcCode: color.skc_code,
        imageUrl: color.image_url,
        matchStatus: color.match_status,
        matchMessage: color.match_message,
        totalQuantity: cells.reduce((total, cell) => total + cell.quantity, 0),
        cells: cells.map((cell) => ({
          id: cell.id,
          size: cell.size_name,
          quantity: cell.quantity,
          skuRowId: cell.sku_row_id,
          skuId: cell.sku_id,
          skuCode: cell.sku_code,
          matchStatus: cell.match_status,
          matchMessage: cell.match_message,
        })),
      };
    });
    const productCodes = hasTable("y2_inventory_product_codes")
      ? database.prepare(
        "SELECT product_code FROM y2_inventory_product_codes WHERE inventory_product_id = ? ORDER BY id",
      ).all(row.id) as Array<{ product_code: string }>
      : [];
    const spus = hasTable("y2_inventory_product_spus")
      ? database.prepare(
        "SELECT spu FROM y2_inventory_product_spus WHERE inventory_product_id = ? ORDER BY id",
      ).all(row.id) as Array<{ spu: string }>
      : [];
    const mappedCodes = [...new Set([row.product_code ?? "", ...productCodes.map((item) => item.product_code)].map((item) => item.trim()).filter(Boolean))];
    const mappedSpus = [...new Set([row.spu ?? "", ...spus.map((item) => item.spu)].map((item) => item.trim()).filter(Boolean))];
    const spuSpecs = hasTable("y2_inventory_product_spu_specs")
      ? database.prepare(
          `SELECT product_spu.spu, spec.color_row_id AS colorRowId, spec.cell_id AS cellId,
                  spec.skc_row_id AS skcRowId, spec.sku_row_id AS skuRowId
           FROM y2_inventory_product_spu_specs spec
           JOIN y2_inventory_product_spus product_spu ON product_spu.id = spec.product_spu_id
           WHERE product_spu.inventory_product_id = ? ORDER BY spec.id`,
        ).all(row.id) as Array<{
          spu: string; colorRowId: number; cellId: number;
          skcRowId: number | null; skuRowId: number | null;
        }>
      : [];
    return {
      id: row.id,
      productManagementRecordId: row.product_management_record_id,
      productCode: mappedCodes[0] ?? null,
      spu: mappedSpus[0] ?? null,
      productCodes: mappedCodes,
      spus: mappedSpus,
      imageAssetId: row.image_asset_id,
      imageUrl: row.image_file_name ? `/api/images/${encodeURIComponent(row.image_file_name)}` : null,
      note: row.note,
      sizes: JSON.parse(row.sizes_json) as string[],
      totalQuantity: colors.reduce((total, color) => total + color.totalQuantity, 0),
      matchedColorCount: colors.filter((color) => color.matchStatus === "matched").length,
      unmatchedColorCount: colors.filter((color) => color.matchStatus === "unmatched").length,
      conflictColorCount: colors.filter((color) => color.matchStatus === "conflict").length,
      colors: includeColors ? colors : [],
      spuSpecs,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export function listY2Inventory(search?: string, user?: UserAccount): Y2InventoryListResponse {
  const records = mapProducts(productRows(search).filter((row) => {
    if (!user || user.role === "admin") return true;
    const shop = row.product_management_record_id === null ? undefined : database
      .prepare("SELECT shop_profile_id FROM product_management_records WHERE id = ?")
      .get(row.product_management_record_id) as { shop_profile_id: number } | undefined;
    return Boolean(shop && database.prepare(
      "SELECT 1 FROM temu_shop_user_grants WHERE shop_profile_id = ? AND user_id = ?",
    ).get(shop.shop_profile_id, user.id));
  }), true);
  return {
    items: records,
    totalQuantity: records.reduce((total, record) => total + record.totalQuantity, 0),
    matchedCount: records.filter((record) => record.unmatchedColorCount + record.conflictColorCount === 0).length,
    issueCount: records.filter((record) => record.unmatchedColorCount + record.conflictColorCount > 0).length,
  };
}

function productRow(id: number): ProductRow {
  const row = database
    .prepare(
      `SELECT product.*,
              COALESCE(manual_asset.file_name, spu_asset.file_name) AS image_file_name
       FROM y2_inventory_products product
       LEFT JOIN image_assets manual_asset ON manual_asset.id = product.image_asset_id
       LEFT JOIN product_management_records management_record
         ON management_record.id = product.product_management_record_id
       LEFT JOIN products spu_product
         ON spu_product.shop_profile_id = management_record.shop_profile_id
        AND UPPER(TRIM(spu_product.spu)) = UPPER(TRIM(product.spu))
       LEFT JOIN image_assets spu_asset ON spu_asset.id = spu_product.image_asset_id
       WHERE product.id = ?`,
    )
    .get(id) as ProductRow | undefined;
  if (!row) throw new Error("Y2库存记录不存在。");
  return row;
}

export function getY2Inventory(id: number, user?: UserAccount): Y2InventoryRecord {
  const row = productRow(id);
  if (user && user.role !== "admin") {
    const shop = row.product_management_record_id === null ? undefined : database
      .prepare("SELECT shop_profile_id FROM product_management_records WHERE id = ?")
      .get(row.product_management_record_id) as { shop_profile_id: number } | undefined;
    if (!shop || !database.prepare(
      "SELECT 1 FROM temu_shop_user_grants WHERE shop_profile_id = ? AND user_id = ?",
    ).get(shop.shop_profile_id, user.id)) throw new Error("无权访问该Y2库存。");
  }
  if (!row) throw new Error("Y2库存记录不存在。");
  return mapProducts([row], true)[0]!;
}

export function deleteY2Inventory(user: UserAccount, id: number): void {
  ensureInventoryAccess(user, id);
  const remove = database.transaction(() => {
    // 兼容同步前产生的历史脏数据：删除库存前先释放已失效订单的配货占用。
    releaseInactiveZhihouStockPicks();
    const before = getY2Inventory(id, user);
    const pending = database
      .prepare(
        `SELECT COALESCE(SUM(pick.picked_quantity - pick.adjusted_quantity), 0) AS quantity
         FROM zhihou_stock_pick_items pick
         JOIN y2_inventory_cells cell ON cell.id = pick.inventory_cell_id
         JOIN y2_inventory_colors color ON color.id = cell.color_row_id
         WHERE color.inventory_product_id = ?
           AND pick.picked_quantity > pick.adjusted_quantity`,
      )
      .get(id) as { quantity: number };
    if (pending.quantity > 0) {
      throw new Error(`该Y2库存当前仍有 ${pending.quantity} 件被配货占用，请先撤销相关配货后再删除。`);
    }

    const cellIds = database
      .prepare(
        `SELECT cell.id
         FROM y2_inventory_cells cell
         JOIN y2_inventory_colors color ON color.id = cell.color_row_id
         WHERE color.inventory_product_id = ?`,
      )
      .all(id) as Array<{ id: number }>;
    const placeholders = cellIds.map(() => "?").join(", ");
    const parameters = cellIds.map((cell) => cell.id);
    if (placeholders) {
      database.prepare(
        `DELETE FROM zhihou_size_conversion_options WHERE inventory_cell_id IN (${placeholders})`,
      ).run(...parameters);
      database.prepare(
        `DELETE FROM zhihou_inventory_adjustment_logs WHERE inventory_cell_id IN (${placeholders})`,
      ).run(...parameters);
      database.prepare(
        `DELETE FROM zhihou_stock_pick_allocations
         WHERE pick_item_id IN (
           SELECT id FROM zhihou_stock_pick_items WHERE inventory_cell_id IN (${placeholders})
         )`,
      ).run(...parameters);
      database.prepare(
        `DELETE FROM zhihou_stock_pick_items WHERE inventory_cell_id IN (${placeholders})`,
      ).run(...parameters);
    }
    database.prepare(
      `DELETE FROM zhihou_stock_pick_batches
       WHERE NOT EXISTS (
         SELECT 1 FROM zhihou_stock_pick_items pick
         WHERE pick.batch_id = zhihou_stock_pick_batches.id
       )`,
    ).run();

    const result = database
      .prepare("DELETE FROM y2_inventory_products WHERE id = ?")
      .run(id);
    if (!result.changes) throw new Error("Y2库存记录不存在。");
    writeChangeLog("delete", null, before.productCode ?? before.spu ?? "", user.id, before, null);
  });
  remove();
}

function resolveInventorySpus(
  spu: string | undefined,
  productCode: string | undefined,
  inventoryProductId?: number,
): { spus: string[]; resolvedFromProductCode: boolean } {
  const explicit = spu?.trim() ?? "";
  if (explicit) return { spus: [explicit], resolvedFromProductCode: false };

  if (inventoryProductId && hasTable("y2_inventory_product_spus")) {
    const boundSpus = database.prepare(
      `SELECT spu FROM y2_inventory_product_spus
       WHERE inventory_product_id = ? ORDER BY id`,
    ).all(inventoryProductId) as Array<{ spu: string }>;
    const spus = boundSpus.map((row) => row.spu.trim()).filter(Boolean);
    if (spus.length) return { spus, resolvedFromProductCode: false };
  }

  const code = productCode?.trim() ?? "";
  if (!code) throw new Error("请填写SPU，或填写货号。");
  const rows = database.prepare(
    `SELECT DISTINCT link.spu
     FROM product_management_records record
     JOIN product_management_spu_links link ON link.record_id = record.id
     WHERE UPPER(TRIM(record.product_code)) = ?
       AND TRIM(COALESCE(link.spu, '')) <> ''
     ORDER BY link.spu`,
  ).all(code.toUpperCase()) as Array<{ spu: string }>;
  const spus = rows.map((row) => row.spu.trim()).filter(Boolean);
  if (!spus.length) throw new Error("该货号在产品管理中没有可用的SPU，请手工填写SPU后再加载规格。");
  return { spus, resolvedFromProductCode: true };
}

function mergeLifecycleCandidates(spus: string[]): {
  skcs: SkcCandidate[];
  skus: SkuCandidate[];
} {
  const skcsById = new Map<number, SkcCandidate>();
  const skusById = new Map<number, SkuCandidate>();
  for (const value of spus) {
    const candidates = lifecycleCandidates(value);
    for (const skc of candidates.skcs) skcsById.set(skc.row_id, skc);
    for (const sku of candidates.skus) skusById.set(sku.row_id, sku);
  }
  return {
    skcs: [...skcsById.values()].sort((left, right) => left.row_id - right.row_id),
    skus: [...skusById.values()].sort((left, right) => left.row_id - right.row_id),
  };
}

export function getY2InventoryBindingOptions(
  spu?: string,
  productCode?: string,
  inventoryProductId?: number,
): Y2InventoryBindingOptions {
  const resolved = resolveInventorySpus(spu, productCode, inventoryProductId);
  const spuOptions = resolved.spus.map((spuValue) => {
    const candidates = lifecycleCandidates(spuValue);
    return {
      spu: spuValue,
      skcs: candidates.skcs.map((skc) => ({
        rowId: skc.row_id,
        id: skc.skc_id,
        code: skc.skc_code,
        label: jsonAttributeValues(skc.attribute_json).join(" / ") || skc.skc_code || skc.skc_id || `SKC ${skc.row_id}`,
        imageUrl: skc.image_url,
        skus: candidates.skus
          .filter((sku) => sku.skc_row_id === skc.row_id)
          .map((sku) => ({
            rowId: sku.row_id,
            id: sku.sku_id,
            code: sku.sku_code,
            label: sku.size_name || jsonAttributeValues(sku.specification_json).join(" / ") || sku.sku_code || sku.sku_id || `SKU ${sku.row_id}`,
            imageUrl: null,
          })),
      })),
    };
  });
  return {
    spu: resolved.spus[0]!,
    resolvedFromProductCode: resolved.resolvedFromProductCode,
    ...(resolved.spus.length > 1 ? { availableSpus: resolved.spus } : {}),
    spuOptions,
    skcs: spuOptions[0]?.skcs ?? [],
  };
}

export function y2InventorySummariesForRecords(
  records: Array<{ id: number; productCode: string }>,
): Map<number, Y2InventorySummary> {
  const result = new Map<number, Y2InventorySummary>();
  if (!records.length || !hasTable("y2_inventory_products") || !hasTable("y2_inventory_product_codes")) return result;
  const codes = [...new Set(records.map((record) => record.productCode.trim().toUpperCase()))];
  const placeholders = codes.map(() => "?").join(", ");
  if (!codes.length || !hasTable("y2_inventory_product_codes")) return result;
  const rows = database
    .prepare(
      `SELECT product.id AS inventory_id, COALESCE(MIN(code.product_code), product.product_code, '') AS product_code,
              COALESCE(SUM(cell.quantity), 0) AS total_quantity,
              COUNT(DISTINCT CASE WHEN color.match_status = 'matched' THEN color.id END) AS matched_colors,
              COUNT(DISTINCT CASE WHEN color.match_status = 'unmatched' THEN color.id END) AS unmatched_colors,
              COUNT(DISTINCT CASE WHEN color.match_status = 'conflict' THEN color.id END) AS conflict_colors
       FROM y2_inventory_products product
       LEFT JOIN y2_inventory_product_codes code ON code.inventory_product_id = product.id
       LEFT JOIN y2_inventory_colors color ON color.inventory_product_id = product.id
       LEFT JOIN y2_inventory_cells cell ON cell.color_row_id = color.id
       WHERE EXISTS (
         SELECT 1 FROM y2_inventory_product_codes matching_code
         WHERE matching_code.inventory_product_id = product.id
           AND UPPER(TRIM(matching_code.product_code)) IN (${placeholders})
       )
       GROUP BY product.id`,
    )
    .all(...codes) as Array<{
    inventory_id: number;
    product_code: string;
    total_quantity: number;
    matched_colors: number;
    unmatched_colors: number;
    conflict_colors: number;
  }>;
  for (const row of rows) {
    for (const record of records.filter((item) => item.productCode.trim().toUpperCase() === row.product_code.trim().toUpperCase())) result.set(record.id, {
      inventoryId: row.inventory_id,
      totalQuantity: row.total_quantity,
      matchedColorCount: row.matched_colors,
      unmatchedColorCount: row.unmatched_colors,
      conflictColorCount: row.conflict_colors,
    });
  }
  return result;
}

function writeChangeLog(
  action: "create" | "update" | "delete",
  inventoryProductId: number | null,
  productCode: string,
  userId: number,
  before: Y2InventoryRecord | null,
  after: Y2InventoryRecord | null,
): void {
  database.prepare(
    `INSERT INTO y2_inventory_change_logs
      (inventory_product_id, product_code, action, changed_by_user_id,
       before_total_quantity, after_total_quantity, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    inventoryProductId,
    productCode,
    action,
    userId,
    before?.totalQuantity ?? null,
    after?.totalQuantity ?? null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
  );
  database.prepare("DELETE FROM y2_inventory_change_logs WHERE changed_at < datetime('now', '-7 days')").run();
}

export function listY2InventoryChangeLogs(user?: UserAccount): Y2InventoryChangeLog[] {
  const rows = database.prepare(
    `SELECT log.*, user.username FROM y2_inventory_change_logs log
     JOIN users user ON user.id = log.changed_by_user_id
     WHERE log.changed_at >= datetime('now', '-7 days')
     ORDER BY log.changed_at DESC, log.id DESC LIMIT 1000`,
  ).all() as Array<{
    id: number;
    inventory_product_id: number | null;
    product_code: string;
    action: "create" | "update" | "delete";
    username: string;
    before_total_quantity: number | null;
    after_total_quantity: number | null;
    changed_at: string;
  }>;
  return rows.filter((row) => {
    if (!user || user.role === "admin") return true;
    if (row.inventory_product_id === null) return false;
    try { ensureInventoryAccess(user, row.inventory_product_id); return true; } catch { return false; }
  }).map((row) => ({
    id: row.id,
    inventoryProductId: row.inventory_product_id,
    productCode: row.product_code,
    action: row.action,
    changedByUsername: row.username,
    beforeTotalQuantity: row.before_total_quantity,
    afterTotalQuantity: row.after_total_quantity,
    changedAt: row.changed_at,
  }));
}

export function zhihouInventoryPickOptions(input: {
  productManagementRecordId: number | null;
  productCodes: string[];
  targetSpu: string | null;
  targetSkcRowId: number | null;
  targetColor: string;
  targetSize: string;
  targetKey: string;
}): ZhihouInventoryPickOption[] {
  if (!hasTable("y2_inventory_cells") || !hasTable("zhihou_size_conversion_options") || !hasTable("y2_inventory_product_spus")) return [];
  const targetSpu = input.targetSpu?.trim().toUpperCase() ?? "";
  if (!targetSpu) return [];
  const conditions: string[] = [`EXISTS (
    SELECT 1 FROM y2_inventory_product_spus inventory_spu
    WHERE inventory_spu.inventory_product_id = product.id
      AND UPPER(TRIM(inventory_spu.spu)) = ?
  )`];
  const parameters: Array<number | string> = [targetSpu];
  const colorCondition = input.targetSkcRowId === null
    ? "color.normalized_color = ?"
    : "color.skc_row_id = ?";
  const colorParameter = input.targetSkcRowId ?? normalizedSpec(input.targetColor);
  const rows = database.prepare(
    `SELECT cell.id, product.product_code, color.color_name, cell.size_name,
            MAX(cell.quantity - COALESCE(reservation.quantity, 0), 0) AS quantity,
            CASE WHEN conversion.id IS NULL THEN 0 ELSE 1 END AS saved_conversion
     FROM y2_inventory_products product
     JOIN y2_inventory_colors color ON color.inventory_product_id = product.id
     JOIN y2_inventory_cells cell ON cell.color_row_id = color.id
     LEFT JOIN zhihou_size_conversion_options conversion
       ON conversion.target_key = ? AND conversion.inventory_cell_id = cell.id
     LEFT JOIN (
       SELECT inventory_cell_id, SUM(picked_quantity - adjusted_quantity) AS quantity
       FROM zhihou_stock_pick_items GROUP BY inventory_cell_id
     ) reservation ON reservation.inventory_cell_id = cell.id
     WHERE (${conditions.join(" OR ")})
       AND ${colorCondition}
       AND cell.quantity - COALESCE(reservation.quantity, 0) > 0
     ORDER BY
       CASE WHEN cell.normalized_size = ? THEN 0
            WHEN conversion.id IS NOT NULL THEN 1 ELSE 2 END,
       color.sort_order, cell.id`,
  ).all(
    input.targetKey,
    ...parameters,
    colorParameter,
    normalizedSpec(input.targetSize),
  ) as Array<{
    id: number;
    product_code: string;
    color_name: string;
    size_name: string;
    quantity: number;
    saved_conversion: number;
  }>;
  return rows.map((row) => ({
    inventoryCellId: row.id,
    productCode: row.product_code,
    color: row.color_name,
    size: row.size_name,
    quantity: row.quantity,
    isExact:
      normalizedSpec(row.color_name) === normalizedSpec(input.targetColor) &&
      normalizedSpec(row.size_name) === normalizedSpec(input.targetSize),
    isSavedConversion: Boolean(row.saved_conversion),
  }));
}

export function y2InventoryBySku(skuId: string | null, skuCode: string | null): {
  quantity: number;
  status: Y2InventoryMatchStatus;
  message: string | null;
} | null {
  if (!hasTable("y2_inventory_cells")) return null;
  const values = [skuId, skuCode].filter((value): value is string => Boolean(value?.trim()));
  if (!values.length) return null;
  const normalizedValues = values.map((value) => value.trim().toUpperCase());
  const placeholders = normalizedValues.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT quantity, match_status, match_message FROM y2_inventory_cells
       WHERE UPPER(TRIM(COALESCE(sku_id, ''))) IN (${placeholders})
          OR UPPER(TRIM(COALESCE(sku_code, ''))) IN (${placeholders})`,
    )
    .all(...normalizedValues, ...normalizedValues) as Array<{
    quantity: number;
    match_status: Y2InventoryMatchStatus;
    match_message: string | null;
  }>;
  if (rows.length !== 1) {
    return rows.length
      ? { quantity: 0, status: "conflict", message: "SKU匹配到多条Y2库存记录。" }
      : null;
  }
  return { quantity: rows[0]!.quantity, status: rows[0]!.match_status, message: rows[0]!.match_message };
}
