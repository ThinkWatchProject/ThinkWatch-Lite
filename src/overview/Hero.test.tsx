import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CostBucket, Dashboard, Summary } from "@/types";
import { LIVE_RANGE, dayRange, presetRange, type Range } from "@/ui/range";
import { bucketOf } from "./useOverview";
import { Hero } from "./Hero";
import { METRICS, type Metric } from "./metric";
import { overviewText } from "./overview.i18n";

// 悬停提示要挂在 TooltipProvider 里；这里只看画出来的字
vi.mock("@/ui/tip", () => ({ Tip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/nav", () => ({ useNav: () => ({ open: () => {} }) }));

const t = overviewText.zh;
const HOUR = 3_600_000;

function summary(over: Partial<Summary> = {}): Summary {
  return {
    requests: 12,
    failed: 2,
    locally_answered: 0,
    input_tokens: 4_000,
    output_tokens: 1_000,
    cache_read_tokens: 6_000,
    cache_write_tokens: 500,
    cost_micros_exact: 30_000,
    cost_micros_estimated: 2_000,
    unpriced_requests: 0,
    no_usage_requests: 0,
    sent_bytes: 40_000,
    received_bytes: 9_000,
    cache_saved_micros: 1_200,
    security: {
      secrets: 0,
      secrets_replaced: 0,
      tool_calls: 0,
      tool_calls_cut: 0,
      content: 0,
      content_blocked: 0,
      content_stripped: 0,
      content_replaced: 0,
    },
    pricing_date: "2026-10-20",
    ...over,
  };
}

function bucket(at_ms: number): CostBucket {
  return {
    at_ms,
    requests: 3,
    failed: 1,
    cost_micros_exact: 7_000,
    cost_micros_estimated: 500,
    unpriced_requests: 0,
    no_usage_requests: 0,
    sent_bytes: 10_000,
    received_bytes: 2_000,
    input_tokens: 1_000,
    output_tokens: 250,
    cache_read_tokens: 1_500,
    cache_write_tokens: 100,
    ttft_p50_ms: 800,
    ttft_p95_ms: 2_400,
    ttft_samples: 3,
  };
}

function dashboard(range: Range, over: Partial<Dashboard> = {}): Dashboard {
  const since = range.from ?? Date.now() - range.ms;
  const at = since - (since % HOUR);
  return {
    summary: summary(),
    latency: [],
    latency_by_provider: [],
    latency_by_client: [],
    token_rate: [],
    token_rate_by_provider: [],
    storage: null,
    quotas: null,
    buckets: [bucket(at)],
    buckets_by_model: [],
    buckets_by_provider: [],
    buckets_by_client: [],
    prev: summary({ requests: 10, cost_micros_exact: 40_000, cost_micros_estimated: 0 }),
    ttft: { p50_ms: 800, p95_ms: 2_400, samples: 9 },
    prev_ttft: { p50_ms: 900, p95_ms: 2_000, samples: 7 },
    since_ms: at,
    ...over,
  };
}

function render(range: Range, metric: Metric, over: Partial<Dashboard> = {}) {
  return renderToStaticMarkup(
    <Hero d={dashboard(range, over)} range={range} scope="s" step={bucketOf(range)} metric={metric} onMetric={() => {}} />,
  );
}

describe("用量", () => {
  it("每个区间、每个指标都画得出来：六个指标、选中的那个、它的细项", () => {
    for (const range of [presetRange("7d"), presetRange("1d"), dayRange(new Date(2026, 9, 20)), LIVE_RANGE]) {
      for (const m of METRICS) {
        const html = render(range, m);
        expect(html.match(/role="tab"/g)).toHaveLength(6);
        expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
        expect(html).toContain('role="tabpanel"');
      }
    }
  });

  /** 估算不能冒充实测：限定词一直写着，不只在悬停里 */
  it("费用的限定词一直看得见：没选中费用时在指标上，选中时细项里逐条写着", () => {
    const range = presetRange("7d");
    const unpriced = { summary: summary({ unpriced_requests: 3 }) };
    expect(render(range, "tokens")).toContain(t.tagEstimated);
    expect(render(range, "tokens", unpriced)).toContain(t.tagUnpriced);
    const cost = render(range, "cost", unpriced);
    expect(cost).toContain(t.estimated("$0.0020"));
    expect(cost).toContain(t.shortUnpriced(3));
    expect(cost).toContain("≥~$0.032");
  });

  it("一条都没算出费用：大数写「—」，旁边写「无法计价」，不写 $0", () => {
    const html = render(presetRange("7d"), "tokens", {
      summary: summary({ cost_micros_exact: 0, cost_micros_estimated: 0, unpriced_requests: 4 }),
    });
    expect(html).toContain(t.unpricedCell);
    expect(html).not.toContain(">$0<");
  });

  it("实时档：按 24 小时算的三个名目旁边标着", () => {
    const html = render(LIVE_RANGE, "cache");
    expect(html.match(/>24 小时</g)).toHaveLength(3);
    expect(render(presetRange("7d"), "cache")).not.toContain(">24 小时<");
  });

  it("取不到那一样：写「暂时取不到」，不画成零", () => {
    const html = render(presetRange("7d"), "tokens", { buckets: null });
    expect(html).toContain(t.chartUnavailable);
    expect(render(presetRange("7d"), "ttft", { ttft: null, buckets: null })).toContain(t.chartUnavailable);
  });

  it("细项：缓存的三段和省下的费用，请求的失败次数", () => {
    const cache = render(presetRange("7d"), "cache");
    expect(cache).toContain(t.cacheReads);
    expect(cache).toContain(t.uncachedInput);
    expect(cache).toContain(t.cacheWrites);
    expect(cache).toContain(t.saved("$0.0012"));
    expect(render(presetRange("7d"), "requests")).toContain(t.failedSub(2));
  });
});
