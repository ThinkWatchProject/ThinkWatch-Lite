import type { CacheTally, RatioView, UpstreamCheckup } from "@/types";

/**
 * 上游体检怎么读 core 给的数（`GET /upstreams/health`）。
 *
 * **core 只给事实和参照，标不标出来是这里的事**，规则都在这一处：样本要多少、差多少
 * 才值得看一眼。标出来的只是琥珀色的字，不写结论 —— 模型名是上游自己写的，本地估算
 * 有两三成的误差，缓存读不读得到也看客户端。一处偏差是一条线索，不是一个判决。
 *
 * **单看一家的数说明不了什么**，所以输入和缓存都拿同一个模型在别的上游上的数来比：
 * 估法一样、模型一样，差出来的才是上游自己的事。
 */

/** 比较输入要的最少样本，两边都要够：少了，一次长对话就能把中位数拉开一截 */
export const MIN_SAMPLES = 20;
/** 比较缓存要的最少轮次，两边都要够 */
export const MIN_TURNS = 10;
/**
 * 输入和别的上游差这么多才标出来，**多了少了都算**：多报是多收费用，少报可能是删掉
 * 了一截对话（上下文没有全部送到模型）。
 */
export const INPUT_GAP = 0.25;
/** 缓存：别的上游读到至少这么多，而它读到的不到别家的一半，才标出来 */
export const CACHE_FLOOR = 0.3;
/** 失败率到这么高、请求也够多，才标出来 */
export const FAIL_RATE = 0.1;

/** 一个模型上，这一家和别家的输入之比 */
export interface InputGap {
  model: string;
  here: RatioView;
  others: RatioView;
  otherUpstreams: number;
  /** 这一家的比值比别家多出（负数是少）几成：`here / others - 1` */
  gap: number;
}

/** 比得上的模型（别家也服务、两边样本都够），差得多的在前 */
export function inputGaps(c: UpstreamCheckup): InputGap[] {
  const out: InputGap[] = [];
  for (const m of c.input.by_model) {
    const o = m.others;
    if (!o || o.median <= 0 || m.here.samples < MIN_SAMPLES || o.samples < MIN_SAMPLES) continue;
    out.push({ model: m.model, here: m.here, others: o, otherUpstreams: m.other_upstreams, gap: m.here.median / o.median - 1 });
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

/**
 * 这个模型上该不该标出这一家：差得够多，**而且离本地估算更远的是它**。
 *
 * 只有两家服务同一个模型时，比较是对称的：中转多报三成，官方那边就是「少两成多」；
 * 中转删掉一截对话少报四成，官方那边反倒成了「多六成」。只看差多少，诚实的那一家
 * 也会被标出来。估算是两边共同的锚：误差有两三成，但多半比一家动过手脚的上游近。
 */
export const inputFlagged = (g: InputGap) =>
  Math.abs(g.gap) >= INPUT_GAP && Math.abs(Math.log(g.here.median)) > Math.abs(Math.log(g.others.median));

/** 输入里从缓存读的那一份。一个 token 都没有时说不出比例 */
export function cacheShare(t: CacheTally): number | null {
  return t.input_tokens > 0 ? t.cache_read_tokens / t.input_tokens : null;
}

/** 一个模型上，这一家和别家的缓存读取 */
export interface CacheGap {
  model: string;
  here: CacheTally;
  others: CacheTally;
  otherUpstreams: number;
  hereShare: number;
  othersShare: number;
}

/** 比得上的模型（别家也服务、两边轮次都够），轮次多的在前（core 给的顺序） */
export function cacheGaps(c: UpstreamCheckup): CacheGap[] {
  const out: CacheGap[] = [];
  for (const m of c.cache.by_model) {
    const o = m.others;
    if (!o || m.here.turns < MIN_TURNS || o.turns < MIN_TURNS) continue;
    const hereShare = cacheShare(m.here);
    const othersShare = cacheShare(o);
    if (hereShare === null || othersShare === null) continue;
    out.push({ model: m.model, here: m.here, others: o, otherUpstreams: m.other_upstreams, hereShare, othersShare });
  }
  return out;
}

export const cacheFlagged = (g: CacheGap) => g.othersShare >= CACHE_FLOOR && g.hereShare <= g.othersShare / 2;

/** 失败率。没有请求时说不出 */
export function failRate(c: UpstreamCheckup): number | null {
  return c.requests > 0 ? c.failed / c.requests : null;
}

export const failFlagged = (c: UpstreamCheckup) => c.requests >= MIN_SAMPLES && (failRate(c) ?? 0) >= FAIL_RATE;

/** 百分比，取整。不是零却不到 1% 的写「<1%」：写成 0% 会读成一点都没有 */
export function pct(x: number): string {
  if (x > 0 && x < 0.005) return "<1%";
  return `${Math.round(x * 100)}%`;
}

/** 带符号的差，`+31%` / `−38%`（减号是 U+2212，和加号一样宽） */
export function signedPct(x: number): string {
  const n = Math.round(Math.abs(x) * 100);
  if (n === 0) return "0%";
  return `${x > 0 ? "+" : "\u2212"}${n}%`;
}
