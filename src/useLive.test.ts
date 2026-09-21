import { describe, expect, it } from "vitest";
import { LIVE_BUCKET_MS, LIVE_REACH_MS, LIVE_SIGMA_MS, liveRate } from "./useLive";

/**
 * 实时曲线的核。
 *
 * 纵轴写的是「token/秒」「$/小时」，**这句话是这些测试要守住的**：核要是
 * 按格归一，一格一秒时碰巧对，格子一放宽读数就差出格宽那么多倍，而图上
 * 什么都看不出来。
 */
describe("实时曲线的核", () => {
  /** 在一排格子上把一条请求摊开，再按每格的秒数加回来 */
  function spread(amount: number, offset: number): number {
    let sum = 0;
    for (let d = offset - LIVE_REACH_MS; d <= LIVE_REACH_MS; d += LIVE_BUCKET_MS) {
      sum += liveRate(amount, d) * (LIVE_BUCKET_MS / 1_000);
    }
    return sum;
  }

  it("读作每秒：按格宽加回来正好是这条请求的量", () => {
    // 三个 σ 之外截掉的那一截不到千分之五（见 `LIVE_REACH_MS`）
    expect(Math.abs(spread(10_000, 0) - 10_000) / 10_000).toBeLessThan(0.005);
  });

  /**
   * 格子每一步都按当下的时间重铺，落在请求的哪一侧是随机的。**加回来的
   * 量必须和格子落在哪儿无关**，不然曲线每走一步就胀缩一下。
   */
  it("格子落在哪儿都一样", () => {
    const at = [0, 0.1, 0.37, 0.5, 0.83].map((f) => spread(10_000, f * LIVE_BUCKET_MS));
    for (const x of at) expect(Math.abs(x - 10_000) / 10_000).toBeLessThan(0.005);
  });

  it("单独一条请求的峰值是 量 ÷ σ√2π（秒）", () => {
    const peak = 10_000 / ((LIVE_SIGMA_MS / 1_000) * Math.sqrt(2 * Math.PI));
    expect(liveRate(10_000, 0)).toBeCloseTo(peak, 6);
    // 对称：请求前后同样远的地方一样高
    expect(liveRate(10_000, -LIVE_SIGMA_MS)).toBeCloseTo(liveRate(10_000, LIVE_SIGMA_MS), 9);
  });
});
