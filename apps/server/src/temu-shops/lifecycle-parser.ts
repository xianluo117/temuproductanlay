function numericValue(
  item: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = item[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (Number.isFinite(value) && value >= 0) return value;
      continue;
    }
    const text = String(value).trim();
    if (!text) continue;
    const number = Number(text.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function moneyValue(value: unknown, minorUnit: boolean): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    return minorUnit ? value / 100 : value;
  }
  const text = String(value).trim();
  if (!text) return null;
  const number = Number(text.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(number) || number < 0) return null;
  // API 的 *PriceValue、targetSupplyPrice 和
  // suggestActivitySupplierPrice 使用分为单位；带小数的文本通常已经是元。
  return minorUnit && /^-?\d+$/.test(text) ? number / 100 : number;
}

function moneyFieldValue(
  item: Record<string, unknown>,
  keys: string[],
  minorUnitKeys: string[] = [],
): number | null {
  for (const key of keys) {
    const value = moneyValue(item[key], minorUnitKeys.includes(key));
    if (value !== null) return value;
  }
  return null;
}

function moneyFieldValues(
  item: Record<string, unknown>,
  keys: string[],
  minorUnitKeys: string[] = [],
): number[] {
  return keys.flatMap((key) => {
    const value = moneyValue(item[key], minorUnitKeys.includes(key));
    return value === null ? [] : [value];
  });
}

function minimumNumeric(values: Array<number | null>): number | null {
  const valid = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  return valid.length ? Math.min(...valid) : null;
}

function nestedNumericValues(
  item: Record<string, unknown>,
  arrayKeys: string[],
  valueKeys: string[],
): number[] {
  const result: number[] = [];
  for (const arrayKey of arrayKeys) {
    const values = item[arrayKey];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const parsed = numericValue(value as Record<string, unknown>, valueKeys);
      if (parsed !== null) result.push(parsed);
    }
  }
  return result;
}

function nestedMoneyValues(
  item: Record<string, unknown>,
  arrayKeys: string[],
  valueKeys: string[],
  minorUnitKeys: string[] = [],
): number[] {
  const result: number[] = [];
  for (const arrayKey of arrayKeys) {
    const values = item[arrayKey];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      result.push(
        ...moneyFieldValues(
          value as Record<string, unknown>,
          valueKeys,
          minorUnitKeys,
        ),
      );
    }
  }
  return result;
}

export function lifecycleSupplierPrice(
  item: Record<string, unknown>,
): number | null {
  return minimumNumeric([
    moneyFieldValue(
      item,
      ["lowestSupplierPrice", "supplierPriceValue", "supplierPrice"],
      ["supplierPriceValue"],
    ),
    ...nestedMoneyValues(
      item,
      ["siteSupplierPriceList"],
      ["lowestSupplierPrice", "supplierPriceValue", "supplierPrice"],
      ["supplierPriceValue"],
    ),
  ]);
}

export function lifecycleSuggestedPrice(
  item: Record<string, unknown>,
): number | null {
  return minimumNumeric([
    ...moneyFieldValues(item, ["suggestedPrice", "trafficLimitPrice", "limitPrice"]),
    ...moneyFieldValues(
      item,
      ["suggestActivitySupplierPrice", "targetSupplyPrice"],
      ["suggestActivitySupplierPrice", "targetSupplyPrice"],
    ),
    ...nestedMoneyValues(
      item,
      ["siteSupplierPriceList"],
      ["suggestActivitySupplierPrice", "targetSupplyPrice"],
      ["suggestActivitySupplierPrice", "targetSupplyPrice"],
    ),
    ...nestedMoneyValues(
      item,
      ["priceAdjustmentList", "adjustmentList", "limitPriceList"],
      ["suggestedPrice", "trafficLimitPrice", "limitPrice"],
    ),
  ]);
}

export function minimumLifecyclePrice(
  values: Array<number | null>,
): number | null {
  return minimumNumeric(values);
}
