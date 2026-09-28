import { describe, expect, it } from "vitest";
import { nextStart } from "./useNow";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("下一段从哪一刻起", () => {
  it("一小时往后数一小时", () => {
    const start = new Date(2026, 8, 28, 9).getTime();
    expect(nextStart(start, HOUR)).toBe(start + HOUR);
  });

  /**
   * 夏令时开始、结束的那两天是 23、25 个小时：往后数的是日历上的一天，不是 24 小时。
   * 按跑测试那台机器的时区算 —— 在美国、欧洲的时区里，前四个日子正好碰上拨表
   */
  it("一天往后数到下一个本地零点，拨表的那天也是", () => {
    const days: [number, number, number][] = [
      [2026, 2, 8],
      [2026, 2, 29],
      [2026, 9, 25],
      [2026, 10, 1],
      [2026, 8, 28],
    ];
    for (const [y, m, d] of days) {
      expect(nextStart(new Date(y, m, d).getTime(), DAY)).toBe(new Date(y, m, d + 1).getTime());
    }
  });
});
