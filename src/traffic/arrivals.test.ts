import { describe, expect, it } from "vitest";
import { arrive } from "./arrivals";

/**
 * 哪几项是刚到的（进场动画）。**只认第一次出现**，而「见过的」不能只涨不落：列表有
 * 上限，被挤出去的 id 不会再回来，一直攥着它们，开着一天就是几万个。
 */
describe("刚到的那几项", () => {
  it("只认第一次出现的", () => {
    const first = arrive(new Set([1, 2]), [3, 2, 1]);
    expect(first.news).toEqual([3]);
    expect(arrive(first.known, [3, 2, 1]).news).toEqual([]);
  });

  it("见过的只留还在的那些，攒多了就按眼前的重建", () => {
    let known = new Set<number>();
    // 列表一直是最新的三条：一共来过二十条
    for (let n = 1; n <= 20; n++) {
      known = arrive(known, [n, n - 1, n - 2].filter((x) => x > 0)).known;
    }
    expect(known.size).toBeLessThanOrEqual(6);
    for (const id of [18, 19, 20]) expect(known.has(id)).toBe(true);
    // 还在的那几条不会因为重建又算成新来的
    expect(arrive(known, [20, 19, 18]).news).toEqual([]);
  });
});
