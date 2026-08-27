export function cleanProductCode(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").trim();
}

export function normalizeProductCode(value: string | null | undefined): string {
  return cleanProductCode(value).toUpperCase();
}

/**
 * 生命周期货号只使用前两段作为展示、自动建档和匹配键。
 * 原始完整货号仍保留在生命周期快照和原始响应中。
 */
export function truncateLifecycleProductCode(
  value: string | null | undefined,
): string | null {
  const cleaned = cleanProductCode(value);
  if (!cleaned || cleaned === "-") return null;
  const segments = cleaned.split("-").map((segment) => segment.trim());
  if (!segments[0] || (segments.length >= 2 && !segments[1])) return null;
  return segments.length >= 2 ? segments.slice(0, 2).join("-") : segments[0];
}

export function lifecycleProductCodeKey(
  value: string | null | undefined,
): string {
  return normalizeProductCode(truncateLifecycleProductCode(value));
}

export function productCodeMatchesLifecycle(
  productCode: string | null | undefined,
  lifecycleCode: string | null | undefined,
): boolean {
  const productKey = normalizeProductCode(productCode);
  const lifecycleKey = lifecycleProductCodeKey(lifecycleCode);
  if (!productKey || !lifecycleKey) return false;
  return (
    productKey === lifecycleKey ||
    lifecycleProductCodeKey(productCode) === lifecycleKey
  );
}

export function splitSearchKeywords(value: string | undefined): string[] {
  return (value ?? "")
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export interface ProductManagementSearch {
  spu?: string;
  skc?: string;
  sku?: string;
  productCode?: string;
}

export function normalizedSearchKeywords(value: string | undefined): string[] {
  return splitSearchKeywords(value).map(normalizeProductCode);
}

export function truncatedSearchKeywords(value: string | undefined): string[] {
  return splitSearchKeywords(value)
    .map(lifecycleProductCodeKey)
    .filter(Boolean);
}

export function lifecycleCodeSqlExpression(column: string): string {
  const normalized = `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${column}, ''), ' ', ''), char(9), ''), char(10), ''))`;
  return `CASE
    WHEN instr(${normalized}, '-') = 0 THEN ${normalized}
    WHEN instr(substr(${normalized}, instr(${normalized}, '-') + 1), '-') = 0
      THEN ${normalized}
    ELSE substr(
      ${normalized},
      1,
      instr(${normalized}, '-') + instr(substr(${normalized}, instr(${normalized}, '-') + 1), '-') - 1
    )
  END`;
}
