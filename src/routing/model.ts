/**
 * 路由页的草稿与换算。**纯函数**，对话框和列表共用，测试盯着这一层。
 *
 * 保存时交给 core 的是结构（`RouteInput`），规则的顺序就是数组的顺序。名字
 * 能不能用、条件写得对不对，最后由 core 说；这里只做对话框里需要实时给出
 * 的那几件事：保存按钮旁边缺什么、哪条规则被兜底挡住。
 */
import type {
  ClientView,
  ConditionView,
  GroupKind,
  GroupView,
  ProviderView,
  RouteView,
  RuleInput,
  RuleView,
} from "@/types";
import { ALL_UPSTREAMS, conditionName, groupKindLabel, targetLabel } from "@/labels";
import { protocolLabel } from "@/upstreams/labels";

// ---------------------------------------------------------------- 条件

export type CondKind = "glob" | "compare" | "flag" | "one" | "many";

export interface CondField {
  id: string;
  kind: CondKind;
  group: "请求" | "特征" | "来源" | "上游";
}

/** 能写的条件，按「添加条件」菜单里的分组和顺序 */
export const COND_FIELDS: CondField[] = [
  { id: "model", kind: "glob", group: "请求" },
  { id: "input_tokens", kind: "compare", group: "请求" },
  { id: "max_tokens", kind: "compare", group: "请求" },
  { id: "tool_count", kind: "compare", group: "请求" },
  { id: "cache", kind: "flag", group: "特征" },
  { id: "tools", kind: "flag", group: "特征" },
  { id: "image", kind: "flag", group: "特征" },
  { id: "thinking", kind: "flag", group: "特征" },
  { id: "stream", kind: "flag", group: "特征" },
  { id: "dialect", kind: "one", group: "来源" },
  { id: "intent", kind: "many", group: "来源" },
  { id: "client", kind: "one", group: "来源" },
  { id: "provider_would_be", kind: "many", group: "上游" },
];

export function condField(id: string): CondField {
  return COND_FIELDS.find((f) => f.id === id) ?? { id, kind: "one", group: "请求" };
}

/** 比较符。配置里写的是符号，界面上是词 */
export const COMPARE_OPS: { id: string; label: string }[] = [
  { id: ">", label: "大于" },
  { id: ">=", label: "不小于" },
  { id: "<", label: "小于" },
  { id: "<=", label: "不大于" },
  { id: "=", label: "等于" },
];

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
export function blankCondition(id: string): ConditionView {
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
  const name = conditionName(c.field);
  const values = c.values.map((v) => v.trim()).filter(Boolean);
  switch (condField(c.field).kind) {
    case "compare": {
      const [, amount] = splitCompare(values[0] ?? "");
      if (!amount) return `填写条件「${name}」的数值`;
      return validAmount(amount) ? null : `条件「${name}」的数值有误，示例：200k`;
    }
    case "flag":
      return null;
    default:
      return values.length ? null : `填写条件「${name}」的取值`;
  }
}

// ---------------------------------------------------------------- 规则草稿

export type Action = "forward" | "deny" | "continue";

export interface RuleDraft {
  /** 列表里的稳定标识。规则名在编辑中会变，不能拿来当 key */
  key: string;
  name: string;
  conditions: ConditionView[];
  action: Action;
  to: string;
  deny: string;
  model: string;
  maxTokens: string;
  thinking: "keep" | "on" | "off";
  redact: string[];
  untrusted: boolean;
}

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `r${seq}`;
}

export function blankRule(to = ALL_UPSTREAMS): RuleDraft {
  return {
    key: nextKey(),
    name: "",
    conditions: [],
    action: "forward",
    to,
    deny: "",
    model: "",
    maxTokens: "",
    thinking: "keep",
    redact: [],
    untrusted: false,
  };
}

export function draftFromView(r: RuleView): RuleDraft {
  return {
    key: nextKey(),
    name: r.name,
    conditions: r.conditions.map((c) => ({ field: c.field, values: [...c.values] })),
    action: r.to ? "forward" : r.deny != null ? "deny" : "continue",
    to: r.to ?? "",
    deny: r.deny ?? "",
    model: r.set?.model ?? "",
    maxTokens: r.set?.max_tokens != null ? String(r.set.max_tokens) : "",
    thinking: r.set?.thinking == null ? "keep" : r.set.thinking ? "on" : "off",
    redact: [...(r.guard?.redact ?? [])],
    untrusted: r.guard?.untrusted ?? false,
  };
}

export function copyDraft(d: RuleDraft): RuleDraft {
  return { ...d, key: nextKey(), conditions: d.conditions.map((c) => ({ ...c, values: [...c.values] })) };
}

/** 附加了改写或安全要求 */
export function hasAddOns(d: RuleDraft): boolean {
  return (
    d.model.trim() !== "" ||
    d.maxTokens.trim() !== "" ||
    d.thinking !== "keep" ||
    d.redact.length > 0 ||
    d.untrusted
  );
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
    model: d.model.trim() || null,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : null,
    thinking: d.thinking === "keep" ? null : d.thinking === "on",
  };
  const guard = { redact: d.redact, untrusted: d.untrusted };
  return {
    name: d.name.trim(),
    conditions,
    to: d.action === "forward" ? d.to : null,
    deny: deny ? d.deny.trim() : null,
    // 拒绝时附加项不起作用：不写进去
    set: !deny && (set.model || set.max_tokens || set.thinking != null) ? set : null,
    guard: !deny && (guard.redact.length || guard.untrusted) ? guard : null,
  };
}

/** 规则对话框里保存按钮旁边要说的：还缺什么。没问题时为空 */
export function ruleProblem(d: RuleDraft, takenNames: string[]): string | null {
  const name = d.name.trim();
  if (!name) return "填写规则名称";
  if (takenNames.includes(name)) return `规则名称「${name}」已存在`;
  for (const c of d.conditions) {
    const p = conditionProblem(c);
    if (p) return p;
  }
  if (d.action === "forward") {
    if (isPhaseTwo(d)) return "含「选定上游」条件的规则不能转发";
    if (!d.to) return "选择转发去向";
  }
  if (d.action === "deny" && !d.deny.trim()) return "填写拒绝原因";
  if (d.action === "continue" && !hasAddOns(d)) return "继续匹配的规则须设置改写参数或安全要求";
  const mt = d.maxTokens.trim();
  if (mt && !/^\d+$/.test(mt)) return "max_tokens 须为正整数";
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

/** 把被兜底挡住的规则挪到第一条兜底规则之前，其余次序不变 */
export function liftShadowed(rules: RuleDraft[]): RuleDraft[] {
  const notes = draftNotes(rules);
  const lifted = rules.filter((_, i) => notes[i]!.shadowed);
  const rest = rules.filter((_, i) => !notes[i]!.shadowed);
  const at = insertIndex(rest);
  return [...rest.slice(0, at), ...lifted, ...rest.slice(at)];
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

/** 列表「规则」一栏：按顺序列出决定去向的规则。被挡住的、只附加的不列 */
export function flowOf(route: RouteView): { rule: string; target: string | null }[] {
  return route.rules
    .filter((r) => !r.shadowed && !r.phase_two && (r.to || r.deny != null))
    .map((r) => ({ rule: r.name, target: r.to ? targetLabel(r.to) : null }));
}

/** 列表「规则」一栏的次行：规则数，以及需要留意的事 */
export function routeSummary(route: RouteView): { text: string; warn: boolean } {
  const parts = [`${route.rules.length} 条规则`];
  const shadowed = route.rules.filter((r) => r.shadowed).length;
  if (shadowed > 0) parts.push(`${shadowed} 条位于兜底规则之后，不会生效`);
  if (!route.has_catch_all) parts.push("尚无兜底规则");
  return { text: parts.join(" · "), warn: shadowed > 0 || !route.has_catch_all };
}

/** 去向的说明：策略组的策略与成员，或上游的协议 */
export function describeTarget(
  name: string,
  groups: GroupView[],
  providers: ProviderView[],
): string {
  const g = groups.find((x) => x.name === name);
  if (g) {
    if (g.builtin) return "内置策略组 · 按上游列表顺序";
    const members = membersText(g);
    return `策略组 · ${groupKindLabel(g.kind)}${members ? `：${members}` : ""}`;
  }
  const p = providers.find((x) => x.name === name);
  if (p) return `上游 · ${protocolLabel(p.protocol)}${p.disabled ? " · 已停用" : ""}`;
  return "不存在的去向";
}

/** 成员怎么写：有先后的用「→」连，其余用顿号 */
export function membersText(g: Pick<GroupView, "kind" | "providers" | "selected">): string {
  const ordered = g.kind === "fallback" || g.kind === "select";
  if (g.kind === "select" && g.selected) {
    const rest = g.providers.filter((p) => p !== g.selected);
    return [g.selected, ...rest].join(" → ");
  }
  return g.providers.join(ordered ? " → " : "、");
}

/** 规则的附加项写成一句：`模型改为 claude-haiku-4-5 · 额外脱敏 2 类` */
export function addOnsText(d: RuleDraft): string {
  const parts: string[] = [];
  if (d.model.trim()) parts.push(`模型改为 ${d.model.trim()}`);
  if (d.maxTokens.trim()) parts.push(`max_tokens 改为 ${d.maxTokens.trim()}`);
  if (d.thinking !== "keep") parts.push(d.thinking === "on" ? "开启扩展思考" : "关闭扩展思考");
  if (d.redact.length) parts.push(`额外脱敏 ${d.redact.length} 类`);
  if (d.untrusted) parts.push("按非官方端点处理");
  return parts.join(" · ");
}

/** 策略组的策略，附一句会影响用户决定的说明 */
export const STRATEGIES: { id: GroupKind; desc: string }[] = [
  { id: "fallback", desc: "依次使用成员，前一个不可用时使用下一个。" },
  { id: "select", desc: "使用选定的上游；它不可用时，按顺序使用其余成员。" },
  { id: "load-balance", desc: "在成员之间轮流分配请求。" },
  { id: "url-test", desc: "优先使用首字节时间最短的上游。" },
  { id: "cheapest", desc: "优先使用输入单价最低的上游。" },
];

/** 客户端格式：规则条件和试算里可选的几种 */
export const DIALECTS = ["anthropic", "openai-chat", "openai-responses", "gemini"];

/** 辅助请求的类别（不含总称） */
export const PROBE_IDS = ["health_check", "warmup", "titling", "topic_detect", "suggestion"];
