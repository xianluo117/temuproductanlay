export const fixedOrderSizes = ["S", "M", "L", "XL", "XXL"] as const;

export function normalizeOrderSize(value: string): string {
  return value.trim().toUpperCase();
}

export function orderSizes(sizes: string[]): string[] {
  const uniqueSizes = [...new Set(sizes.map(normalizeOrderSize).filter(Boolean))];
  return [
    ...fixedOrderSizes,
    ...uniqueSizes
      .filter((size) => !fixedOrderSizes.includes(size as (typeof fixedOrderSizes)[number]))
      .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true })),
  ];
}
