/**
 * 规则表和规则对话框里不画东西的那部分：分组、检索、内容规则
 * 「检查对象」和「动作」「匹配方式」的联动。拆出来是为了能单独测。
 */
import type {
  ContentMatch,
  ContentScope,
  Guard,
  OutcomeDetail,
  RuleAction,
  SecurityRuleHits,
  SecurityRuleView,
} from "@/types";

/** 规则表里的一组：内置规则按类别各一组，自定义规则在最后一组 */
export interface RuleGroup<T> {
  /** 类别（`ai-services`、`invisible`…）；工具调用的内置规则是 `command`；自定义的是 `custom` */
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

/** 规则的键：内置和自定义可以同名。安全日志的一条按同样的写法认出是哪条规则 */
export const ruleKey = (r: Pick<SecurityRuleView, "custom" | "id">) => `${r.custom ? "c" : "b"}:${r.id}`;

// ------------------------------------------------------------------ 组头的命中次数

/** 一段时间里每条规则命中了几次（键见 `ruleKey`），core 按规则数好的 */
export type RuleHits = Record<string, number>;

export function countHits(rows: readonly Pick<SecurityRuleHits, "rule" | "custom" | "count">[]): RuleHits {
  const counts: RuleHits = {};
  for (const h of rows) {
    const k = ruleKey({ custom: h.custom, id: h.rule });
    counts[k] = (counts[k] ?? 0) + h.count;
  }
  return counts;
}

/** 一组规则一共几条命中。还没读到是 `undefined` */
export function hitsOf(hits: RuleHits | undefined, rules: readonly SecurityRuleView[]): number | undefined {
  if (!hits) return undefined;
  return rules.reduce((n, r) => n + (hits[ruleKey(r)] ?? 0), 0);
}

/**
 * 有命中的组排在内置规则的最前面，其余照 core 的顺序（两部分里各自不变）；自定义的那一组
 * 照旧在最后。命中次数还没读到时原样不动
 */
export function hitsFirst<T>(groups: readonly RuleGroup<T>[], hit: (g: RuleGroup<T>) => boolean): RuleGroup<T>[] {
  const builtin = groups.filter((g) => !g.custom);
  return [
    ...builtin.filter(hit),
    ...builtin.filter((g) => !hit(g)),
    ...groups.filter((g) => g.custom),
  ];
}

// ------------------------------------------------------------------ 组的展开

/**
 * 规则表里哪几组展开着。**默认全部收起**；展开、收起是看的人自己的选择，按防护各记一份、
 * 记在这台机器上。存的是展开着的那几组
 */
const openKey = (guard: Guard) => `security.groups.${guard}`;

export function readOpenGroups(guard: Guard): Set<string> {
  try {
    const raw = window.localStorage.getItem(openKey(guard));
    const keys: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : []);
  } catch {
    // 隐私窗口、禁用站点数据、存的东西坏了：照默认全部收起
    return new Set();
  }
}

export function writeOpenGroups(guard: Guard, open: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(openKey(guard), JSON.stringify([...open]));
  } catch {
    // 记不住只是下次要再展开一次
  }
}

/**
 * 一组现在展开没有。**检索时匹配的组一律展开**（筛出来的行要看得见），除非这一次检索里
 * 又被收起了（`closedInSearch`，换了检索词就清掉）；不检索时按记下的
 */
export function groupOpen(
  key: string,
  searching: boolean,
  open: ReadonlySet<string>,
  closedInSearch: ReadonlySet<string>,
): boolean {
  return searching ? !closedInSearch.has(key) : open.has(key);
}

/**
 * 一条规则写的是什么，拿来检索：正则、要找的文字、码位、前缀、域名后缀、变量名和字段名。代码里做的检查
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
    case "prefixes":
      return m.prefixes.map((p) => p.prefix).join(" ");
    case "assignment":
      return m.suffixes.join(" ");
    case "labeled":
      return m.names.join(" ");
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
