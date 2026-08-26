import type {
  SpuComparisonCandidate,
  SpuComparisonResponse,
} from "@temu-analytics/shared";
import { database } from "../database/index.js";
import { getProductDetail } from "./analytics-service.js";

interface CandidateRow {
  spu: string;
  first_listed_at: string | null;
  latest_date: string;
  file_name: string | null;
  source_type: "embedded" | "remote" | null;
}

interface DateRow {
  data_date: string;
}

function normalizeSpus(spus: string[]): string[] {
  const normalized = [
    ...new Set(spus.map((spu) => spu.trim()).filter(Boolean)),
  ];
  if (normalized.length < 2 || normalized.length > 5) {
    throw new Error("请选择 2-5 个不同的 SPU 进行对比。");
  }
  return normalized;
}

export function listSpuComparisonCandidates(
  shopId: number,
): SpuComparisonCandidate[] {
  const rows = database
    .prepare(
      `
    SELECT p.spu, p.first_listed_at, MAX(m.data_date) AS latest_date,
      a.file_name, a.source_type
    FROM products p
    JOIN daily_metrics m
      ON m.shop_profile_id = p.shop_profile_id
      AND m.spu = p.spu
    LEFT JOIN image_assets a ON a.id = p.image_asset_id
    WHERE p.shop_profile_id = ?
    GROUP BY p.shop_profile_id, p.spu, p.first_listed_at, a.file_name, a.source_type
    ORDER BY p.spu ASC
  `,
    )
    .all(shopId) as CandidateRow[];

  return rows.map((row) => ({
    spu: row.spu,
    imageUrl: row.file_name
      ? `/api/images/${encodeURIComponent(row.file_name)}`
      : null,
    imageSource: row.source_type ?? "none",
    firstListedAt: row.first_listed_at,
    latestDate: row.latest_date,
  }));
}

export function getSpuComparison(
  shopId: number,
  requestedSpus: string[],
  requestedDate?: string,
): SpuComparisonResponse {
  const spus = normalizeSpus(requestedSpus);
  const placeholders = spus.map(() => "?").join(", ");
  const existing = database
    .prepare(
      `
    SELECT spu
    FROM products
    WHERE shop_profile_id = ? AND spu IN (${placeholders})
  `,
    )
    .all(shopId, ...spus) as Array<{ spu: string }>;
  const existingSpus = new Set(existing.map((row) => row.spu));
  const missing = spus.filter((spu) => !existingSpus.has(spu));
  if (missing.length > 0) {
    throw new Error(`当前店铺中未找到 SPU：${missing.join("、")}。`);
  }

  const commonDates = (
    database
      .prepare(
        `
    SELECT data_date
    FROM daily_metrics
    WHERE shop_profile_id = ? AND spu IN (${placeholders})
    GROUP BY data_date
    HAVING COUNT(DISTINCT spu) = ?
    ORDER BY data_date DESC
  `,
      )
      .all(shopId, ...spus, spus.length) as DateRow[]
  ).map((row) => row.data_date);

  if (commonDates.length === 0) {
    throw new Error("所选 SPU 没有共同的数据日期，无法进行同日对比。");
  }
  if (requestedDate && !commonDates.includes(requestedDate)) {
    throw new Error("所选日期不是全部 SPU 的共同数据日期。");
  }

  const selectedDate = requestedDate ?? commonDates[0]!;
  const products = spus.map((spu) => {
    const detail = getProductDetail(shopId, spu);
    if (!detail) throw new Error(`当前店铺中未找到 SPU：${spu}。`);
    const selected = detail.history.find((item) => item.date === selectedDate);
    if (!selected) throw new Error(`SPU ${spu} 在 ${selectedDate} 没有数据。`);
    return {
      spu,
      imageUrl: detail.imageUrl,
      imageSource: detail.imageSource,
      firstListedAt: detail.firstListedAt,
      selected,
      history: detail.history,
    };
  });

  return { selectedDate, commonDates, products };
}
