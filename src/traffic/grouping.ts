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

/** 键盘选中的那一行：一条请求，或者归组时的一个组头 */
export type Cursor = { kind: "request"; id: number } | { kind: "session"; id: string };

/**
 * 表里的一行。`under` 是它挂在哪个组头下面（平表、无主的请求是 `null`）；
 * `shown` 为假的是折起来的组里的请求 —— 它们不在表里。
 */
export type Line =
  | { kind: "session"; id: string; open: boolean }
  | { kind: "request"; id: number; under: string | null; shown: boolean };

/**
 * 表里从上到下有哪些行，和 `RequestRows` 摆的一样。
 *
 * **键盘按这个顺序走，不按 `rows`。**平表两者相同；归组之后不一样：组按最新
 * 的一条排，组内按时间正序，折起来的组里的请求不在表里。按 `rows` 走的话，
 * ↓ 在组内是往上跳的，会跳到别的组去，还会停在看不见的行上。
 *
 * 折起来的组里的请求也列出来（`shown: false`）：光标可能正停在那儿 —— 先选中，
 * 再把组折起来 —— 那时要知道它在哪，才能从那儿接着走。
 */
export function lines(
  rows: RequestRow[],
  groups: Group[] | undefined,
  open: Set<string>,
): Line[] {
  if (!groups)
    return rows.map((r) => ({ kind: "request", id: r.id, under: null, shown: true }));
  const out: Line[] = [];
  for (const g of groups) {
    if (g.id === null) {
      const r = g.rows[0];
      if (r) out.push({ kind: "request", id: r.id, under: null, shown: true });
      continue;
    }
    const isOpen = open.has(g.id);
    out.push({ kind: "session", id: g.id, open: isOpen });
    for (const r of sortWithin(g))
      out.push({ kind: "request", id: r.id, under: g.id, shown: isOpen });
  }
  return out;
}

/** 这一行是不是光标指着的那一行 */
export const isAt = (l: Line, c: Cursor | null): boolean =>
  c !== null && l.kind === c.kind && l.id === c.id;

/** 看得见的行：组头，和不在折起来的组里的请求 */
export const visible = (l: Line): boolean => l.kind === "session" || l.shown;

const toCursor = (l: Line): Cursor =>
  l.kind === "session" ? { kind: "session", id: l.id } : { kind: "request", id: l.id };

/**
 * 按一下 ↑（`-1`）或 ↓（`1`）之后，光标落在哪一行。
 *
 * **只落在看得见的行上。**还没用过键盘、或者选中的那一条已经不在表里了（被筛掉、
 * 超了上限），从第一行开始 —— ↑ 也是，从「上一行」跳到末尾没有意义。到了头再
 * 按，停在原地。
 *
 * 选中的那条被折进了组里时，从它所在的位置往那个方向接着找；那个方向上已经没有
 * 了，就退回反方向最近的那一行。按了键，总得看见光标在哪。一行都看不见时是 `null`。
 */
export function step(ls: Line[], at: Cursor | null, dir: 1 | -1): Cursor | null {
  const i = ls.findIndex((l) => isAt(l, at));
  if (i < 0) {
    const first = ls.find(visible);
    return first ? toCursor(first) : null;
  }
  for (let j = i + dir; j >= 0 && j < ls.length; j += dir)
    if (visible(ls[j]!)) return toCursor(ls[j]!);
  if (visible(ls[i]!)) return toCursor(ls[i]!);
  for (let j = i - dir; j >= 0 && j < ls.length; j -= dir)
    if (visible(ls[j]!)) return toCursor(ls[j]!);
  return null;
}
