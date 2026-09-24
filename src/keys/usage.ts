/**
 * 每把密钥 24 小时用量的时间窗和换算。纯函数，和取数分开（`data.ts`），好测。
 */
import { bucketStart } from "@/format";
import type { KeyUsage } from "@/types";

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** 小柱图几格：24 个整点小时，加上正在走的这一小时（最后一格） */
export const BARS = 25;

/**
 * 「24 小时」的时间窗：**从 24 小时前的那个整点起**，和概览实时档的「24 小时」
 * （`windowStart`）是同一个窗。差一个小时的话，同一把密钥在概览里和这里是两个数。
 *
 * 起点对齐到本地整点：同一个小时里读几次，格子的边界都不动，一次固定时刻的请求
 * 不会在两格之间来回滑（`bucketStart` 那条理由）。
 */
export function usageWindow(now = Date.now()): { since: number; bucket: number } {
  return { since: bucketStart(now - DAY_MS, HOUR_MS), bucket: HOUR_MS };
}

/** 一把密钥在这个时间窗里的用量 */
export interface KeyUse {
  requests: number;
  /** 微美元 */
  cost: number;
  /** 每格的请求数，旧的在前，补齐成 `BARS` 格 */
  series: number[];
}

/**
 * 按密钥名索引的用量。**这段时间没有请求的密钥不在里面** —— 调用方拿到
 * `undefined` 时要分清是「用量没取到」（整份 `KeyUsage` 缺）还是「确实是零」。
 */
export function usageByKey(u: KeyUsage): Map<string, KeyUse> {
  const out = new Map<string, KeyUse>();
  const entry = (name: string) => {
    let e = out.get(name);
    if (!e) {
      e = { requests: 0, cost: 0, series: new Array<number>(BARS).fill(0) };
      out.set(name, e);
    }
    return e;
  };
  for (const t of u.totals) {
    const e = entry(t.name);
    e.requests = t.requests;
    e.cost = t.cost_micros;
  }
  for (const b of u.buckets) {
    const i = Math.round((b.at_ms - u.since_ms) / u.bucket_ms);
    if (i < 0 || i >= BARS) continue;
    const e = entry(b.name);
    e.series[i] = (e.series[i] ?? 0) + b.requests;
  }
  return out;
}
