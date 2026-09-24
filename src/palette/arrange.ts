import { normalize, score } from "./match";
import { recentIds, usageBoost, type Usage } from "./usage";

/**
 * 面板里一次显示什么、按什么顺序。**纯函数**：条目、查询、用过的记录进，分好组、
 * 排好序的结果出。
 *
 * · 空查询：最近使用（最多 5 个）、页面（源列表的顺序）、操作（常用的在前，见
 *   `buildItems`）。上游、密钥这些实体和设置的各节只在搜的时候出现。
 * · 有查询：每一项按名字和别名打分（`score`），常用的加一点（`usageBoost`）；组内按
 *   分数排，每组有上限；**组按各自最好的那一项排**，第一行永远是全场最好的结果。
 * · 进了下一级（切换连接）：只有那一组。
 */

/** 能被排的东西：`buildItems` 的 `Item` 满足它 */
export interface Rankable {
  id: string;
  group: string;
  title: string;
  keywords?: string[];
  searchOnly?: boolean;
}

export interface Shown<T extends Rankable> {
  group: string;
  items: { item: T; value: string }[];
}

/** 有查询时每组最多几项。没写的不限 */
const LIMITS: Record<string, number> = {
  upstreams: 5,
  keys: 5,
  routes: 5,
  groups: 5,
  clients: 5,
  connections: 5,
  settings: 5,
  requests: 5,
  actions: 8,
};

/** 分数一样时组的先后，也是空查询时的顺序 */
const ORDER = [
  "recent",
  "pages",
  "actions",
  "upstreams",
  "keys",
  "routes",
  "groups",
  "clients",
  "connections",
  "settings",
  "requests",
];

/** 低于这个分数的不出现：只沾一点边的模糊匹配（`ccd` 对 `claude-code` 约 0.26） */
export const MIN_SCORE = 0.2;
/**
 * 有像样的结果时，比最好的那一项差太多的不出现：打 `cla` 时 `claude-code` 名字开头就
 * 对上了（0.9），`Collapse sidebar` 只是按字母顺序散着沾边（0.3），列出来是噪音。
 * 全是沾边的结果时照常列 —— 那时它们就是最好的。
 */
const RELATIVE = 0.45;

const RECENT = 5;

export function arrange<T extends Rankable>({
  items,
  extra = [],
  query,
  scope,
  usage,
  now = Date.now(),
}: {
  items: readonly T[];
  /** 已经打过分的额外结果（请求），只在有查询时出现 */
  extra?: readonly { item: T; score: number }[];
  query: string;
  /** 进了哪一级。`null` 是最外层 */
  scope: string | null;
  usage: Usage;
  now?: number;
}): Shown<T>[] {
  const q = normalize(query);

  if (scope !== null) {
    const list = items
      .filter((i) => i.group === scope)
      .map((item, i) => ({ item, s: q ? score(q, item.title, item.keywords) : 1, i }))
      .filter((x) => x.s >= MIN_SCORE)
      .sort((a, b) => b.s - a.s || a.i - b.i);
    return list.length ? [{ group: scope, items: list.map(({ item }) => ({ item, value: item.id })) }] : [];
  }

  if (!q) {
    const byId = new Map(items.map((i) => [i.id, i]));
    const out: Shown<T>[] = [];
    const recent = recentIds(usage, RECENT * 2)
      .map((id) => byId.get(id))
      .filter((i): i is T => i !== undefined)
      .slice(0, RECENT);
    // 「最近使用」里的一项和下面「页面」里的同一项是两行，值要分开，否则 cmdk 当成一行
    if (recent.length) out.push({ group: "recent", items: recent.map((item) => ({ item, value: `recent:${item.id}` })) });
    for (const g of ["pages", "actions"]) {
      const list = items.filter((i) => i.group === g && !i.searchOnly);
      if (list.length) out.push({ group: g, items: list.map((item) => ({ item, value: item.id })) });
    }
    return out;
  }

  const scored: { item: T; s: number; i: number }[] = [];
  items.forEach((item, i) => {
    const s = score(q, item.title, item.keywords);
    if (s >= MIN_SCORE) scored.push({ item, s: s + usageBoost(usage[item.id], now), i });
  });
  extra.forEach(({ item, score: s }, i) => {
    if (s >= MIN_SCORE) scored.push({ item, s: s + usageBoost(usage[item.id], now), i: items.length + i });
  });

  const best = scored.reduce((m, x) => Math.max(m, x.s), 0);
  const floor = best * RELATIVE;
  const groups = new Map<string, { item: T; s: number; i: number }[]>();
  for (const x of scored) {
    if (x.s < floor) continue;
    const list = groups.get(x.item.group) ?? [];
    list.push(x);
    groups.set(x.item.group, list);
  }
  const out = [...groups.entries()].map(([group, list]) => {
    list.sort((a, b) => b.s - a.s || a.i - b.i);
    return { group, list: list.slice(0, LIMITS[group] ?? list.length) };
  });
  out.sort(
    (a, b) =>
      (b.list[0]?.s ?? 0) - (a.list[0]?.s ?? 0) || ORDER.indexOf(a.group) - ORDER.indexOf(b.group),
  );
  return out.map(({ group, list }) => ({ group, items: list.map(({ item }) => ({ item, value: item.id })) }));
}
