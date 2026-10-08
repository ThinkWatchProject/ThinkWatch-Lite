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
