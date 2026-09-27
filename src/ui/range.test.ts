import { afterEach, describe, expect, it, vi } from "vitest";
import { densify, MAX_BUCKETS } from "@/format";
import { bucketFor, customRange, presetRange, windowStart } from "./range";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("时间窗的起点", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("自定义区间从选的那一天算起：页面开着多久，起点都不往后挪", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const day = new Date(2026, 8, 8);
    const r = customRange(day);
    expect(windowStart(r)).toBe(day.getTime());
    // 开着过了一天多：标签还是「9/8 至今」，起点也还是 9/8 零点
    vi.setSystemTime(new Date(2026, 8, 21, 17, 0));
    expect(windowStart(r)).toBe(day.getTime());
  });

  it("预设区间跟着现在往前走", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0));
    const r = presetRange("1d");
    const first = windowStart(r);
    vi.setSystemTime(new Date(2026, 8, 20, 12, 0));
    expect(windowStart(r)).toBe(first + 2 * 3_600_000);
  });
});

/**
 * 一格多宽。
 *
 * 三个预设的格子不变；**自定义区间可以很长**，一路往上要有更宽的格子，不然格数顶到
 * `densify` 的上限，最近的那一段被截掉，图的右边却照样写着「现在」。
 */
describe("一格多宽", () => {
  it("三个预设照旧", () => {
    expect(bucketFor(DAY)).toBe(HOUR / 2);
    expect(bucketFor(7 * DAY)).toBe(2 * HOUR);
    expect(bucketFor(30 * DAY)).toBe(6 * HOUR);
  });

  it("更长的自定义区间按天、按周分格", () => {
    expect(bucketFor(31 * DAY)).toBe(DAY);
    expect(bucketFor(120 * DAY)).toBe(DAY);
    expect(bucketFor(121 * DAY)).toBe(7 * DAY);
    expect(bucketFor(3 * 365 * DAY)).toBe(7 * DAY);
  });

  /** 设计上压在 120 格上下；一周一格要到九年半才顶到上限 */
  it("格数不超过上限", () => {
    for (let days = 1; days <= 9 * 365; days += 1) {
      const n = Math.ceil((days * DAY) / bucketFor(days * DAY));
      expect(n, `${days} 天`).toBeLessThanOrEqual(days <= 120 ? 120 : MAX_BUCKETS);
    }
  });

  /**
   * 这就是要修的那件事：从半年前的某一天到现在，趋势图要一直画到现在 —— 原来按六小时
   * 分格是七百多格，截在第五百格上，最近的两个月不见了。
   */
  it("半年前到现在：最近的那一格在图上", () => {
    const now = new Date(2026, 8, 25, 16, 42).getTime();
    const from = new Date(2026, 2, 1);
    const range = { ...customRange(from), ms: now - from.getTime() };
    const bucket = bucketFor(range.ms);
    const since = windowStart(range, now);
    // core 按 `since + k × bucket` 分格：此刻所在的那一格
    const k = Math.floor((now - since) / bucket);
    const out = densify(
      [
        {
          at_ms: since + k * bucket,
          requests: 3,
          failed: 0,
          cost_micros_exact: 0,
          cost_micros_estimated: 0,
          unpriced_requests: 0,
          no_usage_requests: 0,
        },
      ],
      since,
      now,
      bucket,
    );
    expect(out.at(-1)?.requests).toBe(3);
    expect(out[0]?.at_ms).toBe(since);
  });

  /** 按天、按周的格子从那一天的本地零点数起，不往前挪到周一 */
  it("一周一格从起始那一天的零点数起", () => {
    const now = new Date(2026, 8, 25, 16, 42).getTime();
    // 2025-11-12 是周三
    const from = new Date(2025, 10, 12);
    const range = { ...customRange(from), ms: now - from.getTime() };
    expect(bucketFor(range.ms)).toBe(7 * DAY);
    expect(windowStart(range, now)).toBe(from.getTime());
  });
});
