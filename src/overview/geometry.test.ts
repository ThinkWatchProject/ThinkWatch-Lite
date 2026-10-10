import { describe, expect, it } from "vitest";
import { lineGeometry, peakOf } from "./geometry";

const xs = [0, 10, 20, 30, 40, 50];
/** 值直接当纵坐标，基线在 64 */
const y = (v: number) => v;

/** 路径里出现过的所有点（M、L、C 的终点和控制点） */
function points(d: string): [number, number][] {
  return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("小图的线", () => {
  it("连续的数：一条实线、一片面积，没有虚线", () => {
    const g = lineGeometry([10, 20, 15, 30, 25, 40], xs, y, 64);
    expect(g.line.startsWith("M0,10")).toBe(true);
    expect(g.line.match(/M/g)).toHaveLength(1);
    expect(g.area.endsWith("L50,64L0,64Z")).toBe(true);
    expect(g.gap).toBe("");
    expect(g.dots).toEqual([]);
  });

  /**
   * 夜里没有请求时首 token 的分位是空的：**空档里不画实线、不编数**，前后两个有数的点之间
   * 连一段虚线。
   */
  it("没有样本的几格：两段实线，中间一条虚线从前一个点接到后一个点", () => {
    const g = lineGeometry([10, 20, null, null, 25, 40], xs, y, 64);
    expect(g.line.match(/M/g)).toHaveLength(2);
    expect(g.gap).toBe("M10,20L40,25");
    // 实线和面积都不进空档
    for (const [x] of points(g.line)) expect(x <= 10 || x >= 40).toBe(true);
    for (const [x] of points(g.area)) expect(x <= 10 || x >= 40).toBe(true);
  });

  it("零是实打实的数：线贴着基线走，不算空档", () => {
    const g = lineGeometry([0, 0, 0], [0, 10, 20], (v) => 60 - v, 64);
    expect(g.gap).toBe("");
    expect(points(g.line).every(([, py]) => py === 60)).toBe(true);
  });

  it("夹在两个空档中间的孤点：两边各一条虚线接着它", () => {
    const g = lineGeometry([10, null, 30, null, 50, 60], xs, y, 64);
    expect(g.gap).toBe("M0,10L20,30M20,30L40,50");
    expect(g.dots).toEqual([]);
  });

  it("整张图只有一个数：一个小点，免得那个数看不见", () => {
    const g = lineGeometry([null, null, 30, null], xs.slice(0, 4), y, 64);
    expect(g.line).toBe("");
    expect(g.dots).toEqual([{ x: 20, y: 30 }]);
  });

  it("开头、结尾没有数：不往图外接虚线", () => {
    const g = lineGeometry([null, 20, 30, null], xs.slice(0, 4), y, 64);
    expect(g.gap).toBe("");
    expect(g.line.startsWith("M10,20")).toBe(true);
  });

  /** 单调曲线：控制点不越过每一段两端的值，曲线不会冒出数据里没有的峰 */
  it("曲线不越过数据", () => {
    const vals = [10, 50, 12, 48, 11, 49];
    const g = lineGeometry(vals, xs, y, 64);
    for (const [, py] of points(g.line)) {
      expect(py).toBeGreaterThanOrEqual(10);
      expect(py).toBeLessThanOrEqual(50);
    }
  });
});

describe("纵轴上界", () => {
  it("最大值上面留一成；几条线一起算", () => {
    expect(peakOf([1, 5, 3], [2, 10, null])).toBeCloseTo(11);
  });

  it("全是零或没有数：给 1，线贴着基线", () => {
    expect(peakOf([0, 0], null, [null])).toBe(1);
  });
});
