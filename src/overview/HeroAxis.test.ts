import { describe, expect, it } from "vitest";
import { byteUnit, niceTop, slotPhase, xTicks, yTicks } from "./HeroAxis";
import { liveSeries, type Grid } from "./series";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const opts = (now: number) => ({ today: "今天", now });

describe("纵轴的刻度", () => {
  it("四格，每格是 1 / 2 / 2.5 / 5 乘 10 的幂，顶上留一点空", () => {
    expect(niceTop(100)).toBe(200); // 一格 26 → 50
    expect(niceTop(96)).toBe(100); // 一格 24.96 → 25
    expect(niceTop(7_600)).toBe(8_000); // 一格 1976 → 2000
    expect(niceTop(9_000)).toBe(10_000); // 一格 2340 → 2500
    expect(niceTop(0.9)).toBe(1); // 一格 0.234 → 0.25
    expect(yTicks(niceTop(0.9))).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it("刚好顶到一档时也留出空：最高的柱子不贴着最上面那条线", () => {
    expect(niceTop(400)).toBe(800);
  });

  it("个数：每格是整数，没有 2.5 次；只有一两次时纵轴是 0–4", () => {
    expect(niceTop(1, { integer: true })).toBe(4);
    expect(niceTop(9, { integer: true })).toBe(20); // 2.5 跳过，取 5
    expect(niceTop(9)).toBe(10);
    expect(niceTop(0, { integer: true })).toBe(4);
    expect(yTicks(niceTop(3, { integer: true }))).toEqual([0, 1, 2, 3, 4]);
  });

  it("全是零：最小的一档，不是 NaN", () => {
    expect(niceTop(0)).toBe(1);
    expect(niceTop(Number.NaN)).toBe(1);
  });

  it("字节按 1024 进位取整：刻度是整齐的 KB、MB", () => {
    const max = 300 * 1024 * 1024;
    const { unit, level } = byteUnit(max);
    expect(level).toBe(2);
    expect(niceTop(max, { unit })).toBe(400 * 1024 * 1024);
    expect(byteUnit(800)).toEqual({ unit: 1, level: 0 });
    expect(byteUnit(1024)).toEqual({ unit: 1024, level: 1 });
  });

  it("浮点误差抹掉", () => {
    expect(yTicks(0.4)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });
});

describe("哪一格还在进行", () => {
  const since = new Date(2026, 9, 27).getTime();
  const g: Grid = { at: Array.from({ length: 24 }, (_, i) => since + i * HOUR), step: HOUR, kind: "bucket" };

  it("包着此刻的那一格在进行；之前的过去了，之后的还没到（「某一天」选的是今天）", () => {
    const now = since + 9 * HOUR + 20 * MINUTE;
    expect(slotPhase(g, 8, now)).toBe("past");
    expect(slotPhase(g, 9, now)).toBe("ongoing");
    expect(slotPhase(g, 10, now)).toBe("future");
  });

  it("画到现在的图：最右一格就是进行中的那一格", () => {
    const now = since + 23 * HOUR + 1;
    expect(slotPhase(g, 23, now)).toBe("ongoing");
  });

  it("过去的某一天：没有进行中的", () => {
    const now = since + 3 * DAY;
    expect(g.at.map((_, i) => slotPhase(g, i, now)).every((p) => p === "past")).toBe(true);
  });

  it("实时档的格子是一个个时刻，没有进行中", () => {
    const live = liveSeries([], [], 10_000_000, 10 * MINUTE).grid;
    expect(slotPhase(live, live.at.length - 1, 10_000_000)).toBe("past");
  });
});

describe("横轴的标签", () => {
  it("24 小时：每 6 小时一个整点，跨过的零点写日期", () => {
    const since = new Date(2026, 9, 27, 15).getTime();
    const now = since + 24 * HOUR - 10 * MINUTE;
    const g: Grid = { at: Array.from({ length: 24 }, (_, i) => since + i * HOUR), step: HOUR, kind: "bucket" };
    const ticks = xTicks(g, 6, opts(now));
    expect(ticks.map((x) => x.label)).toEqual(["18:00", "今天", "06:00", "12:00"]);
    // 标签写在那一格的起点上
    expect(ticks[0]?.f).toBeCloseTo(3 / 24);
  });

  it("地方宽就标得密：每 3 小时一个", () => {
    const since = new Date(2026, 9, 27, 15).getTime();
    const g: Grid = { at: Array.from({ length: 24 }, (_, i) => since + i * HOUR), step: HOUR, kind: "bucket" };
    expect(xTicks(g, 9, opts(since + DAY)).map((x) => x.label)).toHaveLength(8);
  });

  it("「某一天」：第一格就是那一天，写日期", () => {
    const day = new Date(2026, 9, 20).getTime();
    const g: Grid = { at: Array.from({ length: 24 }, (_, i) => day + i * HOUR), step: HOUR, kind: "bucket" };
    const ticks = xTicks(g, 6, opts(day + 8 * DAY));
    expect(ticks[0]).toEqual({ f: 0, label: "10-20" });
    expect(ticks.map((x) => x.label)).toEqual(["10-20", "06:00", "12:00", "18:00"]);
  });

  it("7 天、6 小时一格：只标零点，一天一个；今天写「今天」", () => {
    const since = new Date(2026, 9, 21, 18).getTime();
    const g: Grid = { at: Array.from({ length: 28 }, (_, i) => since + i * 6 * HOUR), step: 6 * HOUR, kind: "bucket" };
    const now = new Date(2026, 9, 28, 20).getTime();
    const ticks = xTicks(g, 10, opts(now));
    expect(ticks.map((x) => x.label)).toEqual(["10-22", "10-23", "10-24", "10-25", "10-26", "10-27", "今天"]);
    expect(ticks[0]?.f).toBeCloseTo(1 / 28);
  });

  it("零点也排不下：隔几天一个，从最近的那一天往回数", () => {
    const since = new Date(2026, 9, 12).getTime();
    const g: Grid = { at: Array.from({ length: 32 }, (_, i) => since + i * 12 * HOUR), step: 12 * HOUR, kind: "bucket" };
    const ticks = xTicks(g, 6, opts(since + 30 * DAY));
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks.at(-1)?.label).toBe("10-27");
  });

  it("30 天、一天一格：隔几天一个日期，最右边那一天一定标着", () => {
    const since = new Date(2026, 8, 29).getTime();
    const g: Grid = { at: Array.from({ length: 31 }, (_, i) => since + i * DAY), step: DAY, kind: "bucket" };
    const now = new Date(2026, 9, 29, 10).getTime();
    const ticks = xTicks(g, 8, opts(now));
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(ticks.at(-1)).toEqual({ f: 30 / 31, label: "今天" });
    // 隔开的距离一样
    const gaps = ticks.slice(1).map((x, i) => x.f - ticks[i]!.f);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!);
  });

  it("按天的格子过了夏令时切换（起点落在前一天 23 点）：写离起点最近的那一天", () => {
    const at = new Date(2026, 9, 27).getTime() - HOUR;
    const g: Grid = { at: [at], step: DAY, kind: "bucket" };
    expect(xTicks(g, 4, opts(at + 10 * DAY))[0]?.label).toBe("10-27");
  });

  it("实时档：整分钟的时刻，位置按时刻算，跟着时间往左走", () => {
    const now = new Date(2026, 9, 28, 14, 31, 40).getTime();
    const g = liveSeries([], [], now, 10 * MINUTE).grid;
    const ticks = xTicks(g, 6, opts(now));
    expect(ticks.map((x) => x.label)).toEqual(["14:22", "14:24", "14:26", "14:28", "14:30"]);
    const later = liveSeries([], [], now + 5_000, 10 * MINUTE).grid;
    const moved = xTicks(later, 6, opts(now + 5_000));
    expect(moved[0]!.f).toBeLessThan(ticks[0]!.f);
  });

  it("一个都放不下或者没有格子：不标", () => {
    const g: Grid = { at: [], step: HOUR, kind: "bucket" };
    expect(xTicks(g, 5, opts(0))).toEqual([]);
    const h: Grid = { at: [0, HOUR], step: HOUR, kind: "bucket" };
    expect(xTicks(h, 0, opts(0))).toEqual([]);
  });
});
