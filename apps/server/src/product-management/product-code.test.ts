import { describe, expect, it } from "vitest";
import {
  lifecycleProductCodeKey,
  productCodeMatchesLifecycle,
  splitSearchKeywords,
  truncateLifecycleProductCode,
} from "./product-code.js";

describe("product code normalization", () => {
  it("truncates lifecycle product codes after the second segment", () => {
    expect(truncateLifecycleProductCode("DY-189-green")).toBe("DY-189");
    expect(truncateLifecycleProductCode("Z38-Y22-junlv")).toBe("Z38-Y22");
    expect(truncateLifecycleProductCode("DY-189")).toBe("DY-189");
    expect(truncateLifecycleProductCode("SINGLE")).toBe("SINGLE");
  });

  it("rejects empty or malformed lifecycle product codes", () => {
    expect(truncateLifecycleProductCode(null)).toBeNull();
    expect(truncateLifecycleProductCode("-")).toBeNull();
    expect(truncateLifecycleProductCode("DY--green")).toBeNull();
  });

  it("matches manual full product codes with truncated lifecycle codes", () => {
    expect(productCodeMatchesLifecycle("DY-189-green-S", "DY-189-green")).toBe(
      true,
    );
    expect(productCodeMatchesLifecycle("z38-y22", "Z38-Y22-junlv")).toBe(
      true,
    );
    expect(productCodeMatchesLifecycle("DY-190", "DY-189-green")).toBe(false);
    expect(lifecycleProductCodeKey(" dy - 189 - green ")).toBe("DY-189");
  });

  it("splits multiple search keywords by arbitrary whitespace", () => {
    expect(splitSearchKeywords(" 7074816364\t8000000000  ")).toEqual([
      "7074816364",
      "8000000000",
    ]);
    expect(splitSearchKeywords(undefined)).toEqual([]);
  });
});
