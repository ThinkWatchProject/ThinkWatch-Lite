import { afterEach, describe, expect, it, vi } from "vitest";
import { customRange, presetRange, windowStart } from "./range";

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
