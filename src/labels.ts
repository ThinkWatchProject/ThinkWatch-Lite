/**
 * core 发来的标识符在界面上的叫法。
 *
 * **取值来自固定集合的字段，core 只发标识符，叫法由界面决定。**以前 core
 * 发的是中文标签，界面只能拿显示文字做判断，core 改一个措辞，这边的判断
 * 就悄悄失效了。同一个标识符在概览、详情、试运行里必须是同一个词，所以
 * 集中在这里。上游页自己的那些在 `upstreams/labels.ts`。
 */
import { textOf } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import {
  usd,
  type AttemptView,
  type ConditionView,
  type ConfigOrigin,
  type ConfigStage,
  type GroupKind,
  type MismatchView,
  type ReplayQuote,
  type SetView,
  type TakesEffect,
  type TranslatedView,
} from "./types";
import { PROTOCOLS } from "./upstreams/labels";
import { labelsText } from "./labels.i18n";

/*
 * 显示文字都在 `labels.i18n.ts`，每次调用都按当时的语言取（`textOf`）。
 * 导出的两张表（`GROUP_KINDS`、`PROBES`）把文字写成 getter：表留在模块级，
 * 引用它的地方照旧读 `.label`、`.what` —— 读取都发生在渲染里，换了语言，
 * 下一次渲染就是新的文字。
 */

// ---------------------------------------------------------------- 路由

export const GROUP_KINDS: { id: GroupKind; label: string }[] = (
  ["fallback", "select", "load-balance", "url-test", "cheapest"] as const
).map((id) => ({
  id,
  get label() {
    return textOf(labelsText).groupKinds[id];
  },
}));

export function groupKindLabel(kind: GroupKind): string {
  return textOf(labelsText).groupKinds[kind];
}

/** 内置策略组在配置里的名字。**界面上不出现它**，显示为「全部上游」 */
export const ALL_UPSTREAMS = "__all__";

/** 规则去向、策略组、流量详情里的一个策略组或上游名 */
export function targetLabel(name: string): string {
  return name === ALL_UPSTREAMS ? textOf(labelsText).allUpstreams : name;
}

/** 客户端和上游的格式。和上游协议同一个词表，认不出时原样显示 */
export function formatLabel(id: string): string {
  return PROTOCOLS.find((p) => p.id === id)?.label ?? id;
}

/** 客户端辅助请求的类别，和路由条件 `intent` 同一个词表 */
export const PROBES: { id: string; label: string; what: string }[] = (
  ["health_check", "warmup", "titling", "topic_detect", "suggestion"] as const
).map((id) => ({
  id,
  get label() {
    return textOf(labelsText).probes[id].label;
  },
  get what() {
    return textOf(labelsText).probes[id].what;
  },
}));

export function probeLabel(id: string): string {
  return PROBES.find((p) => p.id === id)?.label ?? id;
}

/** 布尔条件满足和不满足时的说法 */
function flagOf(field: string): { yes: string; no: string } | undefined {
  const flags: Record<string, { yes: string; no: string }> = textOf(labelsText).flags;
  return flags[field];
}

function nameOf(field: string): string | undefined {
  const names: Record<string, string> = textOf(labelsText).conditionNames;
  return names[field];
}

/** 条件的名称。是否类条件用「满足」时的说法 */
export function conditionName(field: string): string {
  return flagOf(field)?.yes ?? nameOf(field) ?? field;
}

/** 值是比较式的条件 */
const COUNTS = new Set(["input_tokens", "max_tokens", "tool_count"]);

/** 条件里写的值怎么念：辅助请求和格式换成名称，其余原样 */
function conditionValue(field: string, value: string): string {
  if (field === "intent") return value === "assistant_internal" ? textOf(labelsText).anyProbe : probeLabel(value);
  if (field === "dialect") return formatLabel(value);
  return value;
}

/** 规则列表里的一个条件：`模型 claude-*`、`带缓存` */
export function conditionText(c: ConditionView): string {
  const flag = flagOf(c.field);
  if (flag) return c.values[0] === "false" ? flag.no : flag.yes;
  const values = c.values.map((v) => conditionValue(c.field, v)).join(textOf(labelsText).or);
  return `${nameOf(c.field) ?? c.field} ${values}`;
}

/** 试算明细里一条规则没命中的原因 */
export function mismatchText(m: MismatchView): string {
  const t = textOf(labelsText);
  const flag = flagOf(m.field);
  if (flag) {
    const want = m.want[0] === "false" ? flag.no : flag.yes;
    const got = m.got === "false" ? flag.no : flag.yes;
    return t.flagMismatch(want, got);
  }
  const name = nameOf(m.field) ?? m.field;
  const want = m.want.map((v) => conditionValue(m.field, v)).join(t.or);
  // 辅助请求为空说的是「这是用户自己发的请求」；max_tokens 为空是请求里没写
  const got =
    m.field === "intent" && m.got === ""
      ? t.userRequest
      : m.field === "max_tokens" && m.got === ""
        ? t.notSet
        : conditionValue(m.field, m.got);
  // 数量条件写的是比较式（`>200k`），前面不加「为」
  return COUNTS.has(m.field)
    ? t.countMismatch(name, want, got)
    : t.valueMismatch(name, want, got);
}

/** 规则命中后的一项参数改写 */
export function setText(s: SetView): string {
  const t = textOf(labelsText);
  switch (s.field) {
    case "model":
      return t.setModel(s.value);
    case "only_at_session_start":
      return t.onlyAtSessionStart;
    default:
      return t.setField(s.field, s.value);
  }
}

/** 尝试链里的一跳。`ok` 决定颜色 */
export function attemptText(a: AttemptView): { text: string; ok: boolean } {
  const t = textOf(labelsText);
  switch (a.outcome) {
    case "served":
      if (a.status == null || a.status < 400) {
        return { text: a.status == null ? t.served : t.servedStatus(a.status), ok: true };
      }
      return { text: t.rejected(a.status), ok: false };
    case "status":
      return { text: a.status === 429 ? t.rateLimited : t.upstreamError(a.status ?? "—"), ok: false };
    default:
      return { text: a.error ? coreText(a.error) : t.noResponse, ok: false };
  }
}

/** 做过的格式转换：`OpenAI Chat Completions → Anthropic Messages` */
export function translatedText(t: Pick<TranslatedView, "from" | "to">): string {
  return `${formatLabel(t.from)} → ${formatLabel(t.to)}`;
}

// ---------------------------------------------------------------- 请求与费用

/** 重放前的费用预估 */
export function quoteText(q: ReplayQuote): string {
  const t = textOf(labelsText).quote;
  if (q.billing === "free") return t.free;
  return q.cost_micros != null ? t.estimate(usd(q.cost_micros)) : t.unpriced(q.model);
}

// ---------------------------------------------------------------- 配置

export function originLabel(origin: ConfigOrigin): string {
  const t = textOf(labelsText).origins;
  switch (origin) {
    case "ui":
      return t.ui;
    case "cli":
      return t.cli;
    case "external":
      return t.external;
    case "rollback":
      return t.rollback;
    case "rotation":
      return t.rotation;
  }
}

/** 配置在哪一层没通过，后面接「错误」 */
export function stageLabel(stage: ConfigStage): string {
  const t = textOf(labelsText).stages;
  switch (stage) {
    case "syntax":
      return t.syntax;
    case "schema":
      return t.schema;
    case "semantics":
      return t.semantics;
  }
}

// ---------------------------------------------------------------- 安全

/** 出站检测和脱敏识别出的凭据种类 */
export function secretLabel(secret: string): string {
  const secrets: Record<string, string> = textOf(labelsText).secrets;
  return secrets[secret] ?? secret;
}

// ---------------------------------------------------------------- 客户端接管

export function takesEffectText(t: TakesEffect): string {
  const x = textOf(labelsText).takesEffect;
  return t === "immediately" ? x.immediately : x.onRestart;
}

/** 只查证过字段名的客户端要说出来。实测过的不用说，接管后在本机收到过请求的也不用说 */
export function fieldsOnlyText(): string {
  return textOf(labelsText).fieldsOnly;
}

/**
 * 按请求头认出来的应用叫什么。**这是旁证，不是身份** —— core 按
 * User-Agent 之类猜的，能被伪造，只用来显示；身份是请求带的那把密钥。
 *
 * 名字是产品名，中英文一样。认不出的原样显示。
 */
const APPS: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "opencode",
  aider: "Aider",
  zed: "Zed",
  continue: "Continue",
  "gemini-cli": "Gemini CLI",
};

export function appLabel(hint: string): string {
  return APPS[hint] ?? hint;
}
