import type { Range } from "@/ui/range";

/**
 * 最近一年：一天一格的热力图，固定一年，不跟时间范围走；所选时间范围在格子上描边。
 *
 * 占位：等这一块换上。
 */
export function Year(_: {
  range: Range;
  /** 库里多了请求、手动刷新：重取 */
  tick: number;
  /** 点了某一天：时间范围切到那一天 */
  onPickDay: (day: Date) => void;
}) {
  return null;
}
