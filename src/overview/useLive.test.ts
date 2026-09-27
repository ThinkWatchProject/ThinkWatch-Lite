import { describe, expect, it } from "vitest";
import type { HistoryRow } from "@/types";
import { LIVE_BUCKET_MS, LIVE_REACH_MS, LIVE_SIGMA_MS, liveRate, refill, type LiveSample } from "./useLive";

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

/** 库里读回来的一行：一次正常结束、算过价的请求 */
function stored(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: 1,
    at_ms: 1_000_000,
    client: "claude-code",
    provider: "official",
    model: "claude-sonnet-5",
    path: "/v1/messages",
    status: 200,
    ttfb_ms: 800,
    duration_ms: 4_000,
    bytes: 1_234,
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: null,
    cache_write_tokens: null,
    cost_micros: 1_500,
    cost_estimated: false,
    error: null,
    local: false,
    cancelled: false,
    billing: "per-token",
    ...over,
  };
}

/**
 * 实时档从库里补回来的那一段（进这一档时、事件流丢过事件之后）。
 *
 * 事件流和库会说到同一次请求，谁先到都有可能：按 id 去重。**事件流上画了、价钱却
 * 没等到的**（`request_priced` 丢在了丢掉的那一段里）按库里的补上 —— 不补的话，它在
 * 窗口里一直是「价钱还没到」，那个模型的金额一直只是下限。
 */
describe("实时档从库里补", () => {
  const opts = { skew: 0, cut: 0, unknownModel: "未知模型" };

  it("事件流上画了、价钱没等到的，按库里的补上；已经有价钱的不动", () => {
    const waiting: LiveSample = { id: 1, at: 1_004_000, model: "claude-sonnet-5", tokens: 120 };
    const priced: LiveSample = { id: 2, at: 1_004_500, model: "claude-sonnet-5", tokens: 120, cost: 900 };
    const out = refill([waiting, priced], [], [stored(), stored({ id: 2, cost_micros: 1_700 })], opts);
    expect(out.samples).toHaveLength(2);
    expect(out.samples.find((s) => s.id === 1)).toMatchObject({ cost: 1_500, estimated: false });
    expect(out.samples.find((s) => s.id === 2)?.cost).toBe(900);
  });

  it("库里是空的价钱（未定价）也补上：那是价钱到了，不是还没到", () => {
    const waiting: LiveSample = { id: 1, at: 1_004_000, model: "m", tokens: 120 };
    const out = refill([waiting], [], [stored({ cost_micros: null })], opts);
    expect(out.samples[0]?.cost).toBeNull();
  });

  it("事件流上没有的补进来，按时间排；失败只记一次；本地应答不算", () => {
    const drawn: LiveSample = { id: 5, at: 1_010_000, model: "m", tokens: 10, cost: 1 };
    const why = { code: "gw.upstream.status", args: {}, text: "Upstream answered 503." };
    const out = refill(
      [drawn],
      [{ id: 3, at: 1_006_000 }],
      [stored({ id: 3, error: why }), stored({ id: 4, at_ms: 1_001_000, error: why }), stored({ id: 6, local: true })],
      opts,
    );
    // 落在结束的那一刻：3 在 1_004_000，4 在 1_005_000
    expect(out.samples.map((s) => s.id)).toEqual([3, 4, 5]);
    expect(out.fails.map((f) => f.id).sort()).toEqual([3, 4]);
  });
});
