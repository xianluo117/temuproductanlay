import type {
  DashboardResponse,
  MetricTotals,
  ProductDetailResponse,
  ProductSummary,
  TrendPoint,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";

interface DateRow {
  data_date: string;
}
interface MetricRow {
  data_date: string;
  spu: string;
  first_listed_at: string | null;
  impressions: number;
  clicks: number;
  visitors: number;
  cart_users: number;
  orders: number;
  detail_paid_buyers: number;
  detail_payment_conversion_rate: number | null;
  impression_order_conversion_rate: number | null;
  search_impressions: number;
  file_name: string | null;
  source_type: "embedded" | "remote" | null;
}
interface TotalRow {
  product_count: number;
  impressions: number;
  clicks: number;
  visitors: number;
  cart_users: number;
  orders: number;
  detail_paid_buyers: number;
  search_impressions: number;
}

function divide(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function mapTotals(row?: TotalRow): MetricTotals {
  const value = row ?? {
    product_count: 0,
    impressions: 0,
    clicks: 0,
    visitors: 0,
    cart_users: 0,
    orders: 0,
    detail_paid_buyers: 0,
    search_impressions: 0,
  };
  return {
    productCount: value.product_count,
    impressions: value.impressions,
    clicks: value.clicks,
    visitors: value.visitors,
    cartUsers: value.cart_users,
    orders: value.orders,
    detailPaidBuyers: value.detail_paid_buyers,
    searchImpressions: value.search_impressions,
    clickThroughRate: divide(value.clicks, value.impressions),
    cartRate: divide(value.cart_users, value.visitors),
    detailPaymentConversionRate: divide(
      value.detail_paid_buyers,
      value.cart_users,
    ),
    impressionOrderConversionRate: divide(value.orders, value.impressions),
  };
}

function mapProduct(row: MetricRow): ProductSummary {
  return {
    date: row.data_date,
    spu: row.spu,
    firstListedAt: row.first_listed_at,
    imageUrl: row.file_name
      ? `/api/images/${encodeURIComponent(row.file_name)}`
      : null,
    imageSource: row.source_type ?? "none",
    impressions: row.impressions,
    clicks: row.clicks,
    visitors: row.visitors,
    cartUsers: row.cart_users,
    orders: row.orders,
    detailPaidBuyers: row.detail_paid_buyers,
    detailPaymentConversionRate: row.detail_payment_conversion_rate,
    impressionOrderConversionRate: row.impression_order_conversion_rate,
    searchImpressions: row.search_impressions,
    clickThroughRate: divide(row.clicks, row.impressions),
    cartRate: divide(row.cart_users, row.visitors),
    orderRate: divide(row.orders, row.visitors),
  };
}

const totalSql = `
  SELECT COUNT(*) AS product_count,
    COALESCE(SUM(impressions), 0) AS impressions,
    COALESCE(SUM(clicks), 0) AS clicks,
    COALESCE(SUM(visitors), 0) AS visitors,
    COALESCE(SUM(cart_users), 0) AS cart_users,
    COALESCE(SUM(orders), 0) AS orders,
    COALESCE(SUM(detail_paid_buyers), 0) AS detail_paid_buyers,
    COALESCE(SUM(search_impressions), 0) AS search_impressions
  FROM daily_metrics WHERE shop_profile_id = ? AND data_date = ?`;

const productSelect = `
  SELECT m.data_date, m.spu, m.first_listed_at, m.impressions, m.clicks, m.visitors,
    m.cart_users, m.orders, m.detail_paid_buyers, m.detail_payment_conversion_rate,
    m.impression_order_conversion_rate, m.search_impressions, a.file_name, a.source_type
  FROM daily_metrics m
  JOIN products p ON p.shop_profile_id = m.shop_profile_id AND p.spu = m.spu
  LEFT JOIN image_assets a ON a.id = p.image_asset_id`;

export function getAvailableDates(shopId: number): string[] {
  return (
    database
      .prepare(
        "SELECT DISTINCT data_date FROM daily_metrics WHERE shop_profile_id = ? ORDER BY data_date DESC",
      )
      .all(shopId) as DateRow[]
  ).map((row) => row.data_date);
}

export function getDashboard(
  shopId: number,
  requestedDate?: string,
): DashboardResponse {
  const availableDates = getAvailableDates(shopId);
  const selectedDate =
    requestedDate && availableDates.includes(requestedDate)
      ? requestedDate
      : (availableDates[0] ?? null);
  if (!selectedDate)
    return {
      selectedDate: null,
      previousDate: null,
      availableDates,
      totals: mapTotals(),
      previousTotals: null,
      trend: [],
      rankings: [],
    };
  const currentIndex = availableDates.indexOf(selectedDate);
  const previousDate = availableDates[currentIndex + 1] ?? null;
  const totals = mapTotals(
    database.prepare(totalSql).get(shopId, selectedDate) as TotalRow,
  );
  const previousTotals = previousDate
    ? mapTotals(
        database.prepare(totalSql).get(shopId, previousDate) as TotalRow,
      )
    : null;
  const trendRows = database
    .prepare(
      `
    SELECT data_date, COUNT(*) AS product_count,
      COALESCE(SUM(impressions), 0) AS impressions, COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(visitors), 0) AS visitors, COALESCE(SUM(cart_users), 0) AS cart_users,
      COALESCE(SUM(orders), 0) AS orders, COALESCE(SUM(detail_paid_buyers), 0) AS detail_paid_buyers,
      COALESCE(SUM(search_impressions), 0) AS search_impressions
    FROM daily_metrics WHERE shop_profile_id = ? GROUP BY data_date ORDER BY data_date
  `,
    )
    .all(shopId) as Array<TotalRow & { data_date: string }>;
  const trend: TrendPoint[] = trendRows.map((row) => ({
    date: row.data_date,
    ...mapTotals(row),
  }));
  const rankings = (
    database
      .prepare(
        `${productSelect} WHERE m.shop_profile_id = ? AND m.data_date = ? ORDER BY m.orders DESC, m.impressions DESC LIMIT 20`,
      )
      .all(shopId, selectedDate) as MetricRow[]
  ).map(mapProduct);
  return {
    selectedDate,
    previousDate,
    availableDates,
    totals,
    previousTotals,
    trend,
    rankings,
  };
}

export function parseSpuSearchTokens(search?: string): string[] {
  return [
    ...new Set(
      (search ?? "")
        .split(/[\s,，]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function getProducts(
  shopId: number,
  options: { date?: string; search?: string; sort?: string; order?: string },
): ProductSummary[] {
  const date = options.date ?? getAvailableDates(shopId)[0];
  if (!date) return [];
  const allowedSort: Record<string, string> = {
    impressions: "m.impressions",
    clicks: "m.clicks",
    visitors: "m.visitors",
    cartUsers: "m.cart_users",
    orders: "m.orders",
    detailPaidBuyers: "m.detail_paid_buyers",
    searchImpressions: "m.search_impressions",
    spu: "m.spu",
    detailPaymentConversionRate: "m.detail_payment_conversion_rate",
    impressionOrderConversionRate: "m.impression_order_conversion_rate",
  };
  const sortColumn = allowedSort[options.sort ?? "orders"] ?? "m.orders";
  const order = options.order === "asc" ? "ASC" : "DESC";
  const tokens = parseSpuSearchTokens(options.search);
  if (tokens.length > 1) {
    const placeholders = tokens.map(() => "?").join(", ");
    return (
      database
        .prepare(
          `${productSelect} WHERE m.shop_profile_id = ? AND m.data_date = ? AND m.spu IN (${placeholders}) ORDER BY ${sortColumn} ${order}, m.spu ASC`,
        )
        .all(shopId, date, ...tokens) as MetricRow[]
    ).map(mapProduct);
  }
  const search = `%${tokens[0] ?? ""}%`;
  return (
    database
      .prepare(
        `${productSelect} WHERE m.shop_profile_id = ? AND m.data_date = ? AND m.spu LIKE ? ORDER BY ${sortColumn} ${order}, m.spu ASC`,
      )
      .all(shopId, date, search) as MetricRow[]
  ).map(mapProduct);
}

export function getProductDetail(
  shopId: number,
  spu: string,
): ProductDetailResponse | null {
  const rows = (
    database
      .prepare(
        `${productSelect} WHERE m.shop_profile_id = ? AND m.spu = ? ORDER BY m.data_date`,
      )
      .all(shopId, spu) as MetricRow[]
  ).map(mapProduct);
  if (rows.length === 0) return null;
  const latest = rows.at(-1)!;
  return {
    spu,
    imageUrl: latest.imageUrl,
    imageSource: latest.imageSource,
    firstListedAt: latest.firstListedAt,
    history: rows,
  };
}
