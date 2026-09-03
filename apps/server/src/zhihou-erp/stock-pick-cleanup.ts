import { database } from "../database/index.js";

/**
 * 清理订单同步后已失效的配货占用。
 *
 * 配货记录本身是按 target_key 聚合的：只要同一个 target_key 仍有活跃订单，
 * 配货记录可以继续保留；否则删除配货占用记录。已修正库存代表 ERP 侧已经处理，
 * 订单从同步结果中消失时不能返还库存。
 * 该函数应在订单快照完成 active/inactive 更新后调用，并运行在同一个事务内。
 */
export function releaseInactiveZhihouStockPicks(): {
  releasedQuantity: number;
  deletedPickCount: number;
} {
  const stalePicks = database.prepare(
    `SELECT pick.id, pick.inventory_cell_id, pick.adjusted_quantity
     FROM zhihou_stock_pick_items pick
     WHERE EXISTS (
       SELECT 1
       FROM zhihou_stock_order_item_snapshots item
       WHERE item.target_key = pick.target_key
     )
       AND NOT EXISTS (
         SELECT 1
         FROM zhihou_stock_order_item_snapshots item
         JOIN zhihou_stock_order_snapshots order_row
           ON order_row.id = item.order_snapshot_id
         WHERE item.target_key = pick.target_key
           AND order_row.is_active = 1
       )
     ORDER BY pick.id`,
  ).all() as Array<{
    id: number;
    inventory_cell_id: number;
    adjusted_quantity: number;
  }>;

  const deleteAllocations = database.prepare(
    "DELETE FROM zhihou_stock_pick_allocations WHERE pick_item_id = ?",
  );
  const deleteAdjustmentLogs = database.prepare(
    "DELETE FROM zhihou_inventory_adjustment_logs WHERE pick_item_id = ?",
  );
  const deletePick = database.prepare(
    "DELETE FROM zhihou_stock_pick_items WHERE id = ?",
  );

  let releasedQuantity = 0;
  for (const pick of stalePicks) {
    deleteAllocations.run(pick.id);
    // 已修正库存表示 ERP 已完成处理，只清理关联日志以便删除配货记录，不能返还库存。
    if (pick.adjusted_quantity > 0) {
      deleteAdjustmentLogs.run(pick.id);
    }
    deletePick.run(pick.id);
  }

  database.prepare(
    `DELETE FROM zhihou_stock_pick_batches
     WHERE NOT EXISTS (
       SELECT 1 FROM zhihou_stock_pick_items pick
       WHERE pick.batch_id = zhihou_stock_pick_batches.id
     )`,
  ).run();

  return { releasedQuantity, deletedPickCount: stalePicks.length };
}

/**
 * 删除仍有活跃订单的配货记录中的失效订单分配，避免历史订单继续占用匹配数量。
 */
export function removeInactiveZhihouStockAllocations(): number {
  const result = database.prepare(
    `DELETE FROM zhihou_stock_pick_allocations
     WHERE NOT EXISTS (
       SELECT 1
       FROM zhihou_stock_order_item_snapshots item
       JOIN zhihou_stock_order_snapshots order_row
         ON order_row.id = item.order_snapshot_id
       WHERE item.id = zhihou_stock_pick_allocations.order_item_snapshot_id
         AND order_row.is_active = 1
     )`,
  ).run();

  database.prepare(
    `UPDATE zhihou_stock_pick_items
     SET matched_quantity = MIN(
       picked_quantity,
       COALESCE((
         SELECT SUM(allocation.quantity)
         FROM zhihou_stock_pick_allocations allocation
         WHERE allocation.pick_item_id = zhihou_stock_pick_items.id
       ), 0)
     ), updated_at = CURRENT_TIMESTAMP
     WHERE EXISTS (
       SELECT 1 FROM zhihou_stock_order_item_snapshots item
       JOIN zhihou_stock_order_snapshots order_row
         ON order_row.id = item.order_snapshot_id
       WHERE item.target_key = zhihou_stock_pick_items.target_key
         AND order_row.is_active = 1
     )`,
  ).run();

  return result.changes;
}
