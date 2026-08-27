export interface ParsedProductCode {
  goodsValue: number | null;
  internalProductId: string | null;
  serialNumber: string | null;
}

export interface PricingCalculation {
  totalCost: number | null;
  recommendedPrice: number | null;
  profitThresholdPrice: number | null;
  reviewProfitMargin: number | null;
  suggestedActivityDiscount: number | null;
  finalActivityDiscount: number | null;
  activityPrice: number | null;
  trafficPrice: number | null;
  roas: number | null;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseProductCode(productCode: string): ParsedProductCode {
  const segments = productCode.trim().split("-");
  const goodsValueMatch = segments[0]?.match(/(\d+(?:\.\d+)?)$/);
  const internalIdMatch = segments[1]?.match(/(\d+)/);
  return {
    goodsValue: goodsValueMatch ? Number(goodsValueMatch[1]) : null,
    internalProductId: internalIdMatch?.[1] ?? null,
    serialNumber: internalIdMatch?.[1] ?? null,
  };
}

export function calculatePricing(input: {
  goodsValue: number | null;
  weightKg: number;
  shippingCostPerKg: number;
  recommendedProfitMargin: number;
  profitThresholdRate: number;
  /** 核价价；初次核价最低价为空时作为回退基准。 */
  reviewPrice: number | null;
  /** 初次核价最低价；存在时优先作为全部派生价格的计算基准。 */
  initialReviewPrice: number | null;
  /** 人工最终折扣；为空时使用系统建议折扣。 */
  activityDiscountOverride: number | null;
}): PricingCalculation {
  const totalCost =
    input.goodsValue === null
      ? null
      : rounded(input.goodsValue + input.weightKg * input.shippingCostPerKg);
  const recommendedPrice =
    totalCost === null || input.recommendedProfitMargin >= 1
      ? null
      : rounded(totalCost / (1 - input.recommendedProfitMargin));
  const profitThresholdPrice =
    totalCost === null || input.profitThresholdRate >= 1
      ? null
      : rounded(totalCost / (1 - input.profitThresholdRate));
  const effectiveReviewPrice =
    input.initialReviewPrice ?? input.reviewPrice;
  const reviewProfitMargin =
    totalCost === null ||
    effectiveReviewPrice === null ||
    effectiveReviewPrice <= 0
      ? null
      : (effectiveReviewPrice - totalCost) / effectiveReviewPrice;
  const suggestedActivityDiscount =
    reviewProfitMargin === null
      ? null
      : reviewProfitMargin <= 0.5
        ? 0.8
        : reviewProfitMargin <= 0.65
          ? 0.7
          : 0.6;
  const finalActivityDiscount =
    input.activityDiscountOverride ?? suggestedActivityDiscount;
  const activityPrice =
    effectiveReviewPrice === null || finalActivityDiscount === null
      ? null
      : rounded(effectiveReviewPrice * finalActivityDiscount);
  const trafficPrice =
    activityPrice === null ? null : rounded(activityPrice / 0.9);
  // ROAS = 1 /（核价利润率 - 1 + 活动折扣）。
  const roasDenominator =
    reviewProfitMargin === null || finalActivityDiscount === null
      ? null
      : reviewProfitMargin - 1 + finalActivityDiscount;
  const roas =
    roasDenominator === null ||
    !Number.isFinite(roasDenominator) ||
    roasDenominator === 0
      ? null
      : rounded(1 / roasDenominator);
  return {
    totalCost,
    recommendedPrice,
    profitThresholdPrice,
    reviewProfitMargin,
    suggestedActivityDiscount,
    finalActivityDiscount,
    activityPrice,
    trafficPrice,
    roas,
  };
}
