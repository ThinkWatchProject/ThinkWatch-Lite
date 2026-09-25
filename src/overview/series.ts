import { compact, densify } from "@/format";
import type { ChartTip } from "@/ui/charts";
import { upstreamGlyph, type GlyphId } from "@/ui/logos";
import { usd, type CostBucket, type Dashboard, type LatencyView } from "@/types";
import { LIVE_BUCKET_MS, LIVE_REACH_MS, liveRate, type LiveFail, type LiveSample } from "./useLive";
import type { overviewText } from "./overview.i18n";

/**
 * 概览上那张图和几张排行的数，从一份 `Dashboard`（和实时档的样本）算出来。
 *
 * **抽成纯函数是为了能测。**堆叠次序的滞回、纵轴上界的钉住、刻度落在哪一刻，
 * 写在 JSX 里没有任何东西会回答「边界上会不会来回跳」。
 */

type Text = (typeof overviewText)["zh"];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 图的口径 */
export type Metric = "token" | "cost";

/**
 * 图里最多分几层。**只保留前五项，其余合并为「其他」** —— 一个上游可能报出
 * 十几个模型名，十几层叠在两百像素里已经分辨不出，而排在后面的那些合计往往
 * 不到百分之一。
 */
export const LAYERS = 5;

/** 每一张排行最多列几项。超出的写出来有几项，**不静默丢掉**。 */
export const ROWS = 6;

/** 纵轴上界的档位（× 10ⁿ）。**每一档的一半也是整齐的数**：刻度写的是上界和它的一半 */
const COARSE = [1, 2, 5, 10];
const FINE = [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10];

/**
 * 往上取到最近的一档。
 *
 * 历史档用细的那套（`fine`）：1/2/5 三档之间差着一倍多，峰值刚过 2 就得取 5，
 * 图只占下面四成，上面一大片空着。细档下最坏也占到四分之三。实时档用粗的：
 * 曲线每半秒都在动，档位越密，尺子换得越勤（见 `holdY`）。
 */
export function niceCeil(v: number, fine = false): number {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  // 浮点：0.3 / 0.1 = 2.9999999999999996，3 / 1 这类要落在「3」这一档上
  const step = (fine ? FINE : COARSE).find((s) => m <= s * (1 + 1e-9)) ?? 10;
  return step * e;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 一格的时间标签。跨度大到按天分格时就只写日期。
 *
 * 不到一分钟的格子（实时档）**写到秒，也带上小时**：只写「07:12」读起来
 * 像七点十二分，而十分钟的窗口随时会跨过整点。
 */
export function fmtBucket(atMs: number, bucketMs: number): string {
  const t = new Date(atMs);
  if (bucketMs >= DAY) return `${t.getMonth() + 1}/${t.getDate()}`;
  if (bucketMs < 60_000) return `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  return `${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/** 一格里四类 token 的合计 */
function tokensOf(b: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}): number {
  return b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens;
}

/** 排行里的一行，也是图里的一层 */
export interface RankRow {
  /** 模型名；合并的那一行是 `Text.other` */
  name: string;
  /** 合并了几项。单个模型是 0 */
  merged: number;
  tokens: number;
  /** 微分：实测加估算 */
  cost: number;
  /** 其中估算的那部分，微分 */
  estimated: number;
  /** 有用量、模型却不在价目表里的请求：费用不在 `cost` 里 */
  unpriced: number;
  /** 没有拿到用量的请求：费用算不出来，也不在 `cost` 里 */
  noUsage: number;
  requests: number;
  /** 图里那一层的颜色 */
  color: string;
}

/**
 * 排行里费用那一格写什么。**一个数或一个词，说明进悬停**，和会话的费用那一格
 * （`costCell`）同一套写法：
 *
 * · 有用量、却一条都没算出费用：「无法计价」。**不写 $0** —— 那是在说它不花钱。
 * · 连用量都没有：「无用量」。
 * · 其余写金额。有算不出来的请求时金额只是下限，写成「≥」；含估算的带「~」。
 *   全都算出来了、合计是零时写 $0：不计费的上游（本地模型）就是这样，它说的是真的。
 *
 * `notes` 是悬停里的几句话，一句一段；空的就没有悬停。
 */
export function rankCost(
  r: Pick<RankRow, "cost" | "estimated" | "unpriced" | "noUsage">,
  t: Text,
): { kind: "amount" | "unpriced" | "noUsage"; prefix: string; notes: string[] } {
  // 金额之外的请求，各说各的
  const outside = [
    ...(r.unpriced > 0 ? [t.rankUnpriced(r.unpriced)] : []),
    ...(r.noUsage > 0 ? [t.rankNoUsage(r.noUsage)] : []),
  ];
  if (r.cost === 0 && r.unpriced > 0) return { kind: "unpriced", prefix: "", notes: outside };
  if (r.cost === 0 && r.noUsage > 0) return { kind: "noUsage", prefix: "", notes: outside };
  const estimated = r.estimated > 0;
  return {
    kind: "amount",
    prefix: costPrefix(outside.length > 0, estimated),
    notes: [...(estimated ? [t.estimated(usd(r.estimated))] : []), ...outside],
  };
}

/**
 * 金额前面的记号：缺了算不出来的请求，金额只是下限（「≥」）；**估算不能冒充实测**，
 * 含估算的带「~」。
 */
function costPrefix(incomplete: boolean, estimated: boolean): string {
  return (incomplete ? "≥" : "") + (estimated ? "~" : "");
}

/** 一格的费用写成一个词或一个带记号的金额，和排行那一格同一套（`rankCost`） */
function bucketCost(g: CostBucket, t: Text): string {
  const cost = g.cost_micros_exact + g.cost_micros_estimated;
  const c = rankCost(
    { cost, estimated: g.cost_micros_estimated, unpriced: g.unpriced_requests, noUsage: g.no_usage_requests },
    t,
  );
  return c.kind === "unpriced" ? t.unpricedCell : c.kind === "noUsage" ? t.noUsageCell : c.prefix + usd(cost);
}

export interface Trend {
  /** 图的每一格：`label` 是这一格的时刻（横轴的键，每格不同），其余键是各层的值 */
  rows: Record<string, number | string>[];
  /** 每一格的悬停抬头，和 `rows` 一一对应（见 `ChartTip`） */
  tips: ChartTip[];
  /** 图的层，**从下往上** */
  keys: string[];
  colors: string[];
  /** 排行，按当前口径从大到小；合并的「其他」在最后 */
  ranking: RankRow[];
  /** 排行的条长按它归一：当前口径里最大的那一项 */
  topBar: number;
  /** 格子本身（历史档是后端给的桶，补过空桶）。`failed` 画在基线上 */
  grid: CostBucket[];
  /** 各格总高的最大值，定纵轴用 */
  peak: number;
  /** 这一次的堆叠次序，下一次比着它换位（实时档） */
  stack: string[];
}

/**
 * 图里的层从下往上的颜色。**同一个色相的深浅**，占得多的在上、颜色最深。
 */
const SHADES = ["var(--chart-5)", "var(--chart-4)", "var(--chart-3)", "var(--chart-2)", "var(--chart-1)"];
/**
 * 合并的「其他」那一层是灰的。它不是一个模型，**不该和排在第五的那个模型同色**
 * —— 两层同色叠在一起，就读成了一层。
 */
const OTHER = "var(--chart-other)";

export function buildTrend({
  d,
  live,
  by,
  bucketMs,
  rangeMs,
  samples,
  fails,
  now,
  prevStack,
  t,
}: {
  d: Dashboard;
  live: boolean;
  by: Metric;
  /** 历史档的格宽 */
  bucketMs: number;
  /** 实时档的窗口 */
  rangeMs: number;
  samples: readonly LiveSample[];
  fails: readonly LiveFail[];
  now: number;
  /** 上一次的堆叠次序（实时档的滞回） */
  prevStack: readonly string[];
  t: Text;
}): Trend {
  const tokensMode = by === "token";
  /*
    实时档的格子**不对齐格宽的整数倍**：最右边那一格就是此刻，往左每格
    五秒。对齐的话，格子只在跨过边界的那一帧整体挪一格，曲线于是每五秒
    跳一次；而高斯核在任意时刻都求得出值，格子没有必须落在边界上的理由。

    **两头都算**：十分钟是一百二十段、一百二十一个点，最左边那个点正好是
    十分钟前。
  */
  const liveSpan = Math.round(rangeMs / LIVE_BUCKET_MS) + 1;
  const liveAt = live
    ? Array.from({ length: liveSpan }, (_, i) => now - (liveSpan - 1 - i) * LIVE_BUCKET_MS)
    : [];
  const byBucket = new Map<number, Map<string, number>>();
  const money = new Map<string, number>();
  const estimated = new Map<string, number>();
  const unpriced = new Map<string, number>();
  const noUsage = new Map<string, number>();
  const volume = new Map<string, number>();
  const count = new Map<string, number>();
  const add = (at: number, name: string, v: number) => {
    const slot = byBucket.get(at) ?? new Map<string, number>();
    slot.set(name, (slot.get(name) ?? 0) + v);
    byBucket.set(at, slot);
  };
  const bump = (m: Map<string, number>, name: string, v: number) => {
    if (v !== 0) m.set(name, (m.get(name) ?? 0) + v);
  };
  if (live) {
    /*
      **一条请求摊成一个高斯鼓包，不是一根针也不是一个方块。**核归一到总
      权重 1，所以摊完之后每一格读作速率：token 口径是 token/秒，费用口径
      乘 3600 换成每小时。

      排行和总量不走这条路：它们数的是这段时间里实际发生的量，一条请求只算
      一次。核在**格子的时刻**上求值，不在「第几格」上求值 —— 这样格子挪到
      哪儿都对得上，曲线是平移的。
    */
    const from = liveAt[0] ?? 0;
    for (const x of samples) {
      volume.set(x.model, (volume.get(x.model) ?? 0) + x.tokens);
      money.set(x.model, (money.get(x.model) ?? 0) + (x.cost ?? 0));
      count.set(x.model, (count.get(x.model) ?? 0) + 1);
      if (x.estimated) bump(estimated, x.model, x.cost ?? 0);
      // 价钱到了却是空的：模型未定价。还没到的（`undefined`）不算
      if (x.cost === null) bump(unpriced, x.model, 1);
      const amount = tokensMode ? x.tokens : (x.cost ?? 0) * 3600;
      // 只碰核够得着的那几格
      const lo = Math.max(0, Math.ceil((x.at - LIVE_REACH_MS - from) / LIVE_BUCKET_MS));
      const hi = Math.min(liveAt.length - 1, Math.floor((x.at + LIVE_REACH_MS - from) / LIVE_BUCKET_MS));
      for (let i = lo; i <= hi; i++) {
        const at = liveAt[i];
        if (at !== undefined) add(at, x.model, liveRate(amount, at - x.at));
      }
    }
  } else {
    for (const b of d.buckets_by_model) {
      const name = b.name || t.unknownModel;
      const cost = b.cost_micros_exact + b.cost_micros_estimated;
      const tok = tokensOf(b);
      money.set(name, (money.get(name) ?? 0) + cost);
      volume.set(name, (volume.get(name) ?? 0) + tok);
      count.set(name, (count.get(name) ?? 0) + b.requests);
      bump(estimated, name, b.cost_micros_estimated);
      bump(unpriced, name, b.unpriced_requests);
      bump(noUsage, name, b.no_usage_requests);
      add(b.at_ms, name, tokensMode ? tok : cost);
    }
  }

  /*
    **堆叠的次序不跟着实时窗口走。**按窗口内的用量排的话，几个模型量级接近时
    排名一两秒就翻一次 —— 一翻，整条带子在纵向跳过另一条，颜色还跟着换。
    所以实时档按**最近 24 小时**的用量定次序（那份数据本来就在手上，只随慢
    刷新变）。量相同时按名字定，免得 Map 的插入顺序泄漏进来。
  */
  const steady = new Map<string, number>();
  if (live) {
    for (const b of d.buckets_by_model) {
      const name = b.name || t.unknownModel;
      const v = tokensMode ? tokensOf(b) : b.cost_micros_exact + b.cost_micros_estimated;
      steady.set(name, (steady.get(name) ?? 0) + v);
    }
  }
  // 排行按当前口径排 —— 切到 token 之后，费用最高的那个未必是用得最多的。
  // **这是给人读的列表，它就该从大到小**，和图的堆叠次序不是一回事
  const here = tokensMode ? volume : money;
  const ranked = [...here.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, LAYERS).map(([name]) => name);
  const rest = ranked.slice(LAYERS);

  /*
    图里的堆叠次序另算：**占得少的垫底、占得多的在上**，颜色跟着走。实时档
    记住的次序里还在的那些保持相对位置，新出现的按量插进去；之后只在一个模型
    **明显**超过它上一名（两成）时才换位。实测按窗口排十分钟里换位 145 次，
    有了门槛才降到接近零。
  */
  const val = (m: string) => (live ? steady : here).get(m) ?? 0;
  const byVolume = [...top].sort((a, b) => val(b) - val(a) || a.localeCompare(b));
  let stacked = byVolume;
  if (live) {
    const kept = prevStack.filter((m) => top.includes(m));
    for (const m of byVolume) if (!kept.includes(m)) kept.splice(byVolume.indexOf(m), 0, m);
    for (let i = kept.length - 1; i > 0; i--) {
      const up = kept[i - 1];
      const down = kept[i];
      if (up === undefined || down === undefined) continue;
      if (val(down) > val(up) * 1.2) {
        kept[i - 1] = down;
        kept[i] = up;
      }
    }
    stacked = kept;
  }
  const otherKey = t.other;
  const models = [...stacked].reverse();
  const keys = rest.length > 0 ? [otherKey, ...models] : models;
  const colors = [
    ...(rest.length > 0 ? [OTHER] : []),
    ...models.map((_, i) => SHADES[SHADES.length - models.length + i] ?? "var(--chart-1)"),
  ];
  // **色块按名字查。**列表按用量排、图按堆叠次序排，两边要对得上同一个色
  const colorOf = new Map(keys.map((k, i) => [k, colors[i] ?? "var(--chart-1)"]));

  const sum = (m: Map<string, number>) => rest.reduce((a, x) => a + (m.get(x[0]) ?? 0), 0);
  const ranking: RankRow[] = top.map((name) => ({
    name,
    merged: 0,
    tokens: volume.get(name) ?? 0,
    cost: money.get(name) ?? 0,
    estimated: estimated.get(name) ?? 0,
    unpriced: unpriced.get(name) ?? 0,
    noUsage: noUsage.get(name) ?? 0,
    requests: count.get(name) ?? 0,
    color: colorOf.get(name) ?? "var(--chart-1)",
  }));
  if (rest.length > 0)
    ranking.push({
      name: otherKey,
      merged: rest.length,
      tokens: sum(volume),
      cost: sum(money),
      estimated: sum(estimated),
      unpriced: sum(unpriced),
      noUsage: sum(noUsage),
      requests: sum(count),
      color: OTHER,
    });
  // 条长按当前口径里**最大的那一项**归一。按总量归一的话，一个占七成的模型会
  // 把其余几条压成看不见的短线，而排行要比的正是它们的差距
  const topBar = Math.max(1, ...ranking.map((r) => (tokensMode ? r.tokens : r.cost)));

  /*
    实时档的格子自己铺：十分钟、五秒一格，一路铺到「现在」。历史档沿用后端给的
    桶 —— 空桶由 `densify` 补成 0，这是面积图不会把空档画成「连续在用」的前提。
  */
  const grid: CostBucket[] = live
    ? liveAt.map((at_ms) => ({
        at_ms,
        requests: 0,
        failed: 0,
        cost_micros_exact: 0,
        cost_micros_estimated: 0,
        unpriced_requests: 0,
        no_usage_requests: 0,
      }))
    : densify(d.buckets, d.since_ms, now, bucketMs);
  if (live) {
    const from = liveAt[0] ?? 0;
    for (const f of fails) {
      const g = grid[Math.round((f.at - from) / LIVE_BUCKET_MS)];
      if (g) g.failed += 1;
    }
  }
  const stepMs = live ? LIVE_BUCKET_MS : bucketMs;
  let peak = 0;
  const tips: ChartTip[] = [];
  const rows = grid.map((g) => {
    const slot = byBucket.get(g.at_ms);
    const total = [...(slot?.values() ?? [])].reduce((a, v) => a + v, 0);
    const at = fmtBucket(g.at_ms, stepMs);
    /*
      **实时档读的是速率，不是那一格的量**（见 `liveRate`）；历史档是这一格的
      合计，下面补一句这一格有几次请求 —— 空的那格说「无请求」，而不是一排 0。
    */
    tips.push(
      live
        ? {
            title: at,
            value: tokensMode ? t.tokenRate(compact(Math.round(total))) : t.costRate(usd(Math.round(total))),
          }
        : {
            title: at,
            value: tokensMode ? t.tokens(compact(Math.round(total)), total) : bucketCost(g, t),
            note:
              g.requests === 0
                ? t.tipNone
                : [
                    t.tipRequests(g.requests, g.failed),
                    // 费用口径下，金额之外的那几条也说出来：和上面费用那个大数的限定语同一套说法
                    ...(!tokensMode && g.unpriced_requests > 0 ? [t.unpriced(g.unpriced_requests)] : []),
                    ...(!tokensMode && g.no_usage_requests > 0 ? [t.noUsage(g.no_usage_requests)] : []),
                  ].join(t.listSep),
          },
    );
    // `label` 是横轴的键：每一格各不相同（到分钟，实时档到秒），「现在」那一点靠它找位置
    const row: Record<string, number | string> = { label: at };
    let other = 0;
    let height = 0;
    for (const [name, v] of slot ?? []) {
      // 费用从微分换成千分之一美元：纵轴上那几位小数没有意义
      const y = tokensMode ? v : v / 1000;
      height += y;
      if (top.includes(name)) row[name] = y;
      else other += y;
    }
    // 没有值的那几层要显式给 0，否则 recharts 会把这一格整条断开
    for (const k of top) row[k] ??= 0;
    if (rest.length > 0) row[otherKey] = other;
    peak = Math.max(peak, height);
    return row;
  });

  return { rows, tips, keys, colors, ranking, topBar, grid, peak, stack: stacked };
}

/**
 * 纵轴的上界。**不跟着每一帧的峰值走**：自动域下，一个大请求进出窗口就让整条
 * 曲线连同刻度一起上下弹 —— 看起来像图在抖，其实抖的是尺子。所以上界取一个
 * 整齐的数（1/2/5 档），而且只在实际峰值掉到它一半以下时才降档。口径和区间一
 * 换（`key` 变了），量级差几个数量级，得重新起。
 */
export function holdY(
  prev: { key: string; v: number },
  key: string,
  peak: number,
  fine = false,
): { key: string; v: number } {
  const base = prev.key === key ? prev : { key, v: 0 };
  if (peak > base.v || peak < base.v * 0.5) return { key, v: niceCeil(peak * 1.08, fine) };
  return base;
}

/** 图下面的一个刻度：`at` 是它在画图区域里的横向位置（0…1） */
export interface Tick {
  at: number;
  label: string;
  /** 「现在」那一个。实时档里它是亮的 */
  now?: boolean;
}

/** 下一个本地的整 `hours` 小时（0 点起算） */
function nextHour(ms: number, hours: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  do {
    d.setHours(d.getHours() + 1);
  } while (d.getHours() % hours !== 0 || d.getTime() <= ms);
  return d.getTime();
}

/** 下一个本地零点 */
function nextMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * 历史档图下面的刻度：起点、「现在」，中间落在**本地的整点或零点**上。
 *
 * **刻度标在它说的那个时刻的正下方。**用 `justify-between` 排开的话，每个字落在
 * 哪儿取决于前后几个字有多宽，而不是它说的是几点。离两头太近的不写，免得和起点
 * 或「现在」挤在一起。
 *
 * `n` 是格数：图上的点按格等距排开，第一个点是第一格的起点，最后一个点是最后
 * 一格的起点。
 */
export function historyTicks(sinceMs: number, bucketMs: number, n: number, nowLabel: string): Tick[] {
  const first: Tick = { at: 0, label: fmtBucket(sinceMs, bucketMs) };
  const last: Tick = { at: 1, label: nowLabel, now: true };
  const span = (n - 1) * bucketMs;
  if (!(span > 0)) return [first, last];
  const hourSteps = [1, 2, 3, 4, 6, 12];
  const daySteps = [1, 2, 5, 7, 14];
  const inner: Tick[] = [];
  const push = (at: number, label: string) => {
    const x = (at - sinceMs) / span;
    if (x > 0.12 && x < 0.88) inner.push({ at: x, label });
  };
  const h = hourSteps.find((s) => span / (s * HOUR) <= 7);
  if (h !== undefined) {
    for (let at = nextHour(sinceMs, h); at < sinceMs + span; at = nextHour(at, h)) {
      const d = new Date(at);
      // 零点写日期：「00:00」不如「9/25」说得清是哪一天
      push(at, d.getHours() === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : `${pad(d.getHours())}:00`);
    }
  } else {
    const k = daySteps.find((s) => span / (s * DAY) <= 7) ?? 30;
    let at = nextMidnight(sinceMs);
    let i = 0;
    while (at < sinceMs + span) {
      if (i % k === 0) {
        const d = new Date(at);
        push(at, `${d.getMonth() + 1}/${d.getDate()}`);
      }
      at = nextMidnight(at);
      i += 1;
    }
  }
  return [first, ...inner, last];
}

/** 实时档图下面的刻度：固定的几个「N 分钟」，最后是亮着的「现在」 */
export function liveTicks(labels: readonly string[], nowLabel: string): Tick[] {
  const all = [...labels, nowLabel];
  return all.map((label, i) => ({ at: i / (all.length - 1), label, ...(i === all.length - 1 ? { now: true } : {}) }));
}

/** 一个模型在缓存上的构成 */
export interface CacheRow {
  name: string;
  read: number;
  plain: number;
  write: number;
  /** 送往上游的上下文：三者之和 */
  ctx: number;
  /** 命中率 */
  hit: number;
}

/**
 * 各模型的缓存构成，按上下文量从大到小。
 *
 * **率，不是累计量**：要回答的是「哪个模型的缓存没起作用」。没有上下文的模型
 * 不列（命中率无从谈起）。
 */
export function cacheByModel(d: Dashboard, unknownModel: string): CacheRow[] {
  const by = new Map<string, { read: number; plain: number; write: number }>();
  for (const b of d.buckets_by_model) {
    const name = b.name || unknownModel;
    const x = by.get(name) ?? { read: 0, plain: 0, write: 0 };
    x.read += b.cache_read_tokens;
    x.plain += b.input_tokens;
    x.write += b.cache_write_tokens;
    by.set(name, x);
  }
  return [...by.entries()]
    .map(([name, x]) => {
      const ctx = x.read + x.plain + x.write;
      return { name, ...x, ctx, hit: ctx > 0 ? x.read / ctx : 0 };
    })
    .filter((r) => r.ctx > 0)
    .sort((a, b) => b.ctx - a.ctx || a.name.localeCompare(b.name));
}

/** 延迟排行：样本多的在前（样本少的分位数不可靠，放后面） */
export function latencyRows(rows: readonly LatencyView[]): LatencyView[] {
  return [...rows].sort((a, b) => b.samples - a.samples || a.model.localeCompare(b.model));
}

/**
 * 一段延迟怎么写。一秒以内写毫秒，以上写秒、留两位有效的小数。
 *
 * **不写成 `1,182ms`**：并排两列四位数的毫秒要逐位读，而「1.18s」一眼就是一秒出头
 * —— 这一栏要比的是快慢的量级和差距，不是个位上的那几毫秒（精确值在流量里）。
 */
export function fmtMs(ms: number): string {
  const n = Math.max(0, Math.round(ms));
  if (n < 1000) return `${n}ms`;
  if (n < 10_000) return `${(n / 1000).toFixed(2)}s`;
  if (n < 100_000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n / 1000)}s`;
}

/**
 * 模型是哪家的。**按名字认**：模型没有地址可看。Claude 用 Claude 的标志而不是
 * Anthropic 的字母，o 系列和 GPT、Codex 归 OpenAI；其余交给上游那一套名字规则
 * （`qwen/qwen3-coder` 这种带厂商前缀的也认）。认不出来返回 `null`，画首字母方块。
 */
export function modelGlyph(model: string): GlyphId | null {
  const m = model.toLowerCase();
  if (/claude/.test(m)) return "claude";
  if (/(^|\/)(o\d|gpt|chatgpt|codex)/.test(m)) return "openai";
  return upstreamGlyph({ name: m });
}
