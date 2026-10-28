import { describe, expect, it } from "vitest";
import type { CostBucketGroup, LatencyView } from "@/types";
import { rankSpend, shareText, spendItems } from "./spendRank";

function g(name: string, at: number, x: Partial<CostBucketGroup>): CostBucketGroup {
  return {
    at_ms: at,
    name,
    requests: 0,
    failed: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    sent_bytes: 0,
    received_bytes: 0,
    ...x,
  };
}

const GROUPS: CostBucketGroup[] = [
  // a：两格，token 最多、费用含估算
  g("a", 0, { requests: 3, input_tokens: 100, output_tokens: 50, cache_read_tokens: 300, cost_micros_exact: 2_000, sent_bytes: 10, received_bytes: 5 }),
  g("a", 3_600_000, { requests: 2, input_tokens: 100, output_tokens: 50, cache_read_tokens: 100, cost_micros_estimated: 1_000, sent_bytes: 20 }),
  // b：请求最多、费用最高、没读到缓存
  g("b", 0, { requests: 9, input_tokens: 200, output_tokens: 20, cost_micros_exact: 9_000, sent_bytes: 400, received_bytes: 100 }),
  // 没有名字的：没到上游的请求，有请求没有 token
  g("", 0, { requests: 1, unpriced_requests: 0, no_usage_requests: 1 }),
];

const LATENCY = new Map<string, LatencyView>([
  ["a", { model: "a", p50: 900, p95: 2000, samples: 4 } as LatencyView],
  ["b", { model: "b", p50: 1400, p95: 3000, samples: 7 } as LatencyView],
]);

describe("去向", () => {
  it("各格加成每一项，流量是上传加下载", () => {
    const items = spendItems(GROUPS);
    const a = items.find((x) => x.name === "a")!;
    expect(a.tokens).toBe(700);
    expect(a.bytes).toBe(35);
    expect(a.requests).toBe(5);
    expect(items.find((x) => x.name === "b")!.bytes).toBe(500);
  });

  it("能加起来的指标：按值排、占比加起来是一、条按最大的归一", () => {
    const { rows, total } = rankSpend("tokens", spendItems(GROUPS), LATENCY);
    expect(rows.map((r) => r.item.name)).toEqual(["a", "b", ""]);
    expect(total.sum).toBe(920);
    expect(rows[0]!.bar).toBe(1);
    expect(rows[1]!.bar).toBeCloseTo(220 / 700);
    expect(rows.reduce((s, r) => s + (r.share ?? 0), 0)).toBeCloseTo(1);
    // 没有 token 的那一项是 0，不是说不出
    expect(rows[2]!.value).toBe(0);
    expect(rows[2]!.share).toBe(0);
  });

  it("费用：合计带着三态", () => {
    const { rows, total } = rankSpend("cost", spendItems(GROUPS), LATENCY);
    expect(rows.map((r) => r.item.name)).toEqual(["b", "a", ""]);
    expect(total.cost).toEqual({ cost: 12_000, estimated: 1_000, unpriced: 0, noUsage: 1 });
  });

  it("缓存命中按各项自己的命中率，没有上下文的说不出、排在最后；合计是整体命中率", () => {
    const { rows, total } = rankSpend("cache", spendItems(GROUPS), LATENCY);
    expect(rows.map((r) => r.item.name)).toEqual(["a", "b", ""]);
    expect(rows[0]!.value).toBeCloseTo(400 / 600);
    expect(rows[1]!.value).toBe(0);
    expect(rows[2]!.value).toBeNull();
    expect(rows[2]!.bar).toBe(0);
    // 比率没有占比
    expect(rows.every((r) => r.share === null)).toBe(true);
    expect(total.hit).toBeCloseTo(400 / 800);
  });

  it("首 token 按各项的 P50，慢的在前；没有样本的说不出", () => {
    const { rows } = rankSpend("ttft", spendItems(GROUPS), LATENCY);
    expect(rows.map((r) => [r.item.name, r.value])).toEqual([
      ["b", 1400],
      ["a", 900],
      ["", null],
    ]);
  });

  it("合计是 0 时没有占比，也不画条", () => {
    const { rows } = rankSpend("traffic", spendItems([g("x", 0, { requests: 1 })]), LATENCY);
    expect(rows[0]!.share).toBeNull();
    expect(rows[0]!.bar).toBe(0);
  });

  it("占比不把有量的写成 0%", () => {
    expect(shareText(0.004)).toBe("<1%");
    expect(shareText(0)).toBe("0%");
    expect(shareText(0.456)).toBe("46%");
    expect(shareText(1)).toBe("100%");
  });
});
