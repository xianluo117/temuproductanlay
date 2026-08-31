export function localDateTime(value: string | null | undefined): string {
  if (!value) return "-";

  // SQLite CURRENT_TIMESTAMP 返回 UTC，但没有携带时区标记；补上 Z，避免浏览器把它误当成本地时间。
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("zh-CN");
}
