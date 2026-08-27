import { describe, expect, it } from "vitest";
import {
  calculatePricing,
  parseProductCode,
} from "./product-management-calculator.js";

describe("product management calculator", () => {
  it("parses goods value and serial number while ignoring color and size", () => {
    expect(parseProductCode("Z27-Y268")).toEqual({
      goodsValue: 27,
      internalProductId: "268",
      serialNumber: "268",
    });
    expect(parseProductCode("HB30-GY058-grey-S")).toEqual({
      goodsValue: 30,
      internalProductId: "058",
      serialNumber: "058",
    });
    expect(parseProductCode("INVALID")).toEqual({
      goodsValue: null,
      internalProductId: null,
      serialNumber: null,
    });
  });

  it("uses the initial review minimum as the pricing basis and calculates ROAS", () => {
    const automatic = calculatePricing({
      goodsValue: 30,
      weightKg: 0.5,
      shippingCostPerKg: 10,
      recommendedProfitMargin: 0.55,
      profitThresholdRate: 0.45,
      reviewPrice: 70,
      initialReviewPrice: 80,
      activityDiscountOverride: null,
    });
    expect(automatic.totalCost).toBe(35);
    expect(automatic.recommendedPrice).toBe(77.78);
    expect(automatic.reviewProfitMargin).toBe(0.5625);
    expect(automatic.suggestedActivityDiscount).toBe(0.7);
    expect(automatic.finalActivityDiscount).toBe(0.7);
    expect(automatic.activityPrice).toBe(56);
    expect(automatic.trafficPrice).toBe(62.22);
    expect(automatic.roas).toBe(3.81);

    const overridden = calculatePricing({
      goodsValue: 30,
      weightKg: 0.5,
      shippingCostPerKg: 10,
      recommendedProfitMargin: 0.55,
      profitThresholdRate: 0.45,
      reviewPrice: 70,
      initialReviewPrice: 80,
      activityDiscountOverride: 0.75,
    });
    expect(overridden.reviewProfitMargin).toBe(0.5625);
    expect(overridden.suggestedActivityDiscount).toBe(0.7);
    expect(overridden.finalActivityDiscount).toBe(0.75);
    expect(overridden.activityPrice).toBe(60);
    expect(overridden.trafficPrice).toBe(66.67);
    expect(overridden.roas).toBe(3.2);
  });

  it("falls back to the review price when the initial review minimum is empty", () => {
    const pricing = calculatePricing({
      goodsValue: 30,
      weightKg: 0.5,
      shippingCostPerKg: 10,
      recommendedProfitMargin: 0.55,
      profitThresholdRate: 0.45,
      reviewPrice: 70,
      initialReviewPrice: null,
      activityDiscountOverride: null,
    });
    expect(pricing.reviewProfitMargin).toBe(0.5);
    expect(pricing.suggestedActivityDiscount).toBe(0.8);
    expect(pricing.finalActivityDiscount).toBe(0.8);
    expect(pricing.activityPrice).toBe(56);
    expect(pricing.trafficPrice).toBe(62.22);
    expect(pricing.roas).toBe(3.33);
  });
  it("keeps a manually overridden goods value as the cost basis", () => {
    const pricing = calculatePricing({
      goodsValue: 35,
      weightKg: 0.3,
      shippingCostPerKg: 10,
      recommendedProfitMargin: 0.55,
      profitThresholdRate: 0.45,
      reviewPrice: null,
      initialReviewPrice: null,
      activityDiscountOverride: null,
    });
    expect(pricing.totalCost).toBe(38);
    expect(pricing.profitThresholdPrice).toBe(69.09);
  });
});
