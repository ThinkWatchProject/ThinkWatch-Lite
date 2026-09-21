import type { RequestRow, SessionView } from "@/types";

/**
 * 把请求按会话归组。
 *
 * **请求和会话是同一批记录的两个粒度，不是两个页面。**原来它们是两个
 * 标签：各有各的表、各有各的详情范式，而两者之间没有门 —— 看着一条很
 * 贵的请求，问不出它属于哪次任务。归组是对这件事最直白的表达：折叠起来
 * 就是会话列表，展开就是那次任务的每一条请求。
 *
 * **这一层是纯的，因为它要能被测。**「一条请求认不出会话时去哪儿」
 * 「组按什么排序」「组内按什么排序」这些问题写在 JSX 里没人回答得了，
 * 而它们恰恰是归组之后唯一会出错的地方。
 */

/** 归组之后的一项：一个会话，或一条无主的请求。 */
export type Group = {
  /** 会话 id。无主的那些是 `null` */
  id: string | null;
  /** 这个会话的汇总。列表里没有它（还没读到）时是 `null` */
  session: SessionView | null;
  rows: RequestRow[];
};

/**
 * 认不出会话的请求**不并成一个假会话**。
 *
 * 把它们塞进一个「其他」组，等于声称它们属于同一次任务 —— 而它们之间
 * 唯一的共同点是我们不知道它们属于谁。所以每一条各成一组，折叠态下就
 * 显示成一行普通请求。
 */
export function groupBySession(
  rows: RequestRow[],
  sessions: SessionView[],
): Group[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const out: Group[] = [];
  const at = new Map<string, Group>();
  for (const r of rows) {
    const id = r.session ?? null;
    if (id === null) {
      out.push({ id: null, session: null, rows: [r] });
      continue;
    }
    const g = at.get(id);
    if (g) {
      g.rows.push(r);
      continue;
    }
    const made: Group = { id, session: byId.get(id) ?? null, rows: [r] };
    at.set(id, made);
    out.push(made);
  }
  return out;
}

/**
 * 一个组在列表里的位置由**它最新的那一条**决定。
 *
 * 按会话的开始时间排的话，一次跑了两小时的任务会沉到底下 —— 而它可能
 * 正在跑。排查时要找的是「刚才发生了什么」。
 */
export function groupAt(g: Group): number {
  let newest = -Infinity;
  for (const r of g.rows) if (r.atMs > newest) newest = r.atMs;
  return newest;
}

/**
 * 组内永远按时间正序。
 *
 * **不跟随表头的排序。**一次任务的第 1 轮到第 47 轮是有顺序的，按耗时
 * 排会把这个顺序打散，而「上下文是从哪一轮开始涨的」正需要它。表头的
 * 排序作用在组与组之间。
 */
export function sortWithin(g: Group): RequestRow[] {
  return [...g.rows].sort((a, b) => a.atMs - b.atMs);
}

/** 这一组里失败了几条。折叠态要显示它 —— 一次任务里有没有翻车是第一位的。 */
export function failedIn(g: Group): number {
  return g.rows.filter((r) => r.state === "failed").length;
}
