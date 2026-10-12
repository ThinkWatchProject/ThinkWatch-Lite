/**
 * 规则表和规则对话框里不画东西的那部分：分组、检索、组标题复选框的状态、内容规则
 * 「检查对象」和「动作」「匹配方式」的联动。拆出来是为了能单独测。
 */
import type { ContentMatch, ContentScope, Guard, OutcomeDetail, RuleAction, SecurityRuleView } from "@/types";

/** 规则表里的一组：内置规则按类别各一组，自定义规则在最后一组 */
export interface RuleGroup<T> {
  /** 类别（`api-keys`、`invisible`…）；工具调用的内置规则是 `command`；自定义的是 `custom` */
  key: string;
  custom: boolean;
  rows: T[];
}

/**
 * 按 core 给的顺序把规则分成几组。**同一类别不连着的也归进同一组**（core 给的顺序里同类
 * 本来就挨着，这里不依赖它），组的先后按各类第一次出现的位置；自定义的总在最后。
 */
export function groupRules<T>(rows: readonly T[], ruleOf: (row: T) => SecurityRuleView): RuleGroup<T>[] {
  const out: RuleGroup<T>[] = [];
  const byKey = new Map<string, RuleGroup<T>>();
  let custom: RuleGroup<T> | null = null;
  for (const row of rows) {
    const r = ruleOf(row);
    if (r.custom) {
      custom ??= { key: "custom", custom: true, rows: [] };
      custom.rows.push(row);
      continue;
    }
    let g = byKey.get(r.kind);
    if (!g) {
      g = { key: r.kind, custom: false, rows: [] };
      byKey.set(r.kind, g);
      out.push(g);
    }
    g.rows.push(row);
  }
  if (custom) out.push(custom);
  return out;
}

/** 组标题复选框：全部启用、部分启用（半选）、全部停用 */
export function groupChecked(rules: readonly Pick<SecurityRuleView, "enabled">[]): boolean | "indeterminate" {
  const on = rules.filter((r) => r.enabled).length;
  return on === 0 ? false : on === rules.length ? true : "indeterminate";
}

/** 点组标题复选框之后要的状态：全部启用时全部停用，否则全部启用 */
export function groupTarget(rules: readonly Pick<SecurityRuleView, "enabled">[]): boolean {
  return groupChecked(rules) !== true;
}

/**
 * 一条规则写的是什么，拿来检索：正则、要找的文字、码位、前缀、域名后缀。代码里做的检查
 * 和没有写法的内置规则（PEM、JWT…）是空的，只按名字找得到
 */
export function patternText(r: SecurityRuleView): string {
  const m = r.matcher;
  switch (m.kind) {
    case "regex":
      return m.pattern;
    case "contains":
      return m.text;
    case "codepoints":
      return m.ranges.join(" ");
    case "prefix":
      return m.prefix;
    case "domain-suffix":
      return m.suffixes.join(" ");
    default:
      return "";
  }
}

/** 检索框里的字能不能在这条规则的名字（界面上的、英文的、id）或写法里找到。不分大小写 */
export function ruleMatches(r: SecurityRuleView, shownName: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  return [shownName, r.name, r.id, patternText(r)].some((s) => s.toLowerCase().includes(q));
}

// ------------------------------------------------------------------ 缺省值

/** 内容规则「替换」的缺省文字 */
export const DEFAULT_REPLACEMENT = "***";

/** 一条规则查哪一边。core 不给（内置规则、别的防护）就是只查请求 */
export function scopeOf(r: Pick<SecurityRuleView, "scope">): ContentScope[] {
  return r.scope && r.scope.length > 0 ? r.scope : ["request"];
}

/** 一条规则在「开启」档下做什么。不给时：密钥与隐私是替换为占位符，其余是仅记录 */
export function actionOf(guard: Guard, r: Pick<SecurityRuleView, "action">): RuleAction {
  return r.action ?? (guard === "redact" ? "placeholder" : "record");
}

/**
 * 「已替换」具体换成了什么：密钥与隐私是一组占位符，内容过滤是几处换成同一段文字
 * （带着 `replacement` 的是内容过滤）
 */
export function replacedOf(
  d: Extract<OutcomeDetail, { action: "replaced" }>,
): { kind: "placeholders"; placeholders: string[] } | { kind: "text"; segments: number; replacement: string } {
  if (d.replacement != null) return { kind: "text", segments: d.segments ?? 1, replacement: d.replacement };
  return { kind: "placeholders", placeholders: d.placeholders };
}

// ------------------------------------------------------------------ 内容规则对话框的联动

/** 检查对象的三个选项 */
export type ScopeChoice = "request" | "response" | "both";

export function scopeChoice(scope: readonly ContentScope[]): ScopeChoice {
  const req = scope.includes("request");
  const res = scope.includes("response");
  return req && res ? "both" : res ? "response" : "request";
}

export function scopeOfChoice(c: ScopeChoice): ContentScope[] {
  return c === "both" ? ["request", "response"] : [c];
}

/** 查回答吗。查回答时「拒绝」和「码位」不可选（规格 §5.2） */
export const coversAnswer = (c: ScopeChoice) => c !== "request";

/** 这个动作在这个检查对象下能不能选 */
export function actionAllowed(guard: Guard, action: RuleAction, c: ScopeChoice): boolean {
  return !(guard === "content" && action === "block" && coversAnswer(c));
}

/** 这种匹配方式在这个检查对象下能不能选 */
export function matchAllowed(match: ContentMatch, c: ScopeChoice): boolean {
  return !(match === "codepoints" && coversAnswer(c));
}

/**
 * 换了检查对象之后：选着的动作、匹配方式在新的检查对象下不可选的，自动换成可选的那一个
 * （拒绝 → 删除，码位 → 包含），并说明换了哪几项（对话框在对应控件下方提示）
 */
export function adjustForScope(
  c: ScopeChoice,
  action: RuleAction,
  match: ContentMatch,
): { action: RuleAction; match: ContentMatch; changed: { action: boolean; match: boolean } } {
  const a = actionAllowed("content", action, c) ? action : "strip";
  const m = matchAllowed(match, c) ? match : "contains";
  return { action: a, match: m, changed: { action: a !== action, match: m !== match } };
}
