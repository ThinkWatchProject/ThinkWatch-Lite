import type { RequestRow } from "@/types";
import { sortWithin, type Group } from "./grouping";

/**
 * 流量表只画看得见的那一段（加上下各留一截）。这里是不碰 DOM 的那一半：表里从上到下
 * 有哪些项、每一项从多高开始、某个高度落在哪一项上、每一列最宽的是哪几项。
 *
 * **为什么要只画一段。**两千行全画出来是六万多个元素：每来一条请求、每走一秒的已跑
 * 时长，浏览器都要把整张表重排一遍（表格按内容定列宽，改一格就是整张表），一秒两条
 * 请求时主线程几乎没有空闲。
 */

/** 表的八列（行尾的「…」不算）。组头和请求行各写各的，列是同一套 */
export type Col = "status" | "time" | "client" | "model" | "upstream" | "latency" | "tokens" | "cost";

/**
 * 一行在各列大约有多宽（字数，见 `textWidth`）。上游那一格会折行：`upstreamMin` 是它
 * 最窄能收到多窄（最长的那一段），窗口窄时列宽看它。
 */
export type Widths = Record<Col | "upstreamMin", number>;

/**
 * 表里的一项：一条请求（带着它的片段行，如果有），或者归组时的一个组头。
 *
 * `prev` 是屏幕上的上一条请求：密钥、模型、上游三列「和上一行相同就压暗」比的是它，
 * 见 `RequestTable` 的 `Row`。`inGroup` 是它挂在哪个展开着的组头下面。
 */
export type Item =
  | { kind: "request"; key: string; r: RequestRow; prev: RequestRow | undefined; inGroup: string | null }
  | { kind: "session"; key: string; g: Group; open: boolean };

/**
 * 表里从上到下的每一项，和键盘走的 `lines`（grouping.ts）是同一个摆法：组头，展开了的
 * 组跟着它的请求（组内按时间正序），认不出会话的请求没有组头、自己一行。
 */
export function itemsOf(rows: RequestRow[], groups: Group[] | undefined, open: ReadonlySet<string>): Item[] {
  if (!groups) return rows.map((r, i) => ({ kind: "request", key: `r${r.id}`, r, prev: rows[i - 1], inGroup: null }));
  const out: Item[] = [];
  for (const g of groups) {
    if (g.id === null) {
      const r = g.rows[0];
      // 无主的请求自成一行，上面不是它的同组：不和上一行比
      if (r) out.push({ kind: "request", key: `r${r.id}`, r, prev: undefined, inGroup: null });
      continue;
    }
    const isOpen = open.has(g.id);
    out.push({ kind: "session", key: `s${g.id}`, g, open: isOpen });
    if (!isOpen) continue;
    const inside = sortWithin(g);
    inside.forEach((r, i) => out.push({ kind: "request", key: `r${r.id}`, r, prev: inside[i - 1], inGroup: g.id }));
  }
  return out;
}

/** 每一项从多高开始：`out[i]` 是第 i 项的上沿，`out[n]` 是总高 */
export function offsetsOf(n: number, height: (i: number) => number): Float64Array {
  const out = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) out[i + 1] = out[i]! + height(i);
  return out;
}

/** 高度 `y` 落在哪一项上。超出两头的算第一项、最后一项；一项都没有是 0 */
export function indexAt(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 最宽的 `k` 项（`width` 由大到小，一样宽的取前面的）。
 *
 * 只画一段的表，列宽只看画出来的那几十行，往下一滚列就跟着跳。表头里垫上每一列最宽的
 * 那几格（看不见、零高），列宽就和整张表都画出来时一样 —— 见 `RequestTable` 的 `Sizer`。
 * 宽度是按字数估的，取前几名而不是第一名，估差一点也落在里面。
 */
export function widest(n: number, k: number, width: (i: number) => number): number[] {
  const top: { i: number; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    const w = width(i);
    if (top.length === k && w <= top[k - 1]!.w) continue;
    let at = top.length;
    while (at > 0 && top[at - 1]!.w < w) at--;
    top.splice(at, 0, { i, w });
    if (top.length > k) top.pop();
  }
  return top.map((x) => x.i);
}

/** 一段字大约占几个字宽：中日韩的字算两个。挑最宽的那几格用，不是排版 */
export function textWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += ch.codePointAt(0)! >= 0x2e80 ? 2 : 1;
  return n;
}

/**
 * 写名字的三列一格最多多宽（像素，不含格子的内边距）。**再长的截断，悬停看全**：名字是
 * 用户起的、上游给的，一个长名字不能把整张表撑宽 —— 默认窗口下常见的名字刚好放满，多出
 * 来的每一像素都把最右边的费用往视野外推。
 *
 * 按 13px 正文量过常见的名字定的：
 * - 模型 208（13rem）：日常的模型名都在 190 以内（`claude-sonnet-4-5-20250929` 186），带
 *   厂商前缀、日期的长名（`deepseek-ai/DeepSeek-V3.1-Terminus` 231、Bedrock 的推理配置
 *   300 上下）截断。
 * - 上游 160（10rem）：标志 16 + 间距 6 + 名字 138。常见的上游名在 100 以内，带区域、
 *   用途的（`bedrock-us-east-1` 113、`azure-openai-eastus2` 134）也放得下。
 * - 密钥 160（10rem）：应用的标志、名字、来源记号一共。密钥名通常在 100 以内。
 */
export const NAME_PX = { model: 208, upstream: 160, client: 160 } as const;

/** `textWidth` 的一格大约多宽：13px 的正文里一个中文字是两格 */
const UNIT_PX = 6.5;

/**
 * 限宽的那一块里的字大约占几个字宽（`textWidth` 估的 `n`）：超过上限的按上限算 —— 画出来
 * 就是那么宽。`beside` 是同一块里字旁边还有多宽（标志、间距），像素。
 *
 * **只用来挑表头里垫哪几格**（见 `widest`）：不封顶的话，挑出来的会是三个超长的名字，
 * 画出来都只有上限那么宽，而真正最宽的那一格（一个短名字带着一排徽标）没垫进去，滚到
 * 它时列宽跳一下。上限宁可估宽一点：比上限还长的那些画出来一样宽，挑哪个都一样。
 */
export function capped(n: number, maxPx: number, beside = 0): number {
  return Math.min(n, Math.ceil((maxPx - beside) / UNIT_PX));
}
