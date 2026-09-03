import type {
  UserAccount,
  ZhihouBatchStockPickInput,
  ZhihouBatchStockPickPreview,
  ZhihouBatchStockPickResult,
  ZhihouInventoryAdjustmentResult,
  ZhihouStockMatchResult,
  ZhihouStockPickDashboard,
  ZhihouStockPickInput,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { latestCompletedZhihouOrderSync } from "./order-sync-service.js";
import {
  getZhihouOrderReferences,
  getZhihouOrderSummary,
} from "./order-summary-service.js";

interface InventoryCellRow {
  id: number;
  quantity: number;
  size_name: string;
  color_name: string;
  product_code: string;
}

interface PickRow {
  id: number;
  target_key: string;
  parent_spu: string | null;
  target_zhihou_sku: string;
  target_color: string;
  target_size: string;
  inventory_cell_id: number;
  product_code: string;
  source_color: string;
  source_size: string;
  picked_quantity: number;
  matched_quantity: number;
  active_matched_quantity: number;
  adjusted_quantity: number;
  created_at: string;
}

function inventoryCell(id: number): InventoryCellRow {
  const row = database.prepare(
    `SELECT cell.id, cell.quantity, cell.size_name, color.color_name, product.product_code
     FROM y2_inventory_cells cell
     JOIN y2_inventory_colors color ON color.id = cell.color_row_id
     JOIN y2_inventory_products product ON product.id = color.inventory_product_id
     WHERE cell.id = ?`,
  ).get(id) as InventoryCellRow | undefined;
  if (!row) throw new Error("选择的Y2库存规格不存在。");
  return row;
}

function summaryCell(targetKey: string) {
  for (const matrix of getZhihouOrderSummary().matrices) {
    for (const colorRow of matrix.colorRows) {
      for (const cell of Object.values(colorRow.cells)) {
        if (cell.key === targetKey) return cell;
      }
    }
  }
  throw new Error("订单规格不存在或已被新同步替换。");
}

function snapshotOrders(targetKey: string): void {
  const cell = summaryCell(targetKey);
  const references = getZhihouOrderReferences(targetKey).orders;
  const latest = latestCompletedZhihouOrderSync();
  if (!latest) throw new Error("尚无成功的智猴新订单同步数据。");
  const orderTotal = database.prepare(
    `SELECT COALESCE(SUM(item.quantity), 0) AS quantity
     FROM zhihou_new_order_items item
     JOIN zhihou_new_orders order_row ON order_row.id = item.order_id
     WHERE item.sync_batch_id = ? AND order_row.order_no = ?`,
  );
  const upsertOrder = database.prepare(
    `INSERT INTO zhihou_stock_order_snapshots
       (order_no, submitted_at, store_name, country_code, required_quantity)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(order_no) DO UPDATE SET
       submitted_at = excluded.submitted_at,
       store_name = excluded.store_name,
       country_code = excluded.country_code,
       required_quantity = excluded.required_quantity,
       updated_at = CURRENT_TIMESTAMP`,
  );
  const orderId = database.prepare(
    "SELECT id FROM zhihou_stock_order_snapshots WHERE order_no = ?",
  );
  const upsertItem = database.prepare(
    `INSERT INTO zhihou_stock_order_item_snapshots
      (order_snapshot_id, external_item_key, target_key, target_zhihou_sku,
       target_color, target_size, required_quantity)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_item_key) DO UPDATE SET
      order_snapshot_id = excluded.order_snapshot_id,
      target_key = excluded.target_key,
      target_zhihou_sku = excluded.target_zhihou_sku,
      target_color = excluded.target_color,
      target_size = excluded.target_size,
      required_quantity = excluded.required_quantity,
      updated_at = CURRENT_TIMESTAMP`,
  );
  for (const reference of references) {
    const total = (orderTotal.get(latest.id, reference.orderNo) as { quantity: number }).quantity;
    upsertOrder.run(
      reference.orderNo,
      reference.submittedAt,
      reference.storeName,
      reference.countryCode,
      total,
    );
    database
      .prepare(
        `UPDATE zhihou_stock_order_snapshots
         SET is_active = 1, last_seen_sync_batch_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE order_no = ?`,
      )
      .run(latest.id, reference.orderNo);
    const snapshot = orderId.get(reference.orderNo) as { id: number };
    upsertItem.run(
      snapshot.id,
      `${reference.orderNo}:${targetKey}`,
      targetKey,
      cell.zhihouSkus[0] ?? "-",
      cell.color,
      cell.size,
      reference.quantity,
    );
  }
}

export function createZhihouStockPick(
  user: UserAccount,
  input: ZhihouStockPickInput,
): ZhihouStockPickDashboard {
  const save = database.transaction(() => {
    const cell = summaryCell(input.targetKey);
    const source = inventoryCell(input.inventoryCellId);
    if (!cell.inventoryPickOptions.some((option) => option.inventoryCellId === source.id)) {
      throw new Error("所选库存规格不属于该订单产品。");
    }
    if (input.quantity > source.quantity) throw new Error("配货数量不能超过当前Y2库存数量。");
    const remainingDemand = Math.max(cell.requiredQuantity - cell.pickedQuantity, 0);
    if (input.quantity > remainingDemand) throw new Error("配货数量不能超过尚未拿货的订单需求。");
    const batchId = Number(database.prepare(
      "INSERT INTO zhihou_stock_pick_batches (created_by_user_id) VALUES (?)",
    ).run(user.id).lastInsertRowid);
    database.prepare(
      `INSERT INTO zhihou_stock_pick_items
       (batch_id, target_key, parent_spu, target_zhihou_sku, target_color, target_size,
        inventory_cell_id, source_color, source_size, picked_quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      batchId,
      cell.key,
      cell.parentSpu,
      cell.zhihouSkus[0] ?? "-",
      cell.color,
      cell.size,
      source.id,
      source.color_name,
      source.size_name,
      input.quantity,
    );
    if (input.saveConversion && source.size_name.trim().toUpperCase() !== cell.size.trim().toUpperCase()) {
      database.prepare(
        `INSERT INTO zhihou_size_conversion_options
         (target_key, target_size, inventory_cell_id, source_size, created_by_user_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(target_key, inventory_cell_id) DO UPDATE SET
           target_size = excluded.target_size,
           source_size = excluded.source_size,
           created_by_user_id = excluded.created_by_user_id,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(cell.key, cell.size, source.id, source.size_name, user.id);
    }
    snapshotOrders(cell.key);
  });
  save();
  return getZhihouStockPickDashboard();
}

function uniqueTargetKeys(input: ZhihouBatchStockPickInput): string[] {
  return [...new Set(input.targetKeys.map((key) => key.trim()).filter(Boolean))];
}

function batchStockPickPreview(targetKeys: string[]): ZhihouBatchStockPickPreview {
  let pickableTargetCount = 0;
  let expectedQuantity = 0;
  let insufficientTargetCount = 0;
  let unavailableTargetCount = 0;
  for (const targetKey of targetKeys) {
    const cell = summaryCell(targetKey);
    const remaining = Math.max(cell.requiredQuantity - cell.pickedQuantity, 0);
    const exactQuantity = cell.inventoryPickOptions
      .filter((option) => option.isExact)
      .reduce((total, option) => total + option.quantity, 0);
    const quantity = Math.min(remaining, exactQuantity);
    if (quantity > 0) pickableTargetCount += 1;
    if (exactQuantity === 0) unavailableTargetCount += 1;
    else if (exactQuantity < remaining) insufficientTargetCount += 1;
    expectedQuantity += quantity;
  }
  return {
    targetCount: targetKeys.length,
    pickableTargetCount,
    expectedQuantity,
    insufficientTargetCount,
    unavailableTargetCount,
  };
}

export function previewZhihouBatchStockPick(
  input: ZhihouBatchStockPickInput,
): ZhihouBatchStockPickPreview {
  return batchStockPickPreview(uniqueTargetKeys(input));
}

export function createZhihouBatchStockPick(
  user: UserAccount,
  input: ZhihouBatchStockPickInput,
): ZhihouBatchStockPickResult {
  const targetKeys = uniqueTargetKeys(input);
  const result = database.transaction(() => {
    const preview = batchStockPickPreview(targetKeys);
    let pickedQuantity = 0;
    let createdPickCount = 0;
    let batchId: number | null = null;
    const reservedByInventoryCell = new Map<number, number>();
    for (const targetKey of targetKeys) {
      const cell = summaryCell(targetKey);
      let remaining = Math.max(cell.requiredQuantity - cell.pickedQuantity, 0);
      const exactOptions = cell.inventoryPickOptions.filter((option) => option.isExact);
      for (const option of exactOptions) {
        if (remaining <= 0) break;
        const sourceQuantity = inventoryCell(option.inventoryCellId).quantity;
        const reservedQuantity = reservedByInventoryCell.get(option.inventoryCellId) ?? 0;
        const quantity = Math.min(remaining, Math.max(sourceQuantity - reservedQuantity, 0));
        if (quantity <= 0) continue;
        if (batchId === null) {
          batchId = Number(database.prepare(
            "INSERT INTO zhihou_stock_pick_batches (created_by_user_id) VALUES (?)",
          ).run(user.id).lastInsertRowid);
        }
        database.prepare(
          `INSERT INTO zhihou_stock_pick_items
           (batch_id, target_key, parent_spu, target_zhihou_sku, target_color, target_size,
            inventory_cell_id, source_color, source_size, picked_quantity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          batchId, cell.key, cell.parentSpu, cell.zhihouSkus[0] ?? "-", cell.color, cell.size,
          option.inventoryCellId, option.color, option.size, quantity,
        );
        reservedByInventoryCell.set(
          option.inventoryCellId,
          reservedQuantity + quantity,
        );
        snapshotOrders(cell.key);
        remaining -= quantity;
        pickedQuantity += quantity;
        createdPickCount += 1;
      }
    }
    return { ...preview, pickedQuantity, createdPickCount };
  })();
  return result;
}

export function deleteZhihouStockPick(id: number): void {
  const remove = database.transaction(() => {
    const pick = database.prepare(
      `SELECT inventory_cell_id, picked_quantity, matched_quantity, adjusted_quantity
       FROM zhihou_stock_pick_items WHERE id = ?`,
    ).get(id) as {
      inventory_cell_id: number;
      picked_quantity: number;
      matched_quantity: number;
      adjusted_quantity: number;
    } | undefined;
    if (!pick) throw new Error("配货记录不存在。");

    const allocation = database.prepare(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity
       FROM zhihou_stock_pick_allocations WHERE pick_item_id = ?`,
    ).get(id) as { quantity: number };
    if (allocation.quantity > 0) {
      database.prepare(
        "DELETE FROM zhihou_stock_pick_allocations WHERE pick_item_id = ?",
      ).run(id);
    }

    if (pick.adjusted_quantity > 0) {
      const cell = database.prepare(
        "SELECT quantity FROM y2_inventory_cells WHERE id = ?",
      ).get(pick.inventory_cell_id) as { quantity: number } | undefined;
      if (!cell) throw new Error("配货记录对应的Y2库存规格不存在。");
      database.prepare(
        `UPDATE y2_inventory_cells
         SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(pick.adjusted_quantity, pick.inventory_cell_id);
      database.prepare(
        "DELETE FROM zhihou_inventory_adjustment_logs WHERE pick_item_id = ?",
      ).run(id);
    }

    database.prepare("DELETE FROM zhihou_stock_pick_items WHERE id = ?").run(id);
  });
  remove();
}

export function matchZhihouStockPicks(): ZhihouStockMatchResult {
  const match = database.transaction(() => {
    const picks = database.prepare(
      `SELECT id, target_key, picked_quantity, matched_quantity
       FROM zhihou_stock_pick_items
       WHERE matched_quantity < picked_quantity ORDER BY created_at, id`,
    ).all() as Array<{ id: number; target_key: string; picked_quantity: number; matched_quantity: number }>;
    const allocatedForItem = database.prepare(
      `SELECT COALESCE(SUM(allocation.quantity), 0) AS quantity
       FROM zhihou_stock_pick_allocations allocation
       WHERE allocation.order_item_snapshot_id = ?`,
    );
    const insert = database.prepare(
      `INSERT INTO zhihou_stock_pick_allocations
       (pick_item_id, order_item_snapshot_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT(pick_item_id, order_item_snapshot_id) DO UPDATE SET
         quantity = quantity + excluded.quantity`,
    );
    let allocatedQuantity = 0;
    for (const pick of picks) {
      let available = pick.picked_quantity - pick.matched_quantity;
      const targets = database.prepare(
        `SELECT item.id, item.required_quantity
         FROM zhihou_stock_order_item_snapshots item
         JOIN zhihou_stock_order_snapshots order_row ON order_row.id = item.order_snapshot_id
         WHERE item.target_key = ? AND order_row.is_active = 1
         ORDER BY COALESCE(order_row.submitted_at, '9999-12-31'), order_row.order_no, item.id`,
      ).all(pick.target_key) as Array<{ id: number; required_quantity: number }>;
      for (const target of targets) {
        if (available <= 0) break;
        const allocated = (allocatedForItem.get(target.id) as { quantity: number }).quantity;
        const quantity = Math.min(available, Math.max(target.required_quantity - allocated, 0));
        if (!quantity) continue;
        insert.run(pick.id, target.id, quantity);
        available -= quantity;
        allocatedQuantity += quantity;
      }
      database.prepare(
        `UPDATE zhihou_stock_pick_items SET matched_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(pick.picked_quantity - available, pick.id);
    }
    return allocatedQuantity;
  });
  const allocatedQuantity = match();
  const dashboard = getZhihouStockPickDashboard();
  return { allocatedQuantity, completedOrderCount: dashboard.completedOrderCount };
}

export function adjustZhihouStockInventory(user: UserAccount): ZhihouInventoryAdjustmentResult {
  return database.transaction(() => {
    const picks = database.prepare(
      `SELECT id, inventory_cell_id, picked_quantity, adjusted_quantity
       FROM zhihou_stock_pick_items
       WHERE adjusted_quantity < picked_quantity ORDER BY created_at, id`,
    ).all() as Array<{
      id: number;
      inventory_cell_id: number;
      picked_quantity: number;
      adjusted_quantity: number;
    }>;
    let adjustedQuantity = 0;
    let adjustedPickCount = 0;
    let skippedPickCount = 0;
    for (const pick of picks) {
      const quantity = pick.picked_quantity - pick.adjusted_quantity;
      const source = inventoryCell(pick.inventory_cell_id);
      if (source.quantity < quantity) {
        skippedPickCount += 1;
        continue;
      }
      database.prepare(
        `UPDATE y2_inventory_cells SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(quantity, source.id);
      database.prepare(
        `INSERT INTO zhihou_inventory_adjustment_logs
         (pick_item_id, inventory_cell_id, quantity, before_quantity, after_quantity, adjusted_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(pick.id, source.id, quantity, source.quantity, source.quantity - quantity, user.id);
      database.prepare(
        `UPDATE zhihou_stock_pick_items SET adjusted_quantity = picked_quantity,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(pick.id);
      adjustedQuantity += quantity;
      adjustedPickCount += 1;
    }
    return { adjustedQuantity, adjustedPickCount, skippedPickCount };
  })();
}

export function getZhihouStockPickDashboard(): ZhihouStockPickDashboard {
  const picks = database.prepare(
    `SELECT pick.*, product.product_code,
            COALESCE((
              SELECT SUM(allocation.quantity)
              FROM zhihou_stock_pick_allocations allocation
              JOIN zhihou_stock_order_item_snapshots item
                ON item.id = allocation.order_item_snapshot_id
              JOIN zhihou_stock_order_snapshots order_row
                ON order_row.id = item.order_snapshot_id
              WHERE allocation.pick_item_id = pick.id AND order_row.is_active = 1
            ), 0) AS active_matched_quantity
     FROM zhihou_stock_pick_items pick
     JOIN y2_inventory_cells cell ON cell.id = pick.inventory_cell_id
     JOIN y2_inventory_colors color ON color.id = cell.color_row_id
     JOIN y2_inventory_products product ON product.id = color.inventory_product_id
     WHERE EXISTS (
       SELECT 1
       FROM zhihou_stock_order_item_snapshots active_item
       JOIN zhihou_stock_order_snapshots active_order
         ON active_order.id = active_item.order_snapshot_id
       WHERE active_item.target_key = pick.target_key AND active_order.is_active = 1
     )
     ORDER BY pick.created_at DESC, pick.id DESC`,
  ).all() as PickRow[];
  const orderRows = database.prepare(
    `SELECT order_row.id, order_row.order_no, order_row.submitted_at, order_row.required_quantity,
            COALESCE(SUM(allocation.quantity), 0) AS allocated_quantity
     FROM zhihou_stock_order_snapshots order_row
     LEFT JOIN zhihou_stock_order_item_snapshots item ON item.order_snapshot_id = order_row.id
     LEFT JOIN zhihou_stock_pick_allocations allocation ON allocation.order_item_snapshot_id = item.id
     WHERE order_row.is_active = 1
     GROUP BY order_row.id
     HAVING allocated_quantity > 0
     ORDER BY COALESCE(order_row.submitted_at, '9999-12-31'), order_row.order_no`,
  ).all() as Array<{
    id: number;
    order_no: string;
    submitted_at: string | null;
    required_quantity: number;
    allocated_quantity: number;
  }>;
  const itemRows = database.prepare(
    `SELECT item.order_snapshot_id, allocation.pick_item_id, product.product_code,
            item.target_zhihou_sku, item.target_color, item.target_size,
            pick.source_color, pick.source_size, allocation.quantity
      FROM zhihou_stock_pick_allocations allocation
      JOIN zhihou_stock_order_item_snapshots item ON item.id = allocation.order_item_snapshot_id
      JOIN zhihou_stock_order_snapshots order_row ON order_row.id = item.order_snapshot_id
      JOIN zhihou_stock_pick_items pick ON pick.id = allocation.pick_item_id
      JOIN y2_inventory_cells cell ON cell.id = pick.inventory_cell_id
      JOIN y2_inventory_colors color ON color.id = cell.color_row_id
      JOIN y2_inventory_products product ON product.id = color.inventory_product_id
      WHERE order_row.is_active = 1
      ORDER BY allocation.id`,
    ).all() as Array<{
      order_snapshot_id: number;
      pick_item_id: number;
      product_code: string;
      target_zhihou_sku: string;
      target_color: string;
      target_size: string;
      source_color: string;
      source_size: string;
      quantity: number;
    }>;
  const imageUrlsByTargetKey = new Map(
    getZhihouOrderSummary().matrices.flatMap((matrix) =>
      matrix.colorRows.flatMap((colorRow) =>
        Object.values(colorRow.cells).map((cell) => [cell.key, cell.imageUrls] as const),
      ),
    ),
  );
  const mappedPicks = picks.map((row) => ({
    id: row.id,
    imageUrl: imageUrlsByTargetKey.get(row.target_key)?.[0] ?? null,
    imageUrls: imageUrlsByTargetKey.get(row.target_key) ?? [],
    targetKey: row.target_key,
    parentSpu: row.parent_spu,
    targetZhihouSku: row.target_zhihou_sku,
    targetColor: row.target_color,
    targetSize: row.target_size,
    inventoryCellId: row.inventory_cell_id,
    productCode: row.product_code,
    sourceColor: row.source_color,
    sourceSize: row.source_size,
    pickedQuantity: row.active_matched_quantity + (row.picked_quantity - row.matched_quantity),
    matchedQuantity: row.active_matched_quantity,
    unmatchedQuantity: row.picked_quantity - row.matched_quantity,
    adjustedQuantity: Math.min(
      row.adjusted_quantity,
      row.active_matched_quantity + (row.picked_quantity - row.matched_quantity),
    ),
    inventoryAdjusted: row.adjusted_quantity >=
      row.active_matched_quantity + (row.picked_quantity - row.matched_quantity),
    createdAt: row.created_at,
  }));
  const orders = orderRows.map((row) => {
    const items = itemRows.filter((item) => item.order_snapshot_id === row.id);
    return {
      orderNo: row.order_no,
      productCodes: [...new Set(items.map((item) => item.product_code))].sort((left, right) => left.localeCompare(right, "zh-CN")),
      submittedAt: row.submitted_at,
      requiredQuantity: row.required_quantity,
      allocatedQuantity: row.allocated_quantity,
      complete: row.allocated_quantity >= row.required_quantity,
      items: items.map((item) => ({
        pickItemId: item.pick_item_id,
        productCode: item.product_code,
        targetZhihouSku: item.target_zhihou_sku,
        targetColor: item.target_color,
        targetSize: item.target_size,
        sourceColor: item.source_color,
        sourceSize: item.source_size,
        quantity: item.quantity,
      })),
    };
  });
  return {
    picks: mappedPicks,
    orders,
    totalPickedQuantity: mappedPicks.reduce((total, item) => total + item.pickedQuantity, 0),
    totalUnmatchedQuantity: mappedPicks.reduce((total, item) => total + item.unmatchedQuantity, 0),
    totalUnadjustedQuantity: mappedPicks.reduce(
      (total, item) => total + Math.max(item.pickedQuantity - item.adjustedQuantity, 0),
      0,
    ),
    completedOrderCount: orders.filter((order) => order.complete).length,
  };
}
