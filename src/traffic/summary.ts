import type { RequestRow } from "@/types";

/**
 * 流量页页头那一行：一共几条、几条失败、几条在跑，和近 30 分钟每分钟几条。
 *
 * **全部从列表里的行数出来，不另外问 core。**页头说的就是下面这张表：点「N 条
 * 失败」筛出来的正好是那 N 条。
 *
 * 纯函数，因为「窗口从哪一分钟算起」「列表装满了之后近 30 分钟还全不全」要能
 * 被测。
 */

const MIN = 60_000;
/** 小图画多少分钟，一分钟一格 */
export const WINDOW_MIN = 30;

/** 小图里的一格：一分钟 */
export interface Bar {
  /** 这一分钟从哪一刻开始 */
  at: number;
  n: number;
  failed: number;
}

export interface TrafficSummary {
  /** 列表里一共几条 */
  total: number;
  failed: number;
  inFlight: number;
  /** 近 30 分钟开始的请求 */
  recent: number;
  recentFailed: number;
  /** 最老的在前，最后一格是正在走的这一分钟 */
  bars: Bar[];
  /**
   * 近 30 分钟的数是不是全的。列表装满了（`limit` 条），而最老的一条还在窗口
   * 里的话，更早被挤出去的那些也可能在窗口里 —— 那时这个数只是下限。
   */
  complete: boolean;
}

/**
 * `now`：现在。窗口的右边是**这一分钟的结尾**，不是此刻 —— 按分钟对齐，一条请求
 * 从头到尾落在同一格里，每次重算不会在两格之间跳。
 *
 * `limit`：列表最多装几条（`LIST_LIMIT`）。
 */
export function summarize(rows: readonly RequestRow[], now: number, limit: number): TrafficSummary {
  const end = Math.floor(now / MIN) * MIN + MIN;
  const from = end - WINDOW_MIN * MIN;
  const bars: Bar[] = Array.from({ length: WINDOW_MIN }, (_, i) => ({ at: from + i * MIN, n: 0, failed: 0 }));
  let failed = 0;
  let inFlight = 0;
  let oldest = Infinity;
  for (const r of rows) {
    if (r.state === "failed") failed += 1;
    else if (r.state === "in_flight") inFlight += 1;
    if (r.atMs < oldest) oldest = r.atMs;
    if (r.atMs < from || r.atMs >= end) continue;
    const b = bars[Math.floor((r.atMs - from) / MIN)];
    if (!b) continue;
    b.n += 1;
    if (r.state === "failed") b.failed += 1;
  }
  let recent = 0;
  let recentFailed = 0;
  for (const b of bars) {
    recent += b.n;
    recentFailed += b.failed;
  }
  return {
    total: rows.length,
    failed,
    inFlight,
    recent,
    recentFailed,
    bars,
    complete: rows.length < limit || oldest < from,
  };
}
