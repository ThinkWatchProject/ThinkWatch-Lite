import { describe, expect, it } from "vitest";
import type { CostBucket, CostBucketGroup, Dashboard, ProviderView, Summary } from "@/types";
import {
  attention,
  breakdown,
  cacheOf,
  delta,
  historySeries,
  liveSeries,
  rankCost,
  slotOf,
  slotTitle,
  topFailure,
  type Grid,
} from "./series";
import { overviewText } from "./overview.i18n";
import { LIVE_BUCKET_MS, type LiveSample } from "./useLive";

const t = overviewText.zh;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function summary(over: Partial<Summary> = {}): Summary {
  return {
    requests: 0,
    failed: 0,
    locally_answered: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    sent_bytes: 0,
    received_bytes: 0,
    cache_saved_micros: 0,
    security: {
      secrets: 0,
      secrets_replaced: 0,
      tool_calls: 0,
      tool_calls_cut: 0,
      content: 0,
      content_blocked: 0,
      content_stripped: 0,
    },
    pricing_date: "2026-09-20",
    ...over,
  };
}

/** 一项在一格里的量。`tokens` 全记成输入，`cost` 全记成实测 */
function group(at_ms: number, name: string, tokens: number, over: Partial<CostBucketGroup> = {}): CostBucketGroup {
  return {
    at_ms,
    name,
    requests: 1,
    failed: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    input_tokens: tokens,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    sent_bytes: 0,
    received_bytes: 0,
    ...over,
  };
}

/** 一格什么都没有：core 回的一格里不会是这样（它不产出空桶），拿来在上面改几项 */
function densifiedZero(at_ms: number): CostBucket {
  return {
    at_ms,
    requests: 0,
    failed: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    sent_bytes: 0,
    received_bytes: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ttft_p50_ms: null,
    ttft_p95_ms: null,
    ttft_samples: 0,
  };
}

/** 各格按模型加起来，和 core 的 `/summary/buckets` 对得上 */
function dashboard(since: number, groups: CostBucketGroup[], over: Partial<Dashboard> = {}): Dashboard {
  const buckets = new Map<number, CostBucket>();
  for (const g of groups) {
    const b = buckets.get(g.at_ms) ?? {
      at_ms: g.at_ms,
      requests: 0,
      failed: 0,
      cost_micros_exact: 0,
      cost_micros_estimated: 0,
      unpriced_requests: 0,
      no_usage_requests: 0,
      sent_bytes: 0,
      received_bytes: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      ttft_p50_ms: null,
      ttft_p95_ms: null,
      ttft_samples: 0,
    };
    b.requests += g.requests;
    b.failed += g.failed;
    b.cost_micros_exact += g.cost_micros_exact;
    b.cost_micros_estimated += g.cost_micros_estimated;
    b.unpriced_requests += g.unpriced_requests;
    b.no_usage_requests += g.no_usage_requests;
    b.input_tokens += g.input_tokens;
    b.output_tokens += g.output_tokens;
    b.cache_read_tokens += g.cache_read_tokens;
    b.cache_write_tokens += g.cache_write_tokens;
    b.sent_bytes += g.sent_bytes;
    b.received_bytes += g.received_bytes;
    buckets.set(g.at_ms, b);
  }
  return {
    summary: summary(),
    latency: [],
    latency_by_provider: [],
    latency_by_client: [],
    token_rate: [],
    token_rate_by_provider: [],
    storage: null,
    buckets: [...buckets.values()],
    buckets_by_model: groups,
    buckets_by_provider: [],
    buckets_by_client: [],
    prev: null,
    ttft: { p50_ms: null, p95_ms: null, samples: 0 },
    prev_ttft: null,
    since_ms: since,
    ...over,
  };
}

/**
 * 联动的竖线按时刻对：指着一张卡片，别的卡片停在同一个时刻所在的那一格。实时档里有的
 * 卡片是十分钟、有的是 24 小时，同一刻落在各自的格子上；不在图上的那一刻不画。
 */
describe("联动的竖线落在哪一格", () => {
  const since = new Date(2026, 8, 24, 17, 0).getTime();
  const hourly: Grid = { at: Array.from({ length: 25 }, (_, i) => since + i * HOUR), step: HOUR, kind: "bucket" };

  it("历史档：落在包着这一刻的那一格（格子管 [起点, 起点 + 格宽)）", () => {
    expect(slotOf(hourly, since)).toBe(0);
    expect(slotOf(hourly, since + HOUR - 1)).toBe(0);
    expect(slotOf(hourly, since + 3 * HOUR + 20 * 60_000)).toBe(3);
  });

  it("实时档：落在离这一刻最近的那一格", () => {
    const now = since + 24 * HOUR + 42 * 60_000;
    const live: Grid = { at: Array.from({ length: 61 }, (_, i) => now - (60 - i) * LIVE_BUCKET_MS), step: LIVE_BUCKET_MS, kind: "instant" };
    expect(slotOf(live, now)).toBe(60);
    expect(slotOf(live, now - 3 * LIVE_BUCKET_MS - 4_000)).toBe(57);
    // 实时档上指着的那一刻，落在 24 小时那几张图的最后一格
    expect(slotOf(hourly, now - 30_000)).toBe(24);
  });

  it("不在图上的那一刻是 null", () => {
    expect(slotOf(hourly, since - 1)).toBeNull();
    expect(slotOf(hourly, since + 25 * HOUR)).toBeNull();
    expect(slotOf({ at: [], step: HOUR, kind: "bucket" }, since)).toBeNull();
  });
});

describe("一格的悬停抬头", () => {
  it("24 小时：写起止，不带日期；还没过完的那一格止于「现在」", () => {
    const since = new Date(2026, 8, 24, 17, 0).getTime();
    const g: Grid = { at: Array.from({ length: 25 }, (_, i) => since + i * HOUR), step: HOUR, kind: "bucket" };
    const now = since + 24 * HOUR + 42 * 60_000;
    expect(slotTitle(g, 21, now, t.now)).toBe("14:00–15:00");
    expect(slotTitle(g, 24, now, t.now)).toBe("17:00–现在");
  });

  it("7 天：几小时一格的前面带上日期", () => {
    const since = new Date(2026, 8, 18, 12, 0).getTime();
    const g: Grid = { at: Array.from({ length: 29 }, (_, i) => since + i * 6 * HOUR), step: 6 * HOUR, kind: "bucket" };
    expect(slotTitle(g, 1, since + 7 * DAY, t.now)).toBe("09-18 18:00–00:00");
  });

  it("一天一格写那一天；一周一格写起止两天", () => {
    const at = new Date(2026, 8, 22).getTime();
    expect(slotTitle({ at: [at], step: DAY, kind: "bucket" }, 0, at + 2 * DAY, t.now)).toBe("09-22");
    expect(slotTitle({ at: [at], step: 7 * DAY, kind: "bucket" }, 0, at + 30 * DAY, t.now)).toBe("09-22–09-28");
    expect(slotTitle({ at: [at], step: 7 * DAY, kind: "bucket" }, 0, at + 3 * DAY, t.now)).toBe("09-22–现在");
  });

  /**
   * 按天的格子是从本地零点起按固定毫秒数数的，过了夏令时切换，起点落在前一天的 23 点。
   * **写离起点最近的那一天**，不然那一格写成前一天，和上一格撞成同一个标签。
   */
  it("按天的格子起点偏了一小时，还是写那一天", () => {
    const at = new Date(2026, 10, 1, 23, 0).getTime();
    expect(slotTitle({ at: [at], step: DAY, kind: "bucket" }, 0, at + 3 * DAY, t.now)).toBe("11-02");
  });

  it("实时档写到秒", () => {
    const at = new Date(2026, 8, 25, 7, 5, 9).getTime();
    expect(slotTitle({ at: [at], step: LIVE_BUCKET_MS, kind: "instant" }, 0, at, t.now)).toBe("07:05:09");
  });
});

describe("历史档的小图", () => {
  const since = new Date(2026, 8, 24, 0, 0).getTime();
  const now = since + 3 * HOUR + 10 * 60_000;

  it("空桶补成 0，每一格的 token 是这一格四类 token 的合计", () => {
    const d = dashboard(since, [group(since + HOUR, "a", 100), group(since + HOUR, "b", 50, { output_tokens: 7 }), group(since + 3 * HOUR, "a", 9)]);
    const s = historySeries(d, now, HOUR);
    expect(s.grid.at).toEqual([0, 1, 2, 3].map((i) => since + i * HOUR));
    expect(s.tokens).toEqual([0, 157, 0, 9]);
    expect(s.requests).toEqual([0, 2, 0, 1]);
  });

  /** 取不到不是没有：画成一条贴底的线就是编了一段「没有用」 */
  it("哪一样取不到，那一样就是 null；格子照样排出来", () => {
    const d = dashboard(since, [group(since, "a", 1)], { buckets: null });
    const s = historySeries(d, now, HOUR);
    expect(s.grid.at).toHaveLength(4);
    expect(s.tokens).toBeNull();
    expect(s.cost).toBeNull();
    expect(s.requests).toBeNull();
    expect(s.p50).toBeNull();
    expect(s.sent).toBeNull();
  });

  it("流量是每一格的上传、下载；空桶是 0", () => {
    const d = dashboard(since, [
      group(since, "a", 1, { sent_bytes: 7_000, received_bytes: 900 }),
      group(since, "b", 1, { sent_bytes: 3_000, received_bytes: 100 }),
      group(since + 2 * HOUR, "a", 1, { sent_bytes: 50, received_bytes: 5 }),
    ]);
    const s = historySeries(d, now, HOUR);
    expect(s.sent).toEqual([10_000, 0, 50, 0]);
    expect(s.received).toEqual([1_000, 0, 5, 0]);
  });

  /** 没有流式请求的那一小时没有首 token：是「没有」，不是 0 毫秒，图上用虚线跨过去 */
  it("首 token 的分位：有样本的格子是 core 给的数，别的是 null", () => {
    const d = dashboard(since, []);
    d.buckets = [
      { ...densifiedZero(since), requests: 3, ttft_p50_ms: 900, ttft_p95_ms: 2_100, ttft_samples: 3 },
      { ...densifiedZero(since + 2 * HOUR), requests: 1 },
    ];
    const s = historySeries(d, now, HOUR);
    expect(s.p50).toEqual([900, null, null, null]);
    expect(s.p95).toEqual([2_100, null, null, null]);
  });

  it("费用是实测加估算", () => {
    const d = dashboard(since, [group(since, "a", 1, { cost_micros_exact: 300, cost_micros_estimated: 20 })]);
    expect(historySeries(d, now, HOUR).cost?.[0]).toBe(320);
  });
});

describe("实时档的小图", () => {
  const now = 10_000_000;
  const RANGE = 10 * 60_000;
  const sample = (id: number, at: number, over: Partial<LiveSample> = {}): LiveSample => ({
    id,
    at,
    model: "m",
    tokens: 1000,
    output: 100,
    cost: 500,
    ...over,
  });

  it("十分钟、十秒一格，最右边那一格就是现在", () => {
    const s = liveSeries([], [], now, RANGE);
    expect(s.grid.at).toHaveLength(61);
    expect(s.grid.at.at(-1)).toBe(now);
    expect(s.grid.at[0]).toBe(now - RANGE);
  });

  it("大数只数窗口里的；窗口外那一个核宽的样本只进曲线", () => {
    const s = liveSeries([sample(1, now - RANGE - 20_000), sample(2, now - 30_000)], [], now, RANGE);
    expect(s.totals.tokens).toBe(1000);
    expect(s.totals.output).toBe(100);
    // 窗口外的那一条在最左边那一格上还有鼓包
    expect(s.tokens![0]).toBeGreaterThan(0);
  });

  it("价钱还没到的和未定价的分开数，都不当成 $0", () => {
    const s = liveSeries(
      [sample(1, now - 1000), sample(2, now - 2000, { cost: undefined }), sample(3, now - 3000, { cost: null }), sample(4, now - 4000, { estimated: true })],
      [],
      now,
      RANGE,
    );
    expect(s.totals).toMatchObject({ cost: 1000, estimated: 500, pending: 1, unpriced: 1 });
  });

  it("请求柱：每一格数它前面那十秒里结束了几次、失败了几次", () => {
    const s = liveSeries(
      [],
      [
        { id: 1, at: now - 1_000, failed: false },
        { id: 2, at: now - 9_000, failed: true },
        { id: 3, at: now - 12_000, failed: false },
        { id: 4, at: now - RANGE - 1, failed: true },
      ],
      now,
      RANGE,
    );
    expect(s.requests!.at(-1)).toBe(2);
    expect(s.failed!.at(-1)).toBe(1);
    expect(s.requests!.at(-2)).toBe(1);
    expect(s.totals).toMatchObject({ requests: 3, failed: 1 });
  });
});

describe("环比", () => {
  it("取不到上一个区间：没有这一格", () => {
    expect(delta(10, null)).toBeNull();
    expect(delta(10, undefined)).toBeNull();
  });

  it("上一个区间是零：写「—」", () => {
    expect(delta(10, 0)).toEqual({ kind: "noPrior" });
  });

  it("其余是变化的比例", () => {
    expect(delta(17, 10)).toEqual({ kind: "change", ratio: 0.7 });
    expect(delta(5, 10)).toEqual({ kind: "change", ratio: -0.5 });
  });
});

describe("缓存", () => {
  it("命中率是读缓存占全部上下文（含缓存）的比例；没有上下文时无从谈起", () => {
    expect(cacheOf({ input_tokens: 30, cache_read_tokens: 940, cache_write_tokens: 30 })).toEqual({
      read: 940,
      plain: 30,
      write: 30,
      ctx: 1000,
      hit: 0.94,
    });
    expect(cacheOf({ input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }).hit).toBeNull();
  });
});

/**
 * 费用那一格。**「没有价格」「确实不花钱」「没有用量」是三件事**，都写成一个 `$0` 或一个
 * 「—」的话，读的人分不出哪一行该去补价。
 */
describe("费用写什么", () => {
  const c = (over: Partial<{ cost: number; estimated: number; unpriced: number; noUsage: number; pending: number }>) => ({
    cost: 0,
    estimated: 0,
    unpriced: 0,
    noUsage: 0,
    ...over,
  });

  it("全都算出来了：写金额，没有悬停；合计是零就写 $0（不计费的上游）", () => {
    expect(rankCost(c({ cost: 1_234 }), t)).toEqual({ kind: "amount", prefix: "", notes: [] });
    expect(rankCost(c({ cost: 0 }), t)).toEqual({ kind: "amount", prefix: "", notes: [] });
  });

  it("有用量、一条都没算出费用：「无法计价」，不写 $0", () => {
    const r = rankCost(c({ unpriced: 5 }), t);
    expect(r.kind).toBe("unpriced");
    expect(r.notes).toEqual([t.rankUnpriced(5)]);
  });

  it("连用量都没有：「无用量」", () => {
    expect(rankCost(c({ noUsage: 2 }), t)).toEqual({ kind: "noUsage", prefix: "", notes: [t.rankNoUsage(2)] });
  });

  it("两样都有、一分钱都没算出来：算「无法计价」—— 补价修得好的那一种优先说", () => {
    const r = rankCost(c({ unpriced: 1, noUsage: 3 }), t);
    expect(r.kind).toBe("unpriced");
    expect(r.notes).toEqual([t.rankUnpriced(1), t.rankNoUsage(3)]);
  });

  it("算出了一部分：金额是下限，写「≥」；价钱还没到的也一样", () => {
    expect(rankCost(c({ cost: 500, unpriced: 2 }), t)).toEqual({ kind: "amount", prefix: "≥", notes: [t.rankUnpriced(2)] });
    expect(rankCost(c({ cost: 500, pending: 1 }), t)).toMatchObject({ prefix: "≥", notes: [t.rankPending(1)] });
  });

  it("含估算：带「~」，估算的数写在悬停里；两样都有是「≥~」", () => {
    expect(rankCost(c({ cost: 500, estimated: 120 }), t)).toEqual({ kind: "amount", prefix: "~", notes: [t.estimated("$0.0001")] });
    expect(rankCost(c({ cost: 500, estimated: 120, unpriced: 1 }), t)).toMatchObject({
      prefix: "≥~",
      notes: [t.estimated("$0.0001"), t.rankUnpriced(1)],
    });
  });
});

describe("明细表", () => {
  const at = new Date(2026, 8, 24).getTime();

  it("跨格加成每个名字一行：请求多的在前，一样多的按 token", () => {
    const rows = breakdown([
      group(at, "a", 100, { requests: 2, cache_read_tokens: 300 }),
      group(at + HOUR, "a", 50, { requests: 1, failed: 1, cost_micros_exact: 10, cost_micros_estimated: 5 }),
      group(at, "b", 10, { requests: 3, unpriced_requests: 3 }),
      group(at, "c", 999, { requests: 3 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["c", "a", "b"]);
    expect(rows[1]).toMatchObject({ requests: 3, failed: 1, tokens: 450, ctx: 450, read: 300, cost: 15, estimated: 5 });
    expect(rows[2]).toMatchObject({ unpriced: 3 });
  });
});

describe("失败集中在哪个上游", () => {
  const at = 0;
  const g = (name: string, failed: number) => group(at, name, 0, { failed, requests: failed });

  it("过半才点名；没到上游的（空名字）不归给谁", () => {
    expect(topFailure([g("openrouter", 11), g("anthropic", 4), g("", 3)], 18)).toEqual({ name: "openrouter", n: 11 });
    expect(topFailure([g("openrouter", 9), g("anthropic", 4), g("", 5)], 18)).toBeNull();
    expect(topFailure([g("", 18)], 18)).toBeNull();
  });

  it("跨格加起来", () => {
    expect(topFailure([g("a", 2), { ...g("a", 2), at_ms: HOUR }, g("b", 1)], 5)).toEqual({ name: "a", n: 4 });
  });

  it("取不到按上游分的那份：不点名", () => {
    expect(topFailure(null, 5)).toBeNull();
  });
});

describe("需要处理的事", () => {
  const provider = (name: string, over: Partial<ProviderView> = {}) => ({ name, disabled: false, health: "closed", ...over }) as ProviderView;

  it("什么都不用处理：空的，那一条整个不出现", () => {
    expect(attention(dashboard(0, []), [provider("a")])).toEqual([]);
  });

  it("失败、切断的工具调用、用不了的上游、无法计价，按这个次序", () => {
    const d = dashboard(0, [], {
      summary: summary({
        failed: 18,
        unpriced_requests: 3,
        security: { ...summary().security, tool_calls: 2, tool_calls_cut: 1, secrets: 40 },
      }),
      buckets_by_provider: [group(0, "openrouter", 0, { failed: 11 })],
    });
    const items = attention(d, [
      provider("a"),
      provider("b", { health: "open" }),
      provider("c", { disabled: true, health: "open" }),
    ]);
    expect(items).toEqual([
      { kind: "failed", n: 18, top: { name: "openrouter", n: 11 } },
      { kind: "toolCut", n: 1 },
      { kind: "upstreams", down: [{ name: "b", why: "open" }] },
      { kind: "unpriced", n: 3 },
    ]);
  });

  /** 日常的脱敏是防护在正常工作，不用处理；记录档里看见但没切断的工具调用也不算 */
  it("只有脱敏、只记录了的工具调用：不出现", () => {
    const d = dashboard(0, [], { summary: summary({ security: { ...summary().security, secrets: 12, secrets_replaced: 12, tool_calls: 3 } }) });
    expect(attention(d, [])).toEqual([]);
  });
});

