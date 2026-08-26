import type {
  AnomalyItem,
  AnomalyThresholds,
  ProductSummary,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { getAvailableDates, getProducts } from "./analytics-service.js";

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  impressionsDrop: 0.3,
  clickThroughRateDrop: 0.25,
  cartRateDrop: 0.3,
  conversionRateDrop: 0.3,
  consecutiveZeroOrderDays: 3,
  minimumImpressions: 50,
};

function changeRate(
  current: number | null,
  previous: number | null,
): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

function addDropAnomaly(
  result: AnomalyItem[],
  type: AnomalyItem["type"],
  title: string,
  current: ProductSummary,
  previous: ProductSummary,
  currentValue: number | null,
  previousValue: number | null,
  threshold: number,
): void {
  const change = changeRate(currentValue, previousValue);
  if (change === null || change > -threshold) return;
  result.push({
    type,
    severity: change <= -0.6 ? "critical" : "warning",
    spu: current.spu,
    date: current.date,
    title,
    description: `较上一数据日下降 ${Math.abs(change * 100).toFixed(1)}%`,
    currentValue,
    previousValue,
    changeRate: change,
  });
}

export function getThresholds(shopId: number): AnomalyThresholds {
  const row = database
    .prepare(
      "SELECT value_json FROM shop_settings WHERE shop_profile_id = ? AND key = 'anomaly_thresholds'",
    )
    .get(shopId) as { value_json: string } | undefined;
  if (!row) {
    database
      .prepare(
        "INSERT INTO shop_settings (shop_profile_id, key, value_json) VALUES (?, 'anomaly_thresholds', ?)",
      )
      .run(shopId, JSON.stringify(DEFAULT_THRESHOLDS));
    return DEFAULT_THRESHOLDS;
  }
  return JSON.parse(row.value_json) as AnomalyThresholds;
}

export function updateThresholds(
  shopId: number,
  thresholds: AnomalyThresholds,
): AnomalyThresholds {
  database
    .prepare(
      `
    INSERT INTO shop_settings (shop_profile_id, key, value_json, updated_at) VALUES (?, 'anomaly_thresholds', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(shop_profile_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP
  `,
    )
    .run(shopId, JSON.stringify(thresholds));
  return thresholds;
}

export function getAnomalies(
  shopId: number,
  requestedDate?: string,
): AnomalyItem[] {
  const dates = getAvailableDates(shopId);
  const selectedDate =
    requestedDate && dates.includes(requestedDate) ? requestedDate : dates[0];
  if (!selectedDate) return [];
  const previousDate = dates[dates.indexOf(selectedDate) + 1];
  if (!previousDate) return [];
  const thresholds = getThresholds(shopId);
  const current = getProducts(shopId, { date: selectedDate });
  const previousMap = new Map(
    getProducts(shopId, { date: previousDate }).map((item) => [item.spu, item]),
  );
  const result: AnomalyItem[] = [];
  for (const item of current) {
    const previous = previousMap.get(item.spu);
    if (!previous || previous.impressions < thresholds.minimumImpressions)
      continue;
    addDropAnomaly(
      result,
      "impressions_drop",
      "曝光量显著下降",
      item,
      previous,
      item.impressions,
      previous.impressions,
      thresholds.impressionsDrop,
    );
    addDropAnomaly(
      result,
      "ctr_drop",
      "点击率显著下降",
      item,
      previous,
      item.clickThroughRate,
      previous.clickThroughRate,
      thresholds.clickThroughRateDrop,
    );
    addDropAnomaly(
      result,
      "cart_rate_drop",
      "加购率显著下降",
      item,
      previous,
      item.cartRate,
      previous.cartRate,
      thresholds.cartRateDrop,
    );
    addDropAnomaly(
      result,
      "conversion_drop",
      "支付转化显著下降",
      item,
      previous,
      item.detailPaymentConversionRate,
      previous.detailPaymentConversionRate,
      thresholds.conversionRateDrop,
    );
  }
  const zeroOrderRows = database
    .prepare(
      `
    SELECT spu, COUNT(*) AS zero_days FROM (
      SELECT spu, data_date, orders, ROW_NUMBER() OVER (PARTITION BY spu ORDER BY data_date DESC) AS sequence
      FROM daily_metrics WHERE shop_profile_id = ? AND data_date <= ?
    ) WHERE sequence <= ? AND orders = 0 GROUP BY spu HAVING zero_days >= ?
  `,
    )
    .all(
      shopId,
      selectedDate,
      thresholds.consecutiveZeroOrderDays,
      thresholds.consecutiveZeroOrderDays,
    ) as Array<{ spu: string; zero_days: number }>;
  for (const row of zeroOrderRows) {
    result.push({
      type: "zero_orders",
      severity: "info",
      spu: row.spu,
      date: selectedDate,
      title: "连续无订单",
      description: `最近 ${row.zero_days} 个数据日均无订单`,
      currentValue: 0,
      previousValue: null,
      changeRate: null,
    });
  }
  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  return result.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity],
  );
}
