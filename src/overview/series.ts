import { densify, monthDay } from "@/format";
import { costPrefix } from "@/traffic/costCell";
import { usd, type CostBucket, type CostBucketGroup, type Dashboard, type ProviderView, type Summary } from "@/types";
import { LIVE_BUCKET_MS, LIVE_REACH_MS, liveRate, type LiveEnd, type LiveSample } from "./useLive";
import type { overviewText } from "./overview.i18n";

/**
 * 概览上用量那张卡片、提醒、明细表的数，从一份 `Dashboard`（和实时档的样本）算出来。
 *
 * **抽成纯函数是为了能测。**格子怎么对齐、一格的提示怎么写、失败归给谁，写在
 * JSX 里没有任何东西会回答「边界上对不对」。
 */

type Text = (typeof overviewText)["zh"];

/** 明细表先列几行。超出的写出来有几项，**不静默丢掉** */
export const ROWS = 6;

// ───────────────────────────────────────────── 格子

/**
 * 用量大图的格子。
 *
 * 历史档（`bucket`）：`at` 是每一格的起点，一格管 `[at, at + step)`，和 core 分格的
 * 算法一致（`since + k × step`）。实时档（`instant`）：`at` 是那一刻，最右边那一个就是
 * 现在，往左每格十秒 —— **不对齐格宽的整数倍**，曲线才是平移过去的（见 `liveSeries`）。
 */
export interface Grid {
  at: number[];
  step: number;
  kind: "bucket" | "instant";
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 一格的悬停抬头：这一格是哪一段时间。
 *
 * · 实时档是那一刻，写到秒：十分钟的窗口里分钟不够分。
 * · 几小时一格的写起止（「14:00–15:00」），还没过完的那一格止于「现在」。图跨过一天
 *   以上时前面带上日期 —— 24 小时的图不带：「14:00」只有一个。
 * · 一天一格写那一天，更宽的写起止两天。**按天的格子写离起点最近的那一天**：格子是从
 *   本地零点起按固定毫秒数数的，过了夏令时切换，起点会落在前一天的 23 点。
 */
export function slotTitle(g: Grid, i: number, now: number, nowLabel: string): string {
  const at = g.at[i];
  if (at === undefined) return "";
  if (g.kind === "instant") {
    const d = new Date(at);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const end = at + g.step;
  if (g.step >= DAY) {
    const day = monthDay(at + 12 * HOUR);
    if (g.step === DAY) return day;
    return `${day}–${end > now ? nowLabel : monthDay(end - 12 * HOUR)}`;
  }
  const first = g.at[0] ?? at;
  const span = (g.at[g.at.length - 1] ?? at) + g.step - first;
  const range = `${hm(at)}–${end > now ? nowLabel : hm(end)}`;
  return span > DAY + HOUR ? `${monthDay(at)} ${range}` : range;
}

/** 大图上的几样数：每一格一个 */
export interface Series {
  grid: Grid;
  /**
   * 每一格四类 token 的合计。实时档是速率（token/秒）。取不到时是 `null`：**取不到不是
   * 零**，画成一排贴底的柱子就是编了一段「没有用」
   */
  tokens: number[] | null;
  /** 每一格的费用，微分。实时档是每小时的速率。取不到是 `null` */
  cost: number[] | null;
  /** 每一格的请求数和其中失败的。取不到是 `null` */
  requests: number[] | null;
  failed: number[] | null;
}

/**
 * 历史档多出的几样：缓存、首 token、流量的图，和悬停提示要拆开说的那几样。**只有历史档有**
 * —— 实时档的十分钟里撑不起有意义的命中率和分位，这几样在实时档也按 24 小时画。
 */
export interface HistorySeries extends Series {
  /** 补过空桶的格子本身：悬停提示要拆开说一格（输入与输出、费用的限定词、缓存的三段） */
  cells: CostBucket[];
  /** 每一格的输出 token。取不到是 `null` */
  output: number[] | null;
  /**
   * 每一格的缓存命中率（0–1）。**没有上下文的格子是 `null`**：命中率无从谈起，不是 0%。
   * 取不到是 `null`
   */
  hit: (number | null)[] | null;
  /**
   * 每一格第一个 token 到的时刻的 P50 / P95，毫秒。**没有样本的格子是 `null`**（那一小时
   * 没有流式请求）：不是 0 毫秒，图上那一段用虚线跨过去。取不到是 `null`
   */
  p50: (number | null)[] | null;
  p95: (number | null)[] | null;
  /** 每一格发给上游、从上游收到的字节。取不到是 `null` */
  sent: number[] | null;
  received: number[] | null;
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

/**
 * 历史档：后端给的桶，补过空桶（`densify`）。**空桶是实打实的 0**：一天里没用的那几个
 * 小时，柱子空着 —— 跳过的话，两边的数据会把空档挤没，看起来就是一直在用。命中率和
 * 首 token 例外：空桶**无从谈起**，是 `null`，不是 0% 或 0 毫秒。
 *
 * `until` 是图的右端：**`range.to ?? 现在`**。「某一天」画到那一天的终点，别的区间画到现在。
 *
 * 每一样都是整格的（`buckets`）。取不到桶时每一样都是 `null`（`cells` 照样排出来）。
 */
export function historySeries(d: Dashboard, until: number, bucketMs: number): HistorySeries {
  const cells = densify(d.buckets ?? [], d.since_ms, until, bucketMs);
  const grid: Grid = { at: cells.map((c) => c.at_ms), step: bucketMs, kind: "bucket" };
  const of = <T>(f: (c: (typeof cells)[number]) => T): T[] | null => (d.buckets !== null ? cells.map(f) : null);
  return {
    grid,
    cells,
    tokens: of(tokensOf),
    output: of((c) => c.output_tokens),
    cost: of((c) => c.cost_micros_exact + c.cost_micros_estimated),
    requests: of((c) => c.requests),
    failed: of((c) => c.failed),
    hit: of((c) => cacheOf(c).hit),
    p50: of((c) => c.ttft_p50_ms ?? null),
    p95: of((c) => c.ttft_p95_ms ?? null),
    sent: of((c) => c.sent_bytes),
    received: of((c) => c.received_bytes),
  };
}

/** 实时档的十分钟里一共多少：卡片上的大数 */
export interface LiveTotals {
  tokens: number;
  output: number;
  /** 微分。价钱到了的那些 */
  cost: number;
  /** 其中估算的 */
  estimated: number;
  /** 价钱到了却是空的（模型未定价）：费用不在 `cost` 里 */
  unpriced: number;
  /** 价钱还没到的（`request_priced` 在路上）：**不当成 $0**，金额写成下限 */
  pending: number;
  requests: number;
  failed: number;
}

/**
 * 实时档：十分钟，十秒一格，最右边那一格就是现在。
 *
 * **线是速率，柱是个数。**token 和费用的线把每一条请求摊成一个高斯鼓包（`liveRate`），
 * 读作 token/秒、$/小时：一格只数它自己那十秒的话，画出来是一排针。请求柱数的是每一格
 * 那十秒里结束了几次、失败了几次 —— 个数本来就是离散的，柱子正合适。
 *
 * 格子不对齐格宽的整数倍：最右边那一格就是此刻，往左每格十秒。高斯核在任意时刻都求得
 * 出值，格子跟着时间走，曲线是平移的，不会每十秒跳一格。
 *
 * 大数（`totals`）数的是这十分钟里实际发生的量，一条请求只算一次；样本多留着一个核宽
 * （左端那几格的鼓包有一半来自图外），不算进大数。
 */
export function liveSeries(
  samples: readonly LiveSample[],
  ends: readonly LiveEnd[],
  now: number,
  rangeMs: number,
): Series & { totals: LiveTotals } {
  const n = Math.round(rangeMs / LIVE_BUCKET_MS) + 1;
  const at = Array.from({ length: n }, (_, i) => now - (n - 1 - i) * LIVE_BUCKET_MS);
  const from = at[0] ?? now;
  const tokens = at.map(() => 0);
  const cost = at.map(() => 0);
  const requests = at.map(() => 0);
  const failed = at.map(() => 0);
  const totals: LiveTotals = { tokens: 0, output: 0, cost: 0, estimated: 0, unpriced: 0, pending: 0, requests: 0, failed: 0 };
  const cut = now - rangeMs;
  for (const x of samples) {
    // 只碰核够得着的那几格
    const lo = Math.max(0, Math.ceil((x.at - LIVE_REACH_MS - from) / LIVE_BUCKET_MS));
    const hi = Math.min(n - 1, Math.floor((x.at + LIVE_REACH_MS - from) / LIVE_BUCKET_MS));
    for (let i = lo; i <= hi; i++) {
      const t = at[i] ?? 0;
      tokens[i]! += liveRate(x.tokens, t - x.at);
      if (typeof x.cost === "number") cost[i]! += liveRate(x.cost, t - x.at) * 3600;
    }
    if (x.at < cut || x.at > now) continue;
    totals.tokens += x.tokens;
    totals.output += x.output;
    if (typeof x.cost === "number") {
      totals.cost += x.cost;
      if (x.estimated) totals.estimated += x.cost;
    } else if (x.cost === null) totals.unpriced += 1;
    else totals.pending += 1;
  }
  for (const e of ends) {
    if (e.at < cut || e.at > now) continue;
    totals.requests += 1;
    if (e.failed) totals.failed += 1;
    // 这一格管它前面那十秒：(at - 10s, at]
    const i = Math.ceil((e.at - from) / LIVE_BUCKET_MS);
    if (i >= 0 && i < n) {
      requests[i]! += 1;
      if (e.failed) failed[i]! += 1;
    }
  }
  return { grid: { at, step: LIVE_BUCKET_MS, kind: "instant" }, tokens, cost, requests, failed, totals };
}

// ───────────────────────────────────────────── 一格里排前几的模型

/** 悬停提示里列几个模型，其余合成「其他」一行 */
export const TIP_MODELS = 3;

/** 一格里一个模型的量（或者合起来的「其他」） */
export interface ModelShare {
  /** 空串：没有模型名 */
  name: string;
  /** token 数（实时档是速率） */
  tokens: number;
  /** 微分（实时档是每小时的速率）：实测加估算 */
  cost: number;
  estimated: number;
  unpriced: number;
  noUsage: number;
}

/** 排在前面的几个，和其余的合计（`count` 个模型）。一个都没有时两样都是空的 */
export interface TopModels {
  top: ModelShare[];
  other: (ModelShare & { count: number }) | null;
}

/**
 * 按 token 或费用排，前 `TIP_MODELS` 个单列，其余合成一行。**是零的不列**：一格里没用上
 * 的模型不该占一行；费用排的时候，金额是零却有说不出价钱的请求（无法计价、无用量）的
 * 照样列出 —— 那一行写的是「无法计价」，不是 $0。一样多的按名字排，次序不跳。
 */
function rankModels(rows: ModelShare[], by: "tokens" | "cost"): TopModels {
  const kept = rows.filter((r) => (by === "tokens" ? r.tokens > 0 : r.cost > 0 || r.unpriced > 0 || r.noUsage > 0));
  kept.sort((a, b) => b[by] - a[by] || b.tokens - a.tokens || a.name.localeCompare(b.name));
  const top = kept.slice(0, TIP_MODELS);
  const rest = kept.slice(TIP_MODELS);
  if (rest.length === 0) return { top, other: null };
  const other = { name: "", tokens: 0, cost: 0, estimated: 0, unpriced: 0, noUsage: 0, count: rest.length };
  for (const r of rest) {
    other.tokens += r.tokens;
    other.cost += r.cost;
    other.estimated += r.estimated;
    other.unpriced += r.unpriced;
    other.noUsage += r.noUsage;
  }
  return { top, other };
}

/**
 * 历史档一格里排前几的模型（`buckets_by_model` 里起点是 `at` 的那几行）。取不到按模型分的
 * 那一份时是 `null`：提示里就不列模型，不写「没有模型」。
 */
export function cellModels(
  groups: readonly CostBucketGroup[] | null | undefined,
  at: number,
  by: "tokens" | "cost",
): TopModels | null {
  if (!groups) return null;
  const by_ = new Map<string, ModelShare>();
  for (const g of groups) {
    if (g.at_ms !== at) continue;
    const r = by_.get(g.name) ?? { name: g.name, tokens: 0, cost: 0, estimated: 0, unpriced: 0, noUsage: 0 };
    r.tokens += tokensOf(g);
    r.cost += g.cost_micros_exact + g.cost_micros_estimated;
    r.estimated += g.cost_micros_estimated;
    r.unpriced += g.unpriced_requests;
    r.noUsage += g.no_usage_requests;
    by_.set(g.name, r);
  }
  return rankModels([...by_.values()], by);
}

/**
 * 实时档某一刻排前几的模型：和曲线同一个核（`liveRate`），每个模型各自叠一遍。token 是
 * 每秒的速率，费用是每小时的。价钱没到的（`cost` 是 `undefined`）不进费用；到了却是空的
 * 算「无法计价」。贡献不到这一刻合计千分之五的不列：核的尾巴上谁都沾一点。
 */
export function liveModelsAt(samples: readonly LiveSample[], t: number, by: "tokens" | "cost"): TopModels {
  const by_ = new Map<string, ModelShare>();
  for (const x of samples) {
    const d = t - x.at;
    if (d < -LIVE_REACH_MS || d > LIVE_REACH_MS) continue;
    const r = by_.get(x.model) ?? { name: x.model, tokens: 0, cost: 0, estimated: 0, unpriced: 0, noUsage: 0 };
    r.tokens += liveRate(x.tokens, d);
    if (typeof x.cost === "number") {
      const c = liveRate(x.cost, d) * 3600;
      r.cost += c;
      if (x.estimated) r.estimated += c;
    } else if (x.cost === null) r.unpriced += 1;
    by_.set(x.model, r);
  }
  const rows = [...by_.values()];
  const sum = (k: "tokens" | "cost") => rows.reduce((a, r) => a + r[k], 0);
  const tokenFloor = sum("tokens") * 0.005;
  const floor = by === "tokens" ? tokenFloor : sum("cost") * 0.005;
  // 未定价的模型费用是零，按它这一刻的 token 量判断够不够格
  const counts = (r: ModelShare) => r[by] > floor || (by === "cost" && r.unpriced > 0 && r.tokens > tokenFloor);
  return rankModels(rows.filter(counts), by);
}

// ───────────────────────────────────────────── 环比

/**
 * 和上一个等长区间比。
 *
 * · 取不到上一个区间（`undefined` / `null`）：没有这一格，那是读取失败，不是「没有」。
 * · 上一个区间是零（刚开始用、那段时间没用）：没有可比的幅度，写一个「—」。
 * · 其余是变化的比例：0.7 是涨了七成。
 */
export type Delta = { kind: "change"; ratio: number } | { kind: "noPrior" };

export function delta(now: number, before: number | null | undefined): Delta | null {
  if (before == null || !Number.isFinite(before)) return null;
  if (!(before > 0)) return { kind: "noPrior" };
  return { kind: "change", ratio: (now - before) / before };
}

// ───────────────────────────────────────────── 汇总

/** 一段时间的 token 合计。**「输入」含命中缓存的那部分**，见 `cacheOf` */
export function totalTokens(s: Summary): number {
  return s.input_tokens + s.cache_read_tokens + s.cache_write_tokens + s.output_tokens;
}

export function totalCost(s: Summary): number {
  return s.cost_micros_exact + s.cost_micros_estimated;
}

/**
 * 缓存的构成和命中率。
 *
 * **「输入」是送往上游的全部上下文，包含命中缓存的那部分。**`input_tokens` 单独一个
 * 字段说的是「没命中缓存的那部分」—— 命中率高的时候它只有真实输入的零头。三段按单价
 * 从低到高排：读缓存最便宜、写缓存最贵。没有上下文时命中率无从谈起，是 `null`。
 */
export function cacheOf(s: Pick<Summary, "input_tokens" | "cache_read_tokens" | "cache_write_tokens">): {
  read: number;
  plain: number;
  write: number;
  ctx: number;
  hit: number | null;
} {
  const ctx = s.input_tokens + s.cache_read_tokens + s.cache_write_tokens;
  return {
    read: s.cache_read_tokens,
    plain: s.input_tokens,
    write: s.cache_write_tokens,
    ctx,
    hit: ctx > 0 ? s.cache_read_tokens / ctx : null,
  };
}

/**
 * 一个费用写什么：**一个数或一个词，说明进悬停**。卡片上的费用、明细表费用那一格都按它。
 *
 * · 有用量、却一条都没算出费用：「无法计价」。**不写 $0** —— 那是在说它不花钱。
 * · 连用量都没有：「无用量」。
 * · 其余写金额。有算不出来的请求时金额只是下限，写成「≥」；只含估算的带「~」。
 *   全都算出来了、合计是零时写 $0：不计费的上游（本地模型）就是这样，它说的是真的。
 * · 实时档里价钱还没到的请求（`pending`）同样不在金额里：金额写成下限，等它们到了
 *   再补上。
 *
 * `notes` 是悬停里的几句话，一句一段；空的就没有悬停。
 */
export function rankCost(
  r: { cost: number; estimated: number; unpriced: number; noUsage: number; pending?: number },
  t: Text,
): { kind: "amount" | "unpriced" | "noUsage"; prefix: string; notes: string[] } {
  const pending = r.pending ?? 0;
  // 金额之外的请求，各说各的
  const outside = [
    ...(r.unpriced > 0 ? [t.rankUnpriced(r.unpriced)] : []),
    ...(r.noUsage > 0 ? [t.rankNoUsage(r.noUsage)] : []),
    ...(pending > 0 ? [t.rankPending(pending)] : []),
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

/** 一个费用写成一格字：金额（带「≥」「~」），或者「无法计价」「无用量」。提示里每一行按它 */
export function costText(
  r: { cost: number; estimated: number; unpriced: number; noUsage: number; pending?: number },
  t: Text,
): string {
  const c = rankCost(r, t);
  if (c.kind === "unpriced") return t.unpricedCell;
  if (c.kind === "noUsage") return t.noUsageCell;
  return c.prefix + usd(Math.round(r.cost));
}

/**
 * 费用那个指标上**一直看得见**的那个限定词：只放得下一个，挑最要紧的。一条都没算出来时
 * 是「无法计价」「无用量」（大数写「—」）；金额是下限时说缺的是哪一种；只是含估算时说含
 * 估算。全都算出来了是 `null`。完整的几句在细项那一行和悬停里。
 */
export function costTag(
  r: { cost: number; estimated: number; unpriced: number; noUsage: number; pending?: number },
  t: Text,
): string | null {
  const c = rankCost(r, t);
  if (c.kind === "unpriced") return t.unpricedCell;
  if (c.kind === "noUsage") return t.noUsageCell;
  if ((r.pending ?? 0) > 0) return t.tagPending;
  if (r.unpriced > 0) return t.tagUnpriced;
  if (r.noUsage > 0) return t.tagNoUsage;
  if (r.estimated > 0) return t.tagEstimated;
  return null;
}

// ───────────────────────────────────────────── 明细表

/** 明细表的一行：一个模型、一个上游或一把密钥在这段时间里的合计 */
export interface BreakdownRow {
  /** 空串：没有模型名、没到上游（被规则拒绝、没有可用的上游）、认不出密钥 */
  name: string;
  requests: number;
  failed: number;
  tokens: number;
  /** 送往上游的上下文（含缓存）和其中命中缓存的，算命中率 */
  ctx: number;
  read: number;
  /** 微分：实测加估算 */
  cost: number;
  estimated: number;
  unpriced: number;
  noUsage: number;
}

/**
 * 把按格、按名字分的那份加成每个名字一行。**请求多的在前**（一样多的按 token、再按
 * 名字），和用得最多的那一行最先被看到。
 */
export function breakdown(groups: readonly CostBucketGroup[]): BreakdownRow[] {
  const by = new Map<string, BreakdownRow>();
  for (const g of groups) {
    const r = by.get(g.name) ?? {
      name: g.name,
      requests: 0,
      failed: 0,
      tokens: 0,
      ctx: 0,
      read: 0,
      cost: 0,
      estimated: 0,
      unpriced: 0,
      noUsage: 0,
    };
    r.requests += g.requests;
    r.failed += g.failed;
    r.tokens += tokensOf(g);
    r.ctx += g.input_tokens + g.cache_read_tokens + g.cache_write_tokens;
    r.read += g.cache_read_tokens;
    r.cost += g.cost_micros_exact + g.cost_micros_estimated;
    r.estimated += g.cost_micros_estimated;
    r.unpriced += g.unpriced_requests;
    r.noUsage += g.no_usage_requests;
    by.set(g.name, r);
  }
  return [...by.values()].sort(
    (a, b) => b.requests - a.requests || b.tokens - a.tokens || a.name.localeCompare(b.name),
  );
}

// ───────────────────────────────────────────── 上游可不可用

/** 上游现在为什么用不了。和上游页那一行上的标记同一套判断 */
export type DownWhy = "open" | "auth" | "login";

/**
 * 上游现在用不了：熔断中、凭据被拒、登录失效。**停用的不算** —— 那是有意关掉的。
 */
export function downWhy(p: ProviderView): DownWhy | null {
  if (p.disabled) return null;
  if (p.oauth?.needs_login === true) return "login";
  if (p.auth_rejected != null) return "auth";
  if (p.health === "open") return "open";
  return null;
}
