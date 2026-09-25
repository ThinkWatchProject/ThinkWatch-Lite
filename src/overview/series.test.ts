import { describe, expect, it } from "vitest";
import type { CostBucket, CostBucketGroup, Dashboard, Summary } from "@/types";
import {
  buildTrend,
  cacheByModel,
  fmtBucket,
  fmtMs,
  historyTicks,
  holdY,
  latencyRows,
  liveTicks,
  modelGlyph,
  niceCeil,
  rankCost,
  type RankRow,
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
    cache_saved_micros: 0,
    security: {
      secrets: 0,
      secrets_replaced: 0,
      tool_calls: 0,
      tool_calls_cut: 0,
      hidden_text: 0,
      hidden_text_blocked: 0,
      content: 0,
      content_blocked: 0,
      output_limit: 0,
      output_limit_cut: 0,
    },
    pricing_date: "2026-09-20",
    ...over,
  };
}

/** 一个模型在一格里的量。`tokens` 全记成输入，`cost` 全记成实测 */
function group(at_ms: number, name: string, tokens: number, cost = 0, requests = 1): CostBucketGroup {
  return {
    at_ms,
    name,
    requests,
    failed: 0,
    cost_micros_exact: cost,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    input_tokens: tokens,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
}

/** 各格按模型加起来，和 core 的 `/summary/buckets` 对得上 */
function dashboard(since: number, groups: CostBucketGroup[]): Dashboard {
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
    };
    b.requests += g.requests;
    b.failed += g.failed;
    b.cost_micros_exact += g.cost_micros_exact;
    b.cost_micros_estimated += g.cost_micros_estimated;
    b.unpriced_requests += g.unpriced_requests;
    b.no_usage_requests += g.no_usage_requests;
    buckets.set(g.at_ms, b);
  }
  return {
    summary: summary(),
    latency: [],
    latency_by_provider: [],
    storage: null,
    buckets: [...buckets.values()],
    buckets_by_model: groups,
    prev: null,
    since_ms: since,
  };
}

/** 排行里的一行，只写要测的那几项 */
function rank(over: Partial<RankRow>): RankRow {
  return {
    name: "m",
    merged: 0,
    tokens: 1000,
    cost: 0,
    estimated: 0,
    unpriced: 0,
    noUsage: 0,
    requests: 1,
    color: "var(--chart-1)",
    ...over,
  };
}

describe("纵轴上界", () => {
  it("粗档是 1 / 2 / 5", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(0.7)).toBe(1);
    expect(niceCeil(1.3)).toBe(2);
    expect(niceCeil(3)).toBe(5);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(2_300)).toBe(5_000);
  });

  it("细档在两档之间补上中间的数，浮点的整数不往上多跳一档", () => {
    expect(niceCeil(1.1, true)).toBe(1.2);
    expect(niceCeil(2.9e6, true)).toBe(3e6);
    expect(niceCeil(3e6, true)).toBe(3e6);
    expect(niceCeil(3.01, true)).toBe(4);
    expect(niceCeil(0.3, true)).toBeCloseTo(0.3, 12);
  });

  /**
   * 这就是细档的理由：1/2/5 下峰值刚过 2 就得取 5，图只占下面四成。细档下最坏
   * 也占到四分之三。
   */
  it("细档下图至少占满四分之三的高", () => {
    for (let v = 0.011; v < 1e7; v *= 1.037) {
      const top = niceCeil(v, true);
      expect(top).toBeGreaterThanOrEqual(v);
      expect(v / top).toBeGreaterThan(0.74);
    }
  });

  /** 刻度写的是上界和它的一半，所以一半也要是整齐的数（最多一位小数） */
  it("每一档的一半也是整齐的数", () => {
    for (const s of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
      const half = niceCeil(s * 1000, true) / 2;
      expect(half % 100).toBe(0);
    }
  });

  it("峰值涨过上界就重取，掉得不多不动，掉到一半以下才降档", () => {
    let y = holdY({ key: "", v: 0 }, "token/last:1d", 900);
    expect(y.v).toBe(1000);
    y = holdY(y, "token/last:1d", 600);
    expect(y.v).toBe(1000);
    y = holdY(y, "token/last:1d", 1300);
    expect(y.v).toBe(2000);
    y = holdY(y, "token/last:1d", 700);
    expect(y.v).toBe(1000);
  });

  it("口径或区间一换，从头取", () => {
    const y = holdY({ key: "token/last:1d", v: 5_000_000 }, "cost/last:1d", 3_000);
    expect(y).toEqual({ key: "cost/last:1d", v: 5_000 });
  });
});

describe("时间刻度", () => {
  it("24 小时：起点、每 4 小时一个整点（零点写日期）、现在", () => {
    const since = new Date(2026, 8, 24, 16, 0).getTime();
    const ticks = historyTicks(since, HOUR / 2, 49, t.now);
    expect(ticks.map((x) => x.label)).toEqual(["9/24 16:00", "20:00", "9/25", "04:00", "08:00", "12:00", "现在"]);
    expect(ticks[0]?.at).toBe(0);
    expect(ticks.at(-1)).toMatchObject({ at: 1, now: true });
    // 标在它说的那个时刻：20:00 是 24 小时里的第 4 个小时
    expect(ticks[1]?.at).toBeCloseTo(4 / 24, 9);
  });

  it("7 天：按天写，离两头太近的不写", () => {
    const since = new Date(2026, 8, 18, 16, 0).getTime();
    const ticks = historyTicks(since, 2 * HOUR, 85, t.now);
    // 9/19 零点离起点只有 8 小时（<12%），9/25 零点离「现在」太近
    expect(ticks.map((x) => x.label)).toEqual(["9/18 16:00", "9/20", "9/21", "9/22", "9/23", "9/24", "现在"]);
  });

  it("只有一格时只写起点和现在", () => {
    expect(historyTicks(0, HOUR, 1, "now").map((x) => x.label)).toEqual([fmtBucket(0, HOUR), "now"]);
  });

  it("实时档：等距，最后一个是亮着的「现在」", () => {
    const ticks = liveTicks(t.liveTicks, t.now);
    expect(ticks).toHaveLength(6);
    expect(ticks.map((x) => x.at)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(ticks.filter((x) => x.now).map((x) => x.label)).toEqual(["现在"]);
  });

  it("一格的时间标签：按天、按分钟、实时档到秒", () => {
    const at = new Date(2026, 8, 25, 7, 5, 9).getTime();
    expect(fmtBucket(at, DAY)).toBe("9/25");
    expect(fmtBucket(at, HOUR)).toBe("9/25 07:05");
    expect(fmtBucket(at, LIVE_BUCKET_MS)).toBe("07:05:09");
  });
});

describe("趋势图和模型排行", () => {
  const since = new Date(2026, 8, 24, 0, 0).getTime();
  // 三点过五分：最后一格（3:00）刚开始
  const now = since + 3 * HOUR + 5 * 60_000;
  const models = ["a", "b", "c", "d", "e", "f", "g"];
  // a 最多、g 最少；f 和 g 合并成「其他」
  const groups = models.map((m, i) => group(since + HOUR, m, (7 - i) * 1000, (i + 1) * 100));
  const d = dashboard(since, groups);
  const base = { d, live: false, bucketMs: HOUR, rangeMs: DAY, samples: [], fails: [], now, prevStack: [], t };

  it("按 token 排：前五项各一层，其余合并成「其他」，排行从大到小", () => {
    const tr = buildTrend({ ...base, by: "token" });
    expect(tr.ranking.map((r) => r.name)).toEqual(["a", "b", "c", "d", "e", t.other]);
    expect(tr.ranking.at(-1)).toMatchObject({ merged: 2, tokens: 2000 + 1000, requests: 2 });
    // 图的层从下往上：「其他」垫底，量大的在上
    expect(tr.keys).toEqual([t.other, "e", "d", "c", "b", "a"]);
    // 最大的那层颜色最深；「其他」是灰的，不和最小的那个模型撞色；排行里同一个模型
    // 是同一个颜色
    expect(tr.colors).toEqual([
      "var(--chart-other)",
      "var(--chart-5)",
      "var(--chart-4)",
      "var(--chart-3)",
      "var(--chart-2)",
      "var(--chart-1)",
    ]);
    for (const r of tr.ranking) expect(r.color).toBe(tr.colors[tr.keys.indexOf(r.name)]);
    expect(tr.topBar).toBe(7000);
  });

  it("按费用排：次序跟着费用走", () => {
    const tr = buildTrend({ ...base, by: "cost" });
    expect(tr.ranking.slice(0, 5).map((r) => r.name)).toEqual(["g", "f", "e", "d", "c"]);
  });

  it("空桶补成 0，每一格每一层都有值", () => {
    const tr = buildTrend({ ...base, by: "token" });
    // 0:00 到 3:00，一小时一格：四格
    expect(tr.rows).toHaveLength(4);
    for (const row of tr.rows) for (const k of tr.keys) expect(typeof row[k]).toBe("number");
    expect(tr.rows[0]?.a).toBe(0);
    expect(tr.rows[1]?.a).toBe(7000);
    expect(tr.peak).toBe(28_000);
  });

  it("悬停抬头：时刻、合计，空格写「无请求」", () => {
    const tr = buildTrend({ ...base, by: "token" });
    expect(tr.tips[0]).toEqual({ title: fmtBucket(since, HOUR), value: t.tokens("0", 0), note: t.tipNone });
    expect(tr.tips[1]).toMatchObject({ value: t.tokens("28k", 28_000), note: t.tipRequests(7, 0) });
  });

  it("费用口径的图值是千分之一美元", () => {
    const tr = buildTrend({ ...base, by: "cost" });
    expect(tr.rows[1]?.g).toBe(0.7);
  });

  /**
   * 实时档的堆叠次序有滞回：两个量级接近的模型不因为一点起伏就互换位置（一换，
   * 整条带子在纵向跳过另一条，颜色也跟着换）。
   */
  describe("实时档的堆叠次序", () => {
    const at = since + HOUR;
    const live = { ...base, live: true, by: "token" as const, rangeMs: 10 * 60_000 };
    const sample = (id: number, model: string) => ({ id, at: now - 30_000, model, tokens: 100 });

    it("差不到两成：保持上一次的次序", () => {
      const d2 = dashboard(since, [group(at, "a", 1000), group(at, "b", 1150)]);
      const tr = buildTrend({ ...live, d: d2, samples: [sample(1, "a"), sample(2, "b")], prevStack: ["a", "b"] });
      expect(tr.stack).toEqual(["a", "b"]);
    });

    it("超过两成：换位", () => {
      const d2 = dashboard(since, [group(at, "a", 1000), group(at, "b", 1300)]);
      const tr = buildTrend({ ...live, d: d2, samples: [sample(1, "a"), sample(2, "b")], prevStack: ["a", "b"] });
      expect(tr.stack).toEqual(["b", "a"]);
    });

    it("格子一路铺到「现在」，失败落在它那一格上", () => {
      const tr = buildTrend({ ...live, samples: [sample(1, "a")], fails: [{ id: 9, at: now - 12_000 }] });
      expect(tr.grid).toHaveLength(121);
      expect(tr.grid.at(-1)?.at_ms).toBe(now);
      expect(tr.grid.at(-3)?.failed).toBe(1);
      expect(tr.tips.at(-1)?.note).toBeUndefined();
    });
  });
});

/**
 * 排行里费用那一格。**「没有价格」「确实不花钱」「没有用量」是三件事**，都写成
 * 一个 `$0` 或一个「—」的话，读的人分不出哪一行该去补价。
 */
describe("排行的费用", () => {
  it("全都算出来了：写金额，没有悬停；合计是零就写 $0（不计费的上游）", () => {
    expect(rankCost(rank({ cost: 1_234 }), t)).toEqual({ kind: "amount", prefix: "", notes: [] });
    expect(rankCost(rank({ cost: 0 }), t)).toEqual({ kind: "amount", prefix: "", notes: [] });
  });

  it("有用量、一条都没算出费用：「无法计价」，不写 $0", () => {
    const c = rankCost(rank({ unpriced: 5 }), t);
    expect(c.kind).toBe("unpriced");
    expect(c.notes).toEqual([t.rankUnpriced(5)]);
  });

  it("连用量都没有：「无用量」", () => {
    const c = rankCost(rank({ tokens: 0, noUsage: 2 }), t);
    expect(c.kind).toBe("noUsage");
    expect(c.notes).toEqual([t.rankNoUsage(2)]);
  });

  it("两样都有、一分钱都没算出来：算「无法计价」—— 补价修得好的那一种优先说", () => {
    const c = rankCost(rank({ unpriced: 1, noUsage: 3 }), t);
    expect(c.kind).toBe("unpriced");
    expect(c.notes).toEqual([t.rankUnpriced(1), t.rankNoUsage(3)]);
  });

  it("算出了一部分：金额是下限，写「≥」，缺的那几条写在悬停里", () => {
    expect(rankCost(rank({ cost: 500, unpriced: 2 }), t)).toEqual({
      kind: "amount",
      prefix: "≥",
      notes: [t.rankUnpriced(2)],
    });
    expect(rankCost(rank({ cost: 500, noUsage: 1 }), t)).toMatchObject({ prefix: "≥", notes: [t.rankNoUsage(1)] });
  });

  it("含估算：带「~」，估算的数写在悬停里；两样都有是「≥~」", () => {
    expect(rankCost(rank({ cost: 500, estimated: 120 }), t)).toEqual({
      kind: "amount",
      prefix: "~",
      notes: [t.estimated("$0.0001")],
    });
    expect(rankCost(rank({ cost: 500, estimated: 120, unpriced: 1 }), t)).toMatchObject({
      prefix: "≥~",
      notes: [t.estimated("$0.0001"), t.rankUnpriced(1)],
    });
  });

  describe("从哪儿数出来", () => {
    const since = new Date(2026, 8, 24, 0, 0).getTime();
    const now = since + 3 * HOUR;
    const base = { live: false, bucketMs: HOUR, rangeMs: DAY, samples: [], fails: [], now, prevStack: [], t };
    const at = since + HOUR;
    const g = (name: string, over: Partial<CostBucketGroup>): CostBucketGroup => ({ ...group(at, name, 1000), ...over });

    it("历史档：每个模型自己带着无法计价、无用量的条数和估算的金额，跨格加起来", () => {
      const d = dashboard(since, [
        g("priced", { cost_micros_exact: 900, cost_micros_estimated: 100 }),
        g("priced", { at_ms: at + HOUR, cost_micros_exact: 50 }),
        g("unpriced", { unpriced_requests: 4, requests: 4 }),
        g("free", {}),
        g("silent", { input_tokens: 0, no_usage_requests: 2, requests: 2 }),
      ]);
      const by = new Map(buildTrend({ ...base, d, by: "token" }).ranking.map((r) => [r.name, r]));
      expect(by.get("priced")).toMatchObject({ cost: 1050, estimated: 100, unpriced: 0, noUsage: 0 });
      expect(by.get("unpriced")).toMatchObject({ cost: 0, unpriced: 4, noUsage: 0 });
      expect(by.get("free")).toMatchObject({ cost: 0, unpriced: 0, noUsage: 0 });
      expect(by.get("silent")).toMatchObject({ tokens: 0, noUsage: 2 });
      expect(rankCost(by.get("unpriced")!, t).kind).toBe("unpriced");
      expect(rankCost(by.get("free")!, t)).toEqual({ kind: "amount", prefix: "", notes: [] });
      expect(rankCost(by.get("silent")!, t).kind).toBe("noUsage");
    });

    it("合并的「其他」把几项的条数加在一起：里面有无法计价的，金额就是下限", () => {
      const d = dashboard(
        since,
        ["a", "b", "c", "d", "e"].map((m, i) => g(m, { input_tokens: (10 - i) * 1000, cost_micros_exact: 100 })).concat([
          g("f", { input_tokens: 10, cost_micros_exact: 30 }),
          g("g", { input_tokens: 5, unpriced_requests: 1 }),
        ]),
      );
      const other = buildTrend({ ...base, d, by: "token" }).ranking.at(-1)!;
      expect(other).toMatchObject({ merged: 2, cost: 30, unpriced: 1 });
      expect(rankCost(other, t).prefix).toBe("≥");
    });

    it("实时档：价钱到了却是空的算无法计价，还没到的不算", () => {
      const live = { ...base, live: true, rangeMs: 10 * 60_000, d: dashboard(since, []) };
      const s = (id: number, model: string, over: Partial<LiveSample>): LiveSample => ({ id, at: now - 30_000, model, tokens: 100, ...over });
      const tr = buildTrend({
        ...live,
        by: "cost",
        samples: [
          s(1, "a", { cost: 300 }),
          s(2, "a", { cost: 200, estimated: true }),
          s(3, "b", { cost: null }),
          // 刚落地，价钱还在路上
          s(4, "b", {}),
          s(5, "c", { cost: 0 }),
        ],
      });
      const by = new Map(tr.ranking.map((r) => [r.name, r]));
      expect(by.get("a")).toMatchObject({ cost: 500, estimated: 200, unpriced: 0, requests: 2 });
      expect(by.get("b")).toMatchObject({ cost: 0, unpriced: 1, requests: 2 });
      expect(by.get("c")).toMatchObject({ cost: 0, unpriced: 0 });
    });

    it("费用口径的悬停：金额之外的条数跟在请求数后面，金额写成下限", () => {
      const d = dashboard(since, [
        g("a", { cost_micros_exact: 5_000, requests: 3, failed: 1 }),
        g("b", { unpriced_requests: 2, requests: 2 }),
        g("c", { no_usage_requests: 1, requests: 1 }),
      ]);
      const tip = buildTrend({ ...base, d, by: "cost" }).tips[1];
      expect(tip).toEqual({
        title: fmtBucket(at, HOUR),
        value: "≥$0.0050",
        note: [t.tipRequests(6, 1), t.unpriced(2), t.noUsage(1)].join(t.listSep),
      });
      // token 口径说的是用量，和价钱无关
      expect(buildTrend({ ...base, d, by: "token" }).tips[1]?.note).toBe(t.tipRequests(6, 1));
    });

    it("一格里一分钱都没算出来：合计写成词，不写「≥$0」", () => {
      const only = (over: Partial<CostBucketGroup>) =>
        buildTrend({ ...base, d: dashboard(since, [g("x", over)]), by: "cost" }).tips[1]?.value;
      expect(only({ unpriced_requests: 1 })).toBe(t.unpricedCell);
      expect(only({ input_tokens: 0, no_usage_requests: 1 })).toBe(t.noUsageCell);
      // 不计费：真的是零
      expect(only({})).toBe("$0");
    });
  });
});

describe("各模型的缓存", () => {
  it("按上下文量从大到小，跨格合计，没有上下文的不列", () => {
    const g = (name: string, read: number, plain: number, write: number): CostBucketGroup => ({
      ...group(0, name, plain),
      cache_read_tokens: read,
      cache_write_tokens: write,
    });
    const d = dashboard(0, [g("a", 80, 10, 10), g("b", 900, 50, 50), g("a", 0, 100, 0), g("", 5, 5, 0), g("z", 0, 0, 0)]);
    const rows = cacheByModel(d, t.unknownModel);
    expect(rows.map((r) => r.name)).toEqual(["b", "a", t.unknownModel]);
    expect(rows[0]).toMatchObject({ ctx: 1000, hit: 0.9 });
    expect(rows[1]).toMatchObject({ read: 80, plain: 110, write: 10, ctx: 200, hit: 0.4 });
  });
});

describe("延迟", () => {
  it("样本多的在前", () => {
    const rows = latencyRows([
      { model: "b", p50: 1, p95: 2, samples: 3 },
      { model: "a", p50: 1, p95: 2, samples: 30 },
      { model: "c", p50: 1, p95: 2, samples: 3 },
    ]);
    expect(rows.map((r) => r.model)).toEqual(["a", "b", "c"]);
  });

  it("一秒以内写毫秒，以上写秒", () => {
    expect(fmtMs(0)).toBe("0ms");
    expect(fmtMs(438.4)).toBe("438ms");
    expect(fmtMs(999)).toBe("999ms");
    expect(fmtMs(1182)).toBe("1.18s");
    expect(fmtMs(12_345)).toBe("12.3s");
    expect(fmtMs(123_456)).toBe("123s");
  });
});

describe("模型的厂商标志", () => {
  it("按名字认", () => {
    expect(modelGlyph("claude-sonnet-5")).toBe("claude");
    expect(modelGlyph("gpt-5.5-codex")).toBe("openai");
    expect(modelGlyph("o3-mini")).toBe("openai");
    expect(modelGlyph("openai/gpt-oss-120b")).toBe("openai");
    expect(modelGlyph("gemini-2.5-pro")).toBe("gemini");
    expect(modelGlyph("deepseek-chat")).toBe("deepseek");
    expect(modelGlyph("qwen/qwen3-coder")).toBe("qwen");
    expect(modelGlyph("glm-4.6")).toBe("zhipu");
  });

  it("认不出来是 null（画首字母方块）", () => {
    expect(modelGlyph("llama3.1:8b")).toBeNull();
    expect(modelGlyph("未知模型")).toBeNull();
  });
});
