import { describe, expect, it } from "vitest";
import type { CostBucket } from "@/types";
import {
  WEEKS,
  byDay,
  gridStart,
  layout,
  levelOf,
  monthLabels,
  overlaps,
  statsOf,
  step,
  streakOf,
  thresholds,
  type Day,
} from "./yearGrid";

// 2026-10-28 是周三
const NOW = new Date(2026, 9, 28, 15, 30).getTime();
const day = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime();

function bucket(at: number, p: Partial<CostBucket> = {}): CostBucket {
  return {
    at_ms: at,
    requests: 1,
    failed: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    sent_bytes: 0,
    received_bytes: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ttft_p50_ms: null,
    ttft_p95_ms: null,
    ttft_samples: 0,
    ...p,
  };
}

const find = (days: Day[], at: number) => days.find((d) => d.at === at)!;

describe("网格", () => {
  it("从 52 周前的周一起，最右一列是本周", () => {
    expect(gridStart(NOW)).toBe(day(2025, 9, 27));
    expect(new Date(gridStart(NOW)).getDay()).toBe(1);
    const days = layout(NOW, { since_ms: 0, detail_since_ms: null, buckets: [] });
    expect(days).toHaveLength(WEEKS * 7);
    const today = find(days, day(2026, 9, 28));
    expect(today).toMatchObject({ col: WEEKS - 1, row: 2, state: "none" });
    // 今天之后不画；一年之前（第一列的周一、周二）不画；一年前的今天的第二天是第一天
    expect(find(days, day(2026, 9, 29)).state).toBe("future");
    expect(find(days, day(2025, 9, 28)).state).toBe("outside");
    expect(find(days, day(2025, 9, 29)).state).toBe("none");
  });

  it("每一格是本地零点，按日历往后数", () => {
    const days = layout(NOW, null);
    for (const d of days) {
      const t = new Date(d.at);
      expect([t.getHours(), t.getMinutes()]).toEqual([0, 0]);
      expect(new Date(d.end).getDate()).toBe(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getDate());
    }
  });

  it("开始记录之前是「未记录」；记录从当天中途起，那一天算记着", () => {
    const since = day(2026, 8, 18, 14);
    const days = layout(NOW, { since_ms: since, detail_since_ms: null, buckets: [] });
    expect(find(days, day(2026, 8, 17)).state).toBe("unrecorded");
    expect(find(days, day(2026, 8, 18)).state).toBe("none");
    expect(find(days, day(2026, 8, 19)).state).toBe("none");
    // 从没记过：都是未记录
    expect(layout(NOW, { since_ms: null, detail_since_ms: null, buckets: [] }).filter((d) => d.state === "none")).toHaveLength(0);
  });

  it("月份写在那个月第一个周一的那一列；第一列太靠月底的不写", () => {
    const m = monthLabels(layout(NOW, null));
    expect(m[0]).toBeNull(); // 10 月 27 日
    expect(m[1]).toBe(10); // 11 月 3 日
    expect(m.filter((x) => x !== null)).toHaveLength(12);
    expect(m[WEEKS - 1]).toBeNull(); // 10 月 26 日：10 月从 10 月 5 日那一列起就写过了
  });
});

describe("按本地日期合计", () => {
  it("拿起点往后 12 小时落在哪一天：夏令时挪了一小时的格子不错位", () => {
    const m = byDay([
      // 格子起点落在前一天的 23 点（夏令时之后的那种），算第二天的
      bucket(day(2026, 2, 8, 23), { input_tokens: 10, cache_write_tokens: 5, output_tokens: 3, cache_read_tokens: 2 }),
      bucket(day(2026, 2, 9, 1), { requests: 2, cost_micros_exact: 100, cost_micros_estimated: 50, unpriced_requests: 1 }),
    ]);
    expect(m.size).toBe(1);
    expect([...m.values()][0]).toMatchObject({
      requests: 3,
      input: 15,
      output: 3,
      cacheRead: 2,
      tokens: 20,
      cost: 150,
      estimated: 50,
      unpriced: 1,
    });
  });
});

describe("分级", () => {
  it("按有用量的日子切四分位，0 是没有用量", () => {
    const th = thresholds([0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(th).toEqual([3, 5, 7]);
    expect([0, 1, 3, 4, 5, 6, 7, 8].map((v) => levelOf(v, th))).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(thresholds([])).toEqual([0, 0, 0]);
  });
});

describe("统计", () => {
  const used = (y: number, m: number, d: number, p: Partial<CostBucket>) => bucket(day(y, m, d), p);
  const history = {
    since_ms: day(2026, 9, 1),
    detail_since_ms: null,
    buckets: [
      used(2026, 8, 30, { input_tokens: 999 }), // 记录之前：不算
      used(2026, 9, 1, { input_tokens: 100 }),
      used(2026, 9, 2, { input_tokens: 300 }),
      used(2026, 9, 3, { input_tokens: 300 }),
      // 10 月 4 日没用
      used(2026, 9, 25, { input_tokens: 10 }),
      used(2026, 9, 26, { input_tokens: 10 }),
      used(2026, 9, 27, { input_tokens: 10, cost_micros_estimated: 7 }),
      // 今天还没用
    ],
  };
  const days = layout(NOW, history);

  it("合计、日均（不含没有用量的日子）、最多的一天", () => {
    const s = statsOf(days, "tokens");
    expect(s.total).toBe(730);
    expect(s.usedDays).toBe(6);
    expect(s.average).toBeCloseTo(730 / 6);
    // 并列取早的
    expect(s.peak?.at).toBe(day(2026, 9, 2));
    expect(s.estimated).toBe(7);
  });

  it("连续使用到今天为止，今天还没用的话从昨天数起；最长的一段", () => {
    const s = statsOf(days, "tokens");
    expect(s.streak).toBe(3);
    expect(s.longest).toBe(3);
    const rec = days.filter((d) => d.state === "used" || d.state === "none");
    // 最后两天都没用：断了
    expect(streakOf(rec.filter((d) => d.at <= day(2026, 9, 5)))).toBe(0);
  });

  it("一天都没有", () => {
    const s = statsOf(layout(NOW, { since_ms: 0, detail_since_ms: null, buckets: [] }), "cost");
    expect(s).toMatchObject({ total: 0, usedDays: 0, average: null, peak: null, streak: 0, longest: 0 });
  });
});

describe("所选时间范围与键盘", () => {
  const days = layout(NOW, { since_ms: 0, detail_since_ms: null, buckets: [] });
  const idx = (at: number) => days.findIndex((d) => d.at === at);

  it("和区间有交集的日子", () => {
    const d = find(days, day(2026, 9, 27));
    expect(overlaps(d, day(2026, 9, 27, 12), NOW)).toBe(true);
    expect(overlaps(d, day(2026, 9, 28), NOW)).toBe(false);
  });

  it("左右一周、上下一天，走不到的地方停在原地", () => {
    const today = idx(day(2026, 9, 28));
    expect(step(days, today, "ArrowLeft")).toBe(idx(day(2026, 9, 21)));
    expect(step(days, today, "ArrowUp")).toBe(idx(day(2026, 9, 27)));
    expect(step(days, today, "ArrowRight")).toBe(today);
    expect(step(days, today, "ArrowDown")).toBe(today); // 明天不画
    const monday = idx(day(2026, 9, 26));
    expect(step(days, monday, "ArrowUp")).toBe(monday);
    expect(step(days, today, "Home")).toBe(idx(day(2025, 9, 29)));
    expect(step(days, 2, "End")).toBe(today);
  });
});
