/**
 * 路由页的草稿与换算。**纯函数**，对话框和列表共用，测试盯着这一层。
 *
 * 保存时交给 core 的是结构（`RouteInput`），规则的顺序就是数组的顺序。名字
 * 能不能用、条件写得对不对，最后由 core 说；这里只做对话框里需要实时给出
 * 的那几件事：保存按钮旁边缺什么、哪条规则被兜底挡住。
 */
import type { ClientView, ConditionField, ConditionView, Dialect, DryRunResult, GroupKind, GroupView, KnownModel, PinnedModel, ProviderView, RouteView, RuleInput, RuleView } from "@/types";
import { textOf } from "@/i18n";
import { ALL_UPSTREAMS, balanceByLabel, conditionName, groupKindLabel, targetLabel } from "@/labels";
import { protocolLabel } from "@/upstreams/labels";
import { modelText } from "./model.i18n";
import { routingText } from "./routing.i18n";
import { aliasNamed, hasTarget, pinnedOf, pinnedText, targetNameOf } from "./target";

// ---------------------------------------------------------------- 条件

export type CondKind = "glob" | "compare" | "flag" | "one" | "many";

/** 「添加条件」菜单里的分组。显示的名字见 `condGroupLabel` */
export type CondGroup = "request" | "features" | "source" | "upstream";

export interface CondField {
  id: ConditionField;
  kind: CondKind;
  group: CondGroup;
}

/** 能写的条件，按「添加条件」菜单里的分组和顺序 */
export const COND_FIELDS: CondField[] = [
  { id: "model", kind: "glob", group: "request" },
  { id: "input_tokens", kind: "compare", group: "request" },
  { id: "max_tokens", kind: "compare", group: "request" },
  { id: "tool_count", kind: "compare", group: "request" },
  { id: "cache", kind: "flag", group: "features" },
  { id: "tools", kind: "flag", group: "features" },
  { id: "image", kind: "flag", group: "features" },
  { id: "thinking", kind: "flag", group: "features" },
  { id: "stream", kind: "flag", group: "features" },
  { id: "dialect", kind: "one", group: "source" },
  { id: "intent", kind: "many", group: "source" },
  { id: "client", kind: "one", group: "source" },
  { id: "provider_would_be", kind: "many", group: "upstream" },
];

export function condField(id: ConditionField): CondField {
  return COND_FIELDS.find((f) => f.id === id) ?? { id, kind: "one", group: "request" };
}

export function condGroupLabel(group: CondGroup): string {
  return textOf(modelText).condGroups[group];
}

/** 比较符。配置里写的是符号，界面上是词 */
export function compareOps(): { id: string; label: string }[] {
  const t = textOf(modelText).compareOps;
  return [
    { id: ">", label: t.gt },
    { id: ">=", label: t.ge },
    { id: "<", label: t.lt },
    { id: "<=", label: t.le },
    { id: "=", label: t.eq },
  ];
}

/** `>200k` → `[">", "200k"]`。写不出比较符的原样放进数值里，让校验说话 */
export function splitCompare(v: string): [string, string] {
  const m = /^\s*(>=|<=|==|=|>|<)\s*(.*)$/.exec(v);
  if (!m) return [">", v.trim()];
  return [m[1] === "==" ? "=" : m[1]!, m[2]!.trim()];
}

/** 比较式里的数：`200k`、`1.5m`、`8` */
export function validAmount(v: string): boolean {
  return /^\d+(\.\d+)?[kKmM]?$/.test(v.trim());
}

/** 一个新加的条件的初始值 */
export function blankCondition(id: ConditionField): ConditionView {
  switch (condField(id).kind) {
    case "flag":
      return { field: id, values: ["true"] };
    case "compare":
      return { field: id, values: [">"] };
    case "one":
      return { field: id, values: id === "dialect" ? ["anthropic"] : [] };
    default:
      return { field: id, values: [] };
  }
}

/** 条件缺什么。没问题时为空 */
export function conditionProblem(c: ConditionView): string | null {
  const t = textOf(modelText);
  const name = conditionName(c.field);
  const values = c.values.map((v) => v.trim()).filter(Boolean);
  switch (condField(c.field).kind) {
    case "compare": {
      const [, amount] = splitCompare(values[0] ?? "");
      if (!amount) return t.amountMissing(name);
      return validAmount(amount) ? null : t.amountInvalid(name);
    }
    case "flag":
      return null;
    default:
      return values.length ? null : t.valueMissing(name);
  }
}

// ---------------------------------------------------------------- 规则草稿

export type Action = "forward" | "deny" | "continue";

/** 转发至：上游或策略组（`to` 是名称），或指定模型（`to` 是「上游 + 模型」的列表） */
export type ToKind = "target" | "pinned";

/** 指定模型列表里的一行。`key` 只给列表用：删掉中间一行时，后面几行的输入框不串 */
export interface PinnedDraft extends PinnedModel {
  key: string;
}

export interface RuleDraft {
  /** 列表里的稳定标识。规则名在编辑中会变，不能拿来当 key */
  key: string;
  /**
   * 这条规则保存时的名字：新加的、复制出来的为空。命中数按保存时的名字记，
   * 草稿里改了名也还是它
   */
  saved: string | null;
  name: string;
  conditions: ConditionView[];
  action: Action;
  toKind: ToKind;
  /** 上游或策略组的名称 */
  to: string;
  /** 指定模型，按顺序备用 */
  pinned: PinnedDraft[];
  deny: string;
  model: string;
  maxTokens: string;
  thinking: "keep" | "on" | "off";
}

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `r${seq}`;
}

export function blankRule(to = ALL_UPSTREAMS): RuleDraft {
  return {
    key: nextKey(),
    saved: null,
    name: "",
    conditions: [],
    action: "forward",
    toKind: "target",
    to,
    pinned: [],
    deny: "",
    model: "",
    maxTokens: "",
    thinking: "keep",
  };
}

export function blankPinned(provider = "", model = ""): PinnedDraft {
  return { key: nextKey(), provider, model };
}

export function draftFromView(r: RuleView): RuleDraft {
  const pinned = pinnedOf(r.to);
  return {
    key: nextKey(),
    saved: r.name,
    name: r.name,
    conditions: r.conditions.map((c) => ({ field: c.field, values: [...c.values] })),
    action: hasTarget(r.to) ? "forward" : r.deny != null ? "deny" : "continue",
    toKind: pinned ? "pinned" : "target",
    to: targetNameOf(r.to) ?? "",
    pinned: (pinned ?? []).map((p) => blankPinned(p.provider, p.model)),
    deny: r.deny ?? "",
    model: r.set?.model ?? "",
    maxTokens: r.set?.max_tokens != null ? String(r.set.max_tokens) : "",
    thinking: r.set?.thinking == null ? "keep" : r.set.thinking ? "on" : "off",
  };
}

export function copyDraft(d: RuleDraft): RuleDraft {
  return {
    ...d,
    key: nextKey(),
    saved: null,
    conditions: d.conditions.map((c) => ({ ...c, values: [...c.values] })),
    pinned: d.pinned.map((p) => blankPinned(p.provider, p.model)),
  };
}

/** 转发到指定模型：模型名原样发出，「模型改为」不起作用（界面上不出现，也不写进配置） */
export function isPinned(d: RuleDraft): boolean {
  return d.action === "forward" && d.toKind === "pinned";
}

/** 「模型改为」的值。转发到指定模型时不算 */
function setModelOf(d: RuleDraft): string {
  return isPinned(d) ? "" : d.model.trim();
}

/** 附加了改写 */
export function hasAddOns(d: RuleDraft): boolean {
  return setModelOf(d) !== "" || d.maxTokens.trim() !== "" || d.thinking !== "keep";
}

/** 在选定上游之后才判断：条件里有「选定上游」 */
export function isPhaseTwo(d: RuleDraft): boolean {
  return d.conditions.some((c) => c.field === "provider_would_be");
}

/** 草稿 → 交给 core 的规则 */
export function draftToInput(d: RuleDraft): RuleInput {
  const conditions = d.conditions.map((c) => {
    const values = c.values.map((v) => v.trim()).filter(Boolean);
    if (condField(c.field).kind === "compare") {
      const [op, amount] = splitCompare(values[0] ?? "");
      return { field: c.field, values: [`${op}${amount}`] };
    }
    return { field: c.field, values };
  });
  const deny = d.action === "deny";
  const maxTokens = Number.parseInt(d.maxTokens.trim(), 10);
  const set = {
    model: setModelOf(d) || null,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null,
    thinking: d.thinking === "keep" ? null : d.thinking === "on",
  };
  return {
    name: d.name.trim(),
    conditions,
    to:
      d.action !== "forward"
        ? null
        : d.toKind === "pinned"
          ? d.pinned.map((p) => ({ provider: p.provider.trim(), model: p.model.trim() }))
          : d.to,
    deny: deny ? d.deny.trim() : null,
    // 拒绝时附加项不起作用：不写进去
    set: !deny && (set.model || set.max_tokens || set.thinking != null) ? set : null,
  };
}

/** 规则对话框里保存按钮旁边要说的：还缺什么。没问题时为空 */
export function ruleProblem(d: RuleDraft, takenNames: string[]): string | null {
  const t = textOf(modelText);
  const name = d.name.trim();
  if (!name) return t.ruleNameMissing;
  if (takenNames.includes(name)) return t.ruleNameTaken(name);
  for (const c of d.conditions) {
    const p = conditionProblem(c);
    if (p) return p;
  }
  if (d.action === "forward") {
    if (isPhaseTwo(d)) return t.phaseTwoForward;
    if (d.toKind === "pinned") {
      if (d.pinned.length === 0) return t.pinnedMissing;
      for (const [i, p] of d.pinned.entries()) {
        if (!p.provider.trim()) return t.pinnedProviderMissing(i + 1);
        if (!p.model.trim()) return t.pinnedModelMissing(i + 1);
      }
    } else if (!d.to) return t.targetMissing;
  }
  if (d.action === "deny" && !d.deny.trim()) return t.denyReasonMissing;
  if (d.action === "continue" && !hasAddOns(d)) return t.continueNeedsAddOns;
  // 正整数：「0」过得了 `\d+`，写回去时却被当成没填丢掉（`draftToInput`），一条只改
  // max_tokens 的规则就成了什么都不改
  const mt = d.maxTokens.trim();
  if (mt && !/^[1-9]\d*$/.test(mt)) return t.maxTokensInvalid;
  return null;
}

// ---------------------------------------------------------------- 规则在路由里的处境

export interface Notes {
  catchAll: boolean;
  phaseTwo: boolean;
  /** 转发或拒绝不会被采用：前面已有一条匹配全部请求的转发或拒绝 */
  shadowed: boolean;
}

/**
 * 每条草稿规则的处境。
 *
 * **和 core 的 `tw_engine::notes` 是同一条规则**：已保存的路由由 core 给出，
 * 这里只算对话框里还没保存的那份，好在排序、添加的时候立刻提示。
 */
export function draftNotes(rules: RuleDraft[]): Notes[] {
  let decided = false;
  return rules.map((r) => {
    const phaseTwo = isPhaseTwo(r);
    const catchAll = r.conditions.length === 0;
    const decides = r.action !== "continue";
    const shadowed = !phaseTwo && decides && decided;
    if (!phaseTwo && catchAll && decides) decided = true;
    return { catchAll, phaseTwo, shadowed };
  });
}

export function hasCatchAll(rules: RuleDraft[]): boolean {
  return rules.some((r) => !isPhaseTwo(r) && r.conditions.length === 0 && r.action !== "continue");
}

/** 「添加规则」插在哪儿：第一条兜底规则之前；没有兜底就在末尾 */
export function insertIndex(rules: RuleDraft[]): number {
  const i = rules.findIndex((r) => !isPhaseTwo(r) && r.conditions.length === 0 && r.action !== "continue");
  return i < 0 ? rules.length : i;
}

/**
 * 把被兜底挡住的规则挪到第一条兜底规则之前，其余次序不变。
 *
 * **被挡住的兜底规则不挪**：两条兜底规则怎么排都是一条挡住另一条（复制一条兜底规则就是
 * 这样），挪过去只是换成另一条被挡住。那一条该删，不是该挪（见 [`canLift`]）
 */
export function liftShadowed(rules: RuleDraft[]): RuleDraft[] {
  const notes = draftNotes(rules);
  const lifts = (i: number) => notes[i]!.shadowed && !notes[i]!.catchAll;
  const lifted = rules.filter((_, i) => lifts(i));
  const rest = rules.filter((_, i) => !lifts(i));
  const at = insertIndex(rest);
  return [...rest.slice(0, at), ...lifted, ...rest.slice(at)];
}

/** 有没有挪得动的：被挡住的里面有不是兜底规则的 */
export function canLift(rules: RuleDraft[]): boolean {
  const notes = draftNotes(rules);
  return notes.some((n) => n.shadowed && !n.catchAll);
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, it!);
  return out;
}

// ---------------------------------------------------------------- 列表与说明

/** 这条路由被哪些密钥使用：指定了它的，加上默认路由的那些没指定路由的 */
export function usersOf(route: RouteView, clients: ClientView[]): string[] {
  return clients
    .filter((c) => c.route === route.name || (route.default && !c.route))
    .map((c) => c.name);
}

/**
 * 列表「规则」一栏：按顺序列出决定去向的规则。被挡住的、只附加的不列。
 * `name` 是配置里的去向（拿来认上游的标志；指定模型时是第一个上游），`target` 是显示的
 * 名字；拒绝时两个都是空。
 */
export function flowOf(route: RouteView): { rule: string; name: string | null; target: string | null }[] {
  return route.rules
    .filter((r) => !r.shadowed && !r.phase_two && (hasTarget(r.to) || r.deny != null))
    .map((r) => {
      const pinned = pinnedOf(r.to);
      if (pinned?.length) return { rule: r.name, name: pinned[0]!.provider, target: pinnedSummary(pinned) };
      const to = targetNameOf(r.to);
      return { rule: r.name, name: to, target: to ? targetLabel(to) : null };
    });
}

/** 指定模型写成一行：`bedrock · us.anthropic.claude-opus-5-v1:0，备用 1 个` */
export function pinnedSummary(pinned: readonly PinnedModel[]): string {
  const first = pinned[0];
  if (!first) return "";
  const rest = pinned.length - 1;
  return rest > 0 ? textOf(modelText).withBackups(pinnedText(first), rest) : pinnedText(first);
}

/** 一条路由需要留意的事：有规则被兜底挡住、没有兜底规则。没有就是空 */
export function routeProblems(route: RouteView): string[] {
  const t = textOf(modelText);
  const out: string[] = [];
  const shadowed = route.rules.filter((r) => r.shadowed).length;
  if (shadowed > 0) out.push(t.shadowedCount(shadowed));
  if (!route.has_catch_all) out.push(t.noCatchAll);
  return out;
}

// ---------------------------------------------------------------- 轮询组的比例

/** 权重的范围，和 core 的校验一样（`engine.group_weight_out_of_range`） */
export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 100;

/** 对话框里填的权重：1 到 100 的整数，别的（空、小数、超出范围）是 null */
export function parseWeight(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= WEIGHT_MIN && n <= WEIGHT_MAX ? n : null;
}

/** 成员在轮询组里的权重。core 给每个成员都列了，没列到的（别的类型）按 1 */
export function weightOf(g: Pick<GroupView, "weights">, member: string): number {
  return g.weights[member] ?? 1;
}

/**
 * 轮询组的比例，按成员的顺序：`7 : 3`。**权重都是 1 时没有** —— 那就是平均分，
 * 写出 `1 : 1 : 1` 只是噪音。别的类型不用权重，也没有
 */
export function ratioText(g: Pick<GroupView, "kind" | "providers" | "weights">): string | null {
  if (g.kind !== "load-balance") return null;
  const ws = g.providers.map((p) => weightOf(g, p));
  return ws.some((w) => w !== 1) ? ws.join(" : ") : null;
}

/**
 * 轮询组在策略名之外要说的：比例（不是平均分时）、分配依据（不是只看比例时）。
 * 别的类型、两样都是默认值时是空的
 */
export function balanceNotes(g: Pick<GroupView, "kind" | "providers" | "weights" | "balance_by">): string[] {
  if (g.kind !== "load-balance") return [];
  const out: string[] = [];
  const ratio = ratioText(g);
  if (ratio) out.push(ratio);
  if (g.balance_by !== "weights") out.push(balanceByLabel(g.balance_by));
  return out;
}

/** 策略名，轮询组带上比例和分配依据：`轮询（7 : 3 · 按速度）` */
export function strategyText(g: Pick<GroupView, "kind" | "providers" | "weights" | "balance_by">): string {
  const kind = groupKindLabel(g.kind);
  const notes = balanceNotes(g);
  return notes.length ? textOf(modelText).withNotes(kind, notes.join(" · ")) : kind;
}

/**
 * 试算里轮询组每个候选这一轮分到请求的份额，0 到 1，和 `r.candidate_models` 一一对应；
 * 不是轮询组（候选没有权重）的是 null。
 *
 * 和 core 排头用的同一个数：权重 × 系数（`balance_factor`，只看比例时是 1）。**熔断着的
 * 这一轮不参加**（份额是 0，排到它的那一次本来就会被跳过），全都熔断着时都算
 */
export function balanceShares(r: Pick<DryRunResult, "candidate_models" | "circuit_open">): (number | null)[] {
  const members = r.candidate_models.filter((c) => c.weight != null);
  const sitOut = members.every((c) => r.circuit_open.includes(c.provider)) ? [] : r.circuit_open;
  const eff = (c: (typeof members)[number]) =>
    sitOut.includes(c.provider) ? 0 : (c.weight ?? 0) * (c.balance_factor ?? 1);
  const total = members.reduce((a, c) => a + eff(c), 0);
  return r.candidate_models.map((c) => (c.weight == null ? null : total > 0 ? eff(c) / total : 0));
}

/** 去向的说明：策略组的策略与成员，或上游的协议 */
export function describeTarget(
  name: string,
  groups: GroupView[],
  providers: ProviderView[],
): string {
  const t = textOf(modelText);
  const g = groups.find((x) => x.name === name);
  if (g) {
    if (g.builtin) return t.builtinGroup;
    const members = membersText(g);
    return t.groupTarget(strategyText(g), members);
  }
  const p = providers.find((x) => x.name === name);
  if (p) return t.upstreamTarget(protocolLabel(p.protocol), p.disabled);
  return t.unknownTarget;
}

/** 成员怎么写：有先后的用「→」连，其余用顿号 */
export function membersText(g: Pick<GroupView, "kind" | "providers" | "selected">): string {
  const ordered = g.kind === "fallback" || g.kind === "select";
  if (g.kind === "select" && g.selected) {
    const rest = g.providers.filter((p) => p !== g.selected);
    return [g.selected, ...rest].join(" → ");
  }
  return g.providers.join(ordered ? " → " : textOf(routingText).listSep);
}

/**
 * 规则的附加项写成一句：`模型改为 claude-haiku-4-5 · max_tokens 4096`。改成的是别名时说明
 * 它按别名表对应到各上游（`known` 是 `/models` 的目录，不给就不说）
 */
export function addOnsText(d: RuleDraft, known: readonly KnownModel[] = []): string {
  const t = textOf(modelText);
  const parts: string[] = [];
  const model = setModelOf(d);
  if (model) parts.push(aliasNamed(model, known) ? t.setModelAlias(model) : t.setModel(model));
  if (d.maxTokens.trim()) parts.push(t.setMaxTokens(d.maxTokens.trim()));
  if (d.thinking !== "keep") parts.push(d.thinking === "on" ? t.thinkingOn : t.thinkingOff);
  return parts.join(" · ");
}

/** 策略组的策略，附一句会影响用户决定的说明 */
export function strategies(): { id: GroupKind; desc: string }[] {
  const t = textOf(modelText).strategies;
  return [
    { id: "fallback", desc: t.fallback },
    { id: "select", desc: t.select },
    { id: "load-balance", desc: t.loadBalance },
    { id: "url-test", desc: t.urlTest },
    { id: "cheapest", desc: t.cheapest },
  ];
}

/** 客户端格式：规则条件和试算里可选的几种 */
export const DIALECTS: readonly Dialect[] = ["anthropic", "openai-chat", "openai-responses", "gemini"];
