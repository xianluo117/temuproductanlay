import { describe, expect, it } from "vitest";
import {
  lifecycleSuggestedPrice,
  lifecycleSupplierPrice,
  minimumLifecyclePrice,
} from "./lifecycle-parser.js";

describe("lifecycle price parser", () => {
  it("reads direct supplier price fields", () => {
    expect(lifecycleSupplierPrice({ lowestSupplierPrice: 35 })).toBe(35);
    expect(lifecycleSupplierPrice({ supplierPriceValue: "36.50" })).toBe(36.5);
    expect(lifecycleSupplierPrice({ supplierPrice: "¥37.20" })).toBe(37.2);
  });

  it("takes the minimum across direct and nested supplier prices", () => {
    expect(
      lifecycleSupplierPrice({
        supplierPrice: 40,
        siteSupplierPriceList: [
          { supplierPriceValue: 3800 },
          { lowestSupplierPrice: 32 },
          { supplierPrice: "35.5" },
        ],
      }),
    ).toBe(32);
  });

  it("reads explicit limit or adjustment price fields", () => {
    expect(lifecycleSuggestedPrice({ suggestedPrice: 74.95 })).toBe(74.95);
    expect(lifecycleSuggestedPrice({ trafficLimitPrice: "72.50" })).toBe(72.5);
    expect(lifecycleSuggestedPrice({ limitPrice: 70 })).toBe(70);
    expect(
      lifecycleSuggestedPrice({
        siteSupplierPriceList: [
          { suggestActivitySupplierPrice: 4100, targetSupplyPrice: 373 },
        ],
      }),
    ).toBe(3.73);
    expect(
      lifecycleSuggestedPrice({
        siteSupplierPriceList: [{ targetSupplyPrice: 4100 }],
      }),
    ).toBe(41);
    expect(
      lifecycleSuggestedPrice({
        siteSupplierPriceList: [
          { suggestActivitySupplierPrice: 4100, targetSupplyPrice: 3730 },
          { suggestActivitySupplierPrice: 3900, targetSupplyPrice: 3900 },
        ],
      }),
    ).toBe(37.3);
    expect(
      lifecycleSuggestedPrice({
        priceAdjustmentList: [
          { suggestedPrice: 76 },
          { trafficLimitPrice: 68 },
        ],
      }),
    ).toBe(68);
  });

  it("never falls back from limit price to supplier price", () => {
    expect(
      lifecycleSuggestedPrice({
        lowestSupplierPrice: 35,
        supplierPriceValue: 3600,
        supplierPrice: 37,
        siteSupplierPriceList: [{ supplierPrice: 32 }],
      }),
    ).toBeNull();
  });

  it("ignores invalid values and keeps missing values null", () => {
    expect(lifecycleSupplierPrice({ supplierPrice: -1 })).toBeNull();
    expect(lifecycleSuggestedPrice({ suggestedPrice: "" })).toBeNull();
    expect(minimumLifecyclePrice([null, 8, 3, -1])).toBe(3);
    expect(minimumLifecyclePrice([null])).toBeNull();
  });
});
