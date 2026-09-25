/**
 * 路由图：密钥 → 路由 → 策略组 → 上游。**纯函数**，组件只管画：
 *
 * · `buildChain`：图怎么连。每一把密钥走哪条路由、路由的规则把请求交给谁、
 *   策略组里有哪些上游 —— 全部从概览里读，不猜。
 * · `trafficOf`：每条线在统计窗口里走过多少请求（线宽按它）。
 * · `layoutChain`：每个节点画在哪儿、每条线怎么弯。
 * · `litBy`：悬停一处时哪些节点和线要亮。
 *
 * **只画决定去向的规则**：被兜底挡住的（`shadowed`）、选定上游之后才判断的
 * （`phase_two`）、只附加改写的（继续匹配）不改变请求去哪儿，画出来反而像
 * 多了几条路。和路由列表「规则」一栏同一个口径（`flowOf`）。
 */
import type { ClientView, GroupView, Overview, RouteHits, RouteView, RuleView } from "@/types";

export type ChainKind = "key" | "route" | "group" | "deny" | "via" | "upstream";

/** 能被悬停、被表格行点亮的那几种。`via` 只是一条穿过策略组那一列的线 */
export type ChainFocus = { kind: Exclude<ChainKind, "via">; name: string };

export interface ChainNode {
  id: string;
  kind: ChainKind;
  /** 第几层：密钥 0、路由 1、策略组 2、上游 3 */
  layer: 0 | 1 | 2 | 3;
  /** 配置里的名字。`via` 是它通往的上游；`deny` 为空 */
  name: string;
  /**
   * 不在任何一把启用中的密钥的路上：停用的密钥、没有密钥使用的路由、没被引用的
   * 策略组、到不了或已停用的上游。画成虚线、淡一档。
   */
  idle: boolean;
}

export interface ChainEdge {
  id: string;
  from: string;
  to: string;
  idle: boolean;
}

export interface Chain {
  /** 按层、层内从上到下排好的节点 */
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** 每一条完整的路（节点 id），悬停时按它点亮 */
  paths: string[][];
  /** 有没有策略组那一列（策略组、拒绝）。没有时路由直接连上游 */
  middle: boolean;
  /**
   * 画出来的每条规则在路由之后连到哪几站：策略组、拒绝，或者直连的上游（有第二列时
   * 先穿过它）。按路由名、规则名找 —— 在途请求和命中数报的都是「哪条路由的哪条规则」，
   * 靠它落到线上
   */
  rules: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

export const chainId = {
  key: (name: string) => `key:${name}`,
  route: (name: string) => `route:${name}`,
  group: (name: string) => `group:${name}`,
  deny: "deny",
  via: (name: string) => `via:${name}`,
  upstream: (name: string) => `up:${name}`,
};

export function focusId(f: ChainFocus): string {
  return f.kind === "deny" ? chainId.deny : chainId[f.kind](f.name);
}

/** 一条线的 id：两头节点的 id */
export const edgeId = (from: string, to: string) => `${from}>${to}`;

/** 策略组的成员，按实际使用的先后：内置的是全部上游，手动选择的选定成员在前 */
export function membersOf(g: GroupView, providers: readonly string[]): string[] {
  if (g.builtin) return [...providers];
  if (g.kind === "select" && g.selected && g.providers.includes(g.selected)) {
    return [g.selected, ...g.providers.filter((p) => p !== g.selected)];
  }
  return g.providers;
}

/** 规则把请求交给的去向 */
type Target = { kind: "group" | "deny" | "upstream"; name: string };

/** 一条规则的去向。不画的规则（见文件头）和指向不存在的去向的没有 */
function targetOf(x: RuleView, groups: ReadonlySet<string>, providers: ReadonlySet<string>): Target | null {
  if (x.shadowed || x.phase_two) return null;
  if (x.to) {
    if (groups.has(x.to)) return { kind: "group", name: x.to };
    if (providers.has(x.to)) return { kind: "upstream", name: x.to };
    return null;
  }
  return x.deny != null ? { kind: "deny", name: "" } : null;
}

/** 一条路由把请求交给的去向，按规则顺序、去重 */
export function targetsOf(r: RouteView, groups: ReadonlySet<string>, providers: ReadonlySet<string>): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const x of r.rules) {
    const t = targetOf(x, groups, providers);
    if (!t) continue;
    const k = `${t.kind}:${t.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** 路由按列表里的顺序：默认路由在最前 */
export function orderedRoutes(routes: readonly RouteView[]): RouteView[] {
  return [...routes].sort((a, b) => Number(b.default) - Number(a.default));
}

export function buildChain(ov: Pick<Overview, "clients" | "routes" | "groups" | "providers">): Chain {
  const routes = orderedRoutes(ov.routes);
  const routeIndex = new Map(routes.map((r, i) => [r.name, i]));
  const defaultRoute = routes.find((r) => r.default)?.name ?? null;
  const groupsByName = new Map(ov.groups.map((g) => [g.name, g]));
  const groupNames = new Set(groupsByName.keys());
  const providerNames = ov.providers.map((p) => p.name);
  const providerSet = new Set(providerNames);
  const stoppedUpstreams = new Set(ov.providers.filter((p) => p.disabled).map((p) => p.name));

  const routeOf = (k: ClientView): string | null => {
    const r = k.route ?? defaultRoute;
    return r != null && routeIndex.has(r) ? r : null;
  };

  const targets = new Map(routes.map((r) => [r.name, targetsOf(r, groupNames, providerSet)]));
  const referencedGroups = new Set<string>();
  let anyDeny = false;
  for (const ts of targets.values())
    for (const t of ts) {
      if (t.kind === "group") referencedGroups.add(t.name);
      if (t.kind === "deny") anyDeny = true;
    }
  // 内置的「全部上游」没被引用时不画：自己建了策略组的人多半用不上它，画出来只是一块灰
  const shownGroups = ov.groups.filter((g) => !g.builtin || referencedGroups.has(g.name));
  const middle = shownGroups.length > 0 || anyDeny;

  /** 一个去向在路由之后的那几站：直连的上游在有第二列时先穿过它 */
  const stationsOf = (t: Target): string[] =>
    t.kind === "deny"
      ? [chainId.deny]
      : t.kind === "group"
        ? [chainId.group(t.name)]
        : middle
          ? [chainId.via(t.name), chainId.upstream(t.name)]
          : [chainId.upstream(t.name)];
  const rules = new Map(
    routes.map((r) => [
      r.name,
      new Map(
        r.rules.flatMap((x) => {
          const t = targetOf(x, groupNames, providerSet);
          return t ? [[x.name, stationsOf(t)] as const] : [];
        }),
      ),
    ]),
  );

  // ── 路：从密钥（没有密钥时从路由）一直走到头
  const paths: { ids: string[]; live: boolean }[] = [];
  const keysOf = new Map<string, ClientView[]>();
  for (const k of ov.clients) {
    const r = routeOf(k);
    if (r == null) {
      // 指向一条不存在的路由（配置校验会拦住，这里只求不崩）
      paths.push({ ids: [chainId.key(k.name)], live: false });
      continue;
    }
    keysOf.set(r, [...(keysOf.get(r) ?? []), k]);
  }
  const tailsOf = (r: RouteView): { ids: string[]; live: boolean }[] => {
    const out: { ids: string[]; live: boolean }[] = [];
    for (const t of targets.get(r.name) ?? []) {
      if (t.kind === "deny") out.push({ ids: stationsOf(t), live: true });
      else if (t.kind === "upstream") out.push({ ids: stationsOf(t), live: !stoppedUpstreams.has(t.name) });
      else {
        const g = groupsByName.get(t.name)!;
        const ms = membersOf(g, providerNames).filter((m) => providerSet.has(m));
        if (ms.length === 0) out.push({ ids: [chainId.group(t.name)], live: true });
        for (const m of ms)
          out.push({ ids: [chainId.group(t.name), chainId.upstream(m)], live: !stoppedUpstreams.has(m) });
      }
    }
    return out.length ? out : [{ ids: [], live: true }];
  };
  for (const r of routes) {
    const keys = keysOf.get(r.name) ?? [];
    const tails = tailsOf(r);
    const heads = keys.length ? keys : [null];
    for (const k of heads)
      for (const tail of tails) {
        paths.push({
          ids: [...(k ? [chainId.key(k.name)] : []), chainId.route(r.name), ...tail.ids],
          live: k != null && !k.disabled && tail.live,
        });
      }
  }
  const onPath = new Set(paths.flatMap((p) => p.ids));
  // 没被任何路由引用的策略组：自己连着成员画出来，悬停时照样亮
  for (const g of shownGroups) {
    if (onPath.has(chainId.group(g.name))) continue;
    const ms = membersOf(g, providerNames).filter((m) => providerSet.has(m));
    if (ms.length === 0) paths.push({ ids: [chainId.group(g.name)], live: false });
    for (const m of ms) paths.push({ ids: [chainId.group(g.name), chainId.upstream(m)], live: false });
  }

  // ── 节点与线
  const live = new Set(paths.filter((p) => p.live).flatMap((p) => p.ids));
  const liveEdges = new Set<string>();
  const edgeMap = new Map<string, ChainEdge>();
  for (const p of paths)
    for (let i = 1; i < p.ids.length; i++) {
      const id = edgeId(p.ids[i - 1]!, p.ids[i]!);
      if (p.live) liveEdges.add(id);
      if (!edgeMap.has(id)) edgeMap.set(id, { id, from: p.ids[i - 1]!, to: p.ids[i]!, idle: true });
    }
  for (const e of edgeMap.values()) e.idle = !liveEdges.has(e.id);

  const node = (id: string, kind: ChainKind, layer: ChainNode["layer"], name: string): ChainNode => ({
    id,
    kind,
    layer,
    name,
    idle: !live.has(id),
  });

  // ── 层内顺序。路由按列表；其余按「连着的上一层在哪儿」排（重心法），线就少交叉
  const l1 = routes.map((r) => node(chainId.route(r.name), "route", 1, r.name));
  const rank = (name: string | null) => (name == null ? Number.MAX_SAFE_INTEGER : routeIndex.get(name)!);
  const l0 = ov.clients
    .map((k, i) => ({ k, i }))
    .sort((a, b) => rank(routeOf(a.k)) - rank(routeOf(b.k)) || a.i - b.i)
    .map(({ k }) => node(chainId.key(k.name), "key", 0, k.name));

  /** 上一层到下一层的「重心」：连着的上一层节点的位置，再按规则或成员的先后错开一点 */
  const pull = new Map<string, number[]>();
  const add = (id: string, v: number) => pull.set(id, [...(pull.get(id) ?? []), v]);
  routes.forEach((r, ri) => {
    const ts = targets.get(r.name) ?? [];
    ts.forEach((t, j) => {
      const v = ri + (j + 1) / (ts.length + 1);
      if (t.kind === "deny") add(chainId.deny, v);
      else if (t.kind === "group") add(chainId.group(t.name), v);
      else add(middle ? chainId.via(t.name) : chainId.upstream(t.name), v);
    });
  });
  const mean = (xs: number[] | undefined) => (xs && xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const LAST = 1e6;

  let l2: ChainNode[] = [];
  if (middle) {
    const items: { n: ChainNode; bc: number; tie: number }[] = [];
    shownGroups.forEach((g, i) => {
      const id = chainId.group(g.name);
      items.push({ n: node(id, "group", 2, g.name), bc: mean(pull.get(id)) ?? LAST + i, tie: i });
    });
    if (anyDeny) items.push({ n: node(chainId.deny, "deny", 2, ""), bc: mean(pull.get(chainId.deny))!, tie: 0 });
    const vias = new Set(
      [...targets.values()].flatMap((ts) => ts.filter((t) => t.kind === "upstream").map((t) => t.name)),
    );
    providerNames.forEach((p, i) => {
      if (!vias.has(p)) return;
      const id = chainId.via(p);
      items.push({ n: node(id, "via", 2, p), bc: mean(pull.get(id))!, tie: i });
    });
    l2 = items.sort((a, b) => a.bc - b.bc || a.tie - b.tie).map((x) => x.n);
    // 上游的重心看它在第二层的前驱：策略组按成员先后错开，直连的线正对着它
    const at = new Map(l2.map((n, i) => [n.id, i]));
    for (const n of l2) {
      if (n.kind === "via") {
        add(`l3:${n.name}`, at.get(n.id)! + 0.5);
        if (!n.idle) add(`l3live:${n.name}`, at.get(n.id)! + 0.5);
      } else if (n.kind === "group") {
        const g = groupsByName.get(n.name)!;
        const ms = membersOf(g, providerNames);
        ms.forEach((m, j) => {
          const v = at.get(n.id)! + (j + 1) / (ms.length + 1);
          add(`l3:${m}`, v);
          if (!n.idle) add(`l3live:${m}`, v);
        });
      }
    }
  }
  const pullsOf = (p: string) =>
    middle ? (pull.get(`l3live:${p}`) ?? pull.get(`l3:${p}`)) : pull.get(chainId.upstream(p));
  /**
   * 上游的两种排法：按前驱的平均位置（经典的重心法），或者按最靠上的那个前驱（直连
   * 的线尽量走直）。**哪种交叉少用哪种**，一样多时取后者 —— 直连一个上游的规则最常见，
   * 那几条线平着走读起来最省力。
   */
  const orderBy = (score: (xs: number[] | undefined) => number | null) =>
    providerNames
      .map((p, i) => ({ n: node(chainId.upstream(p), "upstream", 3, p), bc: score(pullsOf(p)) ?? LAST + i, tie: i }))
      .sort((a, b) => a.bc - b.bc || a.tie - b.tie)
      .map((x) => x.n);
  const upper = orderBy((xs) => (xs && xs.length ? Math.min(...xs) : null));
  const average = orderBy(mean);
  const leftOf = middle ? l2 : l1;
  const edgesIn = [...edgeMap.values()].filter((e) => e.to.startsWith("up:"));
  const l3 = crossings(edgesIn, leftOf, average) < crossings(edgesIn, leftOf, upper) ? average : upper;

  return {
    nodes: [...l0, ...l1, ...l2, ...l3],
    edges: [...edgeMap.values()],
    paths: paths.map((p) => p.ids),
    middle,
    rules,
  };
}

// ---------------------------------------------------------------- 走过的请求

/**
 * 每条线在统计窗口里走过多少请求（`GET /summary/routes`，按线的 id）。
 *
 * 「路由 → 第二列」那一段：这条路由里连到那一站的规则**决定了去向**的请求数之和
 * （`decided`）；直连上游的线穿过第二列之后还是这些请求。**别的线没有数**：一条路由
 * 几把密钥共用时各走了多少、策略组里由哪个上游接下，统计里都分不出来，那几段照常画。
 * 统计里有、图上没有的路由和规则（改过名、删掉了）落不到线上。
 */
export function trafficOf(chain: Chain, hits: readonly RouteHits[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of hits) {
    const links = chain.rules.get(r.route);
    if (!links) continue;
    for (const x of r.rules) {
      const stations = links.get(x.rule);
      if (!stations || x.decided === 0) continue;
      const path = [chainId.route(r.route), ...stations];
      for (let i = 1; i < path.length; i++) {
        const id = edgeId(path[i - 1]!, path[i]!);
        out.set(id, (out.get(id) ?? 0) + x.decided);
      }
    }
  }
  return out;
}

/** 线宽：没有数的、一个请求都没走过的是最细的那一档 */
export const EDGE_W = 1.25;
/** 走过请求的线至少这么粗：只走过一两个的也和一个都没走过的分得开 */
const EDGE_W_USED = 1.6;
const EDGE_W_MAX = 3.25;

/**
 * 走过 `n` 个请求的线画多粗：最忙的那条（`max`）最粗。**按平方根放大**，最忙的那条不会
 * 把别的都压成一样细。
 */
export function edgeWidth(n: number | undefined, max: number): number {
  if (!n || max <= 0) return EDGE_W;
  return EDGE_W_USED + (EDGE_W_MAX - EDGE_W_USED) * Math.sqrt(Math.min(1, n / max));
}

/** 相邻两层之间的线交叉了几次：两条线的起点和终点上下颠倒就是一次 */
function crossings(edges: ChainEdge[], left: ChainNode[], right: ChainNode[]): number {
  const l = new Map(left.map((n, i) => [n.id, i]));
  const r = new Map(right.map((n, i) => [n.id, i]));
  const pairs = edges
    .filter((e) => l.has(e.from) && r.has(e.to))
    .map((e) => [l.get(e.from)!, r.get(e.to)!] as const);
  let n = 0;
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i]!;
      const [c, d] = pairs[j]!;
      if ((a - c) * (b - d) < 0) n += 1;
    }
  return n;
}

// ---------------------------------------------------------------- 点亮

/** 悬停一处：经过它的每一条路上的节点和线都亮 */
export function litBy(chain: Chain, focus: string | null): { nodes: Set<string>; edges: Set<string> } | null {
  if (!focus) return null;
  const nodes = new Set<string>([focus]);
  const edges = new Set<string>();
  for (const p of chain.paths) {
    if (!p.includes(focus)) continue;
    for (const id of p) nodes.add(id);
    for (let i = 1; i < p.length; i++) edges.add(edgeId(p[i - 1]!, p[i]!));
  }
  return { nodes, edges };
}

// ---------------------------------------------------------------- 排版

/**
 * 节点高、节点之间的空，和穿过策略组那一列的线与上下邻居之间的空。
 *
 * **一列超过 `DENSE_FROM` 个节点时收紧一档**（上游、密钥多的配置）：这张图是页头，
 * 不能把下面的表挤出窗口。
 */
export const NODE_H = 26;
const NODE_GAP = 6;
const VIA_GAP = 10;
const DENSE = { h: 22, gap: 4, via: 8 };
export const DENSE_FROM = 9;
/** 列与列之间至少留这么宽给线弯过去 */
const MIN_GAP = 36;

export interface PlacedNode {
  node: ChainNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge {
  edge: ChainEdge;
  d: string;
  /** 起点在第几层，点亮时按它错开一点，读起来是从左往右走过去 */
  layer: number;
}

export interface ChainLayout {
  width: number;
  height: number;
  /** 收紧的那一档（节点矮一些，见 `DENSE_FROM`） */
  dense: boolean;
  /** 每一列的左边和宽度，按显示的列（没有策略组那一列时是三列） */
  cols: { layer: number; x: number; w: number }[];
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

export function layoutChain(chain: Chain, width: number): ChainLayout {
  const layers = chain.middle ? [0, 1, 2, 3] : [0, 1, 3];
  const n = layers.length;
  let colW = Math.min(184, Math.max(112, width * (chain.middle ? 0.17 : 0.2)));
  if (width - n * colW < MIN_GAP * (n - 1)) colW = Math.max(72, (width - MIN_GAP * (n - 1)) / n);
  const gap = n > 1 ? (width - n * colW) / (n - 1) : 0;
  const cols = layers.map((layer, i) => ({ layer, x: i * (colW + gap), w: colW }));
  const colOf = new Map(cols.map((c) => [c.layer, c]));

  const byLayer = new Map<number, ChainNode[]>(layers.map((l) => [l, chain.nodes.filter((x) => x.layer === l)]));
  const dense = Math.max(...[...byLayer.values()].map((ns) => ns.filter((x) => x.kind !== "via").length)) >= DENSE_FROM;
  const nodeH = dense ? DENSE.h : NODE_H;
  const nodeGap = dense ? DENSE.gap : NODE_GAP;
  const viaGap = dense ? DENSE.via : VIA_GAP;
  // 穿过去的线没有高度，和邻居隔得比节点之间宽一点，不然贴着节点的边走
  const extent = (node: ChainNode) => (node.kind === "via" ? 0 : nodeH);
  const space = (a: ChainNode, b: ChainNode) => (a.kind !== "via" && b.kind !== "via" ? nodeGap : viaGap);
  const columnHeight = (ns: ChainNode[]) =>
    ns.reduce((s, x, i) => s + extent(x) + (i > 0 ? space(ns[i - 1]!, x) : 0), 0);
  const height = Math.max(nodeH, ...[...byLayer.values()].map(columnHeight));

  const placed = new Map<string, PlacedNode>();
  for (const l of layers) {
    const ns = byLayer.get(l)!;
    const col = colOf.get(l)!;
    let y = (height - columnHeight(ns)) / 2;
    ns.forEach((node, i) => {
      if (i > 0) y += space(ns[i - 1]!, node);
      placed.set(node.id, { node, x: col.x, y, w: col.w, h: extent(node) });
      y += extent(node);
    });
  }

  const mid = (p: PlacedNode) => p.y + p.h / 2;
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) / 2;
    return `C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
  };
  const edges: PlacedEdge[] = [];
  for (const e of chain.edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b) continue;
    const y1 = mid(a);
    const y2 = mid(b);
    // 穿过策略组那一列的线：先平着穿过这一列，再弯向上游
    const x1 = a.x + a.w;
    const start = a.node.kind === "via" ? `M ${a.x} ${y1} L ${x1} ${y1}` : `M ${x1} ${y1}`;
    edges.push({ edge: e, d: `${start} ${curve(x1, y1, b.x, y2)}`, layer: a.node.layer });
  }
  return { width, height, dense, cols, nodes: [...placed.values()], edges };
}
