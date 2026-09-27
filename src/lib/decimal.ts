/**
 * 用户在输入框里打的小数。**小数点写成逗号也认。**
 *
 * 用逗号作小数点的地区（德语、法语、俄语……）打的是 `0,5`：`Number("0,5")` 是 NaN，
 * 价格输入框于是什么都不接；`parseFloat("1,5")` 是 1，试算悄悄按 1 算了。
 *
 * 规则：**没有点、只有一个逗号时，逗号就是小数点**。别的带逗号的写法（`1,000.5`、
 * `1,2,3`）不猜是千分位还是小数点，当成认不出。认不出、空着都是 null，由调用方决定
 * 当成什么。
 */
export function parseDecimal(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const commas = s.split(",").length - 1;
  const normalized = commas === 1 && !s.includes(".") ? s.replace(",", ".") : s;
  if (normalized.includes(",")) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
