export interface ParsedProductCode {
  goodsValue: number | null;
  internalProductId: string | null;
}

export interface PricingCalculation {
  totalCost: number | null;
  recommendedPrice: number | null;
  reviewProfitMargin: number | null;
  suggestedActivityDiscount: number | null;
  finalActivityDiscount: number | null;
  activityPrice: number | null;
  trafficPrice: number | null;
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
  };
}

export function calculatePricing(input: {
  goodsValue: number | null;
  weightKg: number;
  shippingCostPerKg: number;
  recommendedProfitMargin: number;
  reviewPrice: number | null;
  initialReviewPrice: number | null;
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
  const reviewProfitMargin =
    totalCost === null || input.reviewPrice === null || input.reviewPrice <= 0
      ? null
      : (input.reviewPrice - totalCost) / input.reviewPrice;
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
    input.initialReviewPrice === null || finalActivityDiscount === null
      ? null
      : rounded(input.initialReviewPrice * finalActivityDiscount);
  const trafficPrice =
    activityPrice === null ? null : rounded(activityPrice / 0.9);
  return {
    totalCost,
    recommendedPrice,
    reviewProfitMargin,
    suggestedActivityDiscount,
    finalActivityDiscount,
    activityPrice,
    trafficPrice,
  };
}
