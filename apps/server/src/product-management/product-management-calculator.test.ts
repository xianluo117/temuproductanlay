import { describe, expect, it } from "vitest";
import {
  calculatePricing,
  parseProductCode,
} from "./product-management-calculator.js";

describe("product management calculator", () => {
  it("parses goods value and internal id while ignoring color and size", () => {
    expect(parseProductCode("Z27-Y268")).toEqual({
      goodsValue: 27,
      internalProductId: "268",
    });
    expect(parseProductCode("HB30-GY058-grey-S")).toEqual({
      goodsValue: 30,
      internalProductId: "058",
    });
  });

  it("calculates suggested and overridden activity pricing", () => {
    const automatic = calculatePricing({
      goodsValue: 30,
      weightKg: 0.5,
      shippingCostPerKg: 10,
      recommendedProfitMargin: 0.55,
      reviewPrice: 70,
      initialReviewPrice: 80,
      activityDiscountOverride: null,
    });
    expect(automatic.totalCost).toBe(35);
    expect(automatic.recommendedPrice).toBe(77.78);
    expect(automatic.reviewProfitMargin).toBe(0.5);
    expect(automatic.suggestedActivityDiscount).toBe(0.8);
    expect(automatic.activityPrice).toBe(64);
    expect(automatic.trafficPrice).toBe(71.11);

    const overridden = calculatePricing({
      goodsValue: 30,
      weightKg: 0.5,
      shippingCostPerKg: 10,
      recommendedProfitMargin: 0.55,
      reviewPrice: 70,
      initialReviewPrice: 80,
      activityDiscountOverride: 0.75,
    });
    expect(overridden.suggestedActivityDiscount).toBe(0.8);
    expect(overridden.finalActivityDiscount).toBe(0.75);
    expect(overridden.activityPrice).toBe(60);
  });
});
