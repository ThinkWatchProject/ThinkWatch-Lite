import type { KnownModelAliasFields, RuleTarget } from "@/aliases/api.provisional";
import type { HistoryRow, KnownModel, PluginRunView, RequestRow } from "@/types";

/**
 * 发给上游的模型名为什么和客户端写的不一样，或者为什么一样也值得一提。
 *
 * · `alias`：客户端写的是别名，按这家上游换成了它的模型名（换完和原名相同也算）
 * · `rule`：规则的「模型改为」改了名
 * · `pinned`：决定去向的规则用了「指定模型」，这一跳的上游和模型是它列出来的
 * · `plugin`：插件在这一跳改写过请求
 *
 * **请求记录里没有「为什么」这一项**：记下的只有客户端要的名称、每一跳发出的名称（不同才记）、
 * 走的路由和规则、改写了参数的规则。原因是拿这些事实和**现在的**别名表、路由配置对出来的 ——
 * 配置改过之后，老记录可能对不上。**对不上就不说**（`null`），不拿现在的配置给老记录编一个原因。
 */
export type ModelVia = "alias" | "rule" | "pinned" | "plugin";

/** 对原因要用到的配置：现在的别名表和路由 */
export interface ViaConfig {
  /** 别名 → 它的模型名，按书写顺序 */
  aliases: ReadonlyMap<string, readonly string[]>;
  routes: readonly RouteLike[];
}

/** 路由里要看的几项。`to` 是列表时是「指定模型」 */
export interface RouteLike {
  name: string;
  rules: readonly {
    name: string;
    to?: RuleTarget | null;
    set?: { model?: string | null } | null;
  }[];
}

/** `GET /models` 里的一项。别名那一项带着它的模型名列表（core 合入别名之后生成的类型里才有） */
type ModelItem = KnownModel & Partial<KnownModelAliasFields>;

/** 从 `GET /models` 里挑出别名：别名 → 它的模型名 */
export function aliasTable(models: readonly KnownModel[] | undefined): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const m of (models ?? []) as readonly ModelItem[]) {
    if (m.alias && m.alias.length > 0) out.set(m.id, m.alias);
  }
  return out;
}

function ruleOf(cfg: ViaConfig, route: string, rule: string) {
  return cfg.routes.find((r) => r.name === route)?.rules.find((x) => x.name === rule);
}

/** 这条规则现在是不是「指定模型」：是的话给出它列的上游和模型 */
export function pinnedOf(cfg: ViaConfig, route: string, rule: string) {
  const to = ruleOf(cfg, route, rule)?.to;
  return Array.isArray(to) ? to : null;
}

/** 一跳的事实：客户端要的名称、发往的上游、这一跳发出的名称，和这次请求的路由 */
export interface HopFacts {
  /** 客户端要的模型名 */
  client: string;
  provider: string;
  /** 这一跳发出的模型名。记录里没有（和客户端的相同）时就是 `client` */
  sent: string;
  route: string;
  /** 决定去向的那条规则 */
  rule: string;
  /** 改写了参数的规则 */
  rewrittenBy: readonly string[];
  /** 插件在这一跳改写过请求 */
  plugin: boolean;
}

/**
 * 一跳发出的模型名是怎么来的。说不准是 `null`。
 *
 * 先后：指定模型（不经过别名表和「模型改为」）→ 规则改名（改出来的名称也可以是别名，再按
 * 别名表对到这家）→ 别名 → 插件。名称没变时只有指定模型和别名说得上：一个是规则列的就是
 * 它，一个是别名在这家正好叫这个名称。
 *
 * 决定去向的规则现在是指定模型、这一跳却不在它的列表里：规则在这次请求之后改过，别名、改名
 * 都说不准了；只有插件在这一跳改写过请求时说是插件。
 */
export function hopVia(h: HopFacts, cfg: ViaConfig): ModelVia | null {
  const pinned = pinnedOf(cfg, h.route, h.rule);
  if (pinned) {
    if (pinned.some((p) => p.provider === h.provider && p.model === h.sent)) return "pinned";
    return h.plugin && h.sent !== h.client ? "plugin" : null;
  }
  const ofAlias = (name: string) => cfg.aliases.get(name)?.includes(h.sent) === true;
  if (h.sent === h.client) return ofAlias(h.client) ? "alias" : null;
  for (const name of h.rewrittenBy) {
    const to = ruleOf(cfg, h.route, name)?.set?.model;
    if (to && to !== h.client && (to === h.sent || ofAlias(to))) return "rule";
  }
  if (ofAlias(h.client)) return "alias";
  return h.plugin ? "plugin" : null;
}

/** 流量表上游那一格的标记：「别名」或「指定」。别的原因不在表里标 */
export interface RowMark {
  via: "alias" | "pinned";
  /** 服务它的那一跳发出的模型名 */
  sent: string;
  /** 决定去向的规则（「指定」的悬停要说是哪一条） */
  rule: string;
}

/**
 * 一行请求要不要标「别名」「指定」：看服务它的那一跳（尝试链的最后一跳）。没有发往任何上游的、
 * 本地应答的、还没有路由的、说不准的都不标。
 *
 * **「别名」只在发出的名称和客户端写的不同时标。**别名在官方上游往往就叫它自己（`claude-sonnet-5`
 * 在 anthropic 那里还是 `claude-sonnet-5`），每一条这样的请求都标上，表里满是一样的标记，而它们
 * 发出的正是模型那一列写的名称，没有要说的。是不是别名在详情的路由页里写。「指定」照样标：上游
 * 是规则指定的，名称相同也是。
 */
export function rowMark(
  r: Pick<RequestRow, "model" | "provider" | "local" | "sentModel" | "route" | "rule" | "rewrittenBy" | "pluginChanged">,
  cfg: ViaConfig | null,
): RowMark | null {
  if (!cfg || r.local || !r.provider || !r.model || r.route === undefined || r.rule === undefined) return null;
  const sent = r.sentModel ?? r.model;
  const via = hopVia(
    {
      client: r.model,
      provider: r.provider,
      sent,
      route: r.route,
      rule: r.rule,
      rewrittenBy: r.rewrittenBy ?? [],
      plugin: r.pluginChanged === true,
    },
    cfg,
  );
  if (via === "pinned" || (via === "alias" && sent !== r.model)) return { via, sent, rule: r.rule };
  return null;
}

/** 尝试链里一跳的模型那一格 */
export interface HopModel {
  /** 这一跳发出的模型名 */
  sent: string;
  /** 和客户端要的不同 */
  changed: boolean;
  via: ModelVia | null;
}

/** 详情「路由」页里和模型名有关的几项 */
export interface RoutingModels {
  /** 客户端写的是别名：别名的名称。有一跳按别名对上了才有 */
  alias: string | null;
  /** 决定去向的规则用了指定模型：规则的名称。有一跳对上了才有 */
  pinnedBy: string | null;
  /** 每一跳一项，和尝试链对齐 */
  hops: HopModel[];
  /** 尝试链里要不要写出每一跳的模型名：有改名、或者用了别名或指定模型时写 */
  show: boolean;
}

/**
 * 详情「路由」页的别名、指定模型两行和尝试链里每一跳的模型名。`plugins` 是这次请求上插件的
 * 运行记录：哪一跳的请求钩子改写过请求。
 */
export function routingModels(
  r: Pick<HistoryRow, "model" | "routing">,
  plugins: readonly PluginRunView[],
  cfg: ViaConfig | null,
): RoutingModels {
  const routing = r.routing;
  const attempts = routing?.attempts ?? [];
  const hops: HopModel[] = attempts.map((a, i) => {
    const sent = a.model || r.model;
    const changed = sent !== r.model;
    const via =
      cfg && routing && r.model
        ? hopVia(
            {
              client: r.model,
              provider: a.provider,
              sent,
              route: routing.route,
              rule: routing.rule,
              rewrittenBy: routing.rewritten_by,
              plugin: plugins.some((p) => p.attempt === i && p.hook === "request" && p.outcome === "changed"),
            },
            cfg,
          )
        : null;
    return { sent, changed, via };
  });
  const alias = hops.some((h) => h.via === "alias") ? r.model : null;
  const pinnedBy = routing && hops.some((h) => h.via === "pinned") ? routing.rule : null;
  return { alias, pinnedBy, hops, show: alias !== null || pinnedBy !== null || hops.some((h) => h.changed) };
}
