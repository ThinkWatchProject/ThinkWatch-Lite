import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { getLang, textOf, useText } from "@/i18n";
import { hiddenWhy, ruleWhy as coreRuleWhy } from "@/i18n/core.i18n";
import { secretLabel } from "@/labels";
import type { Guard, GuardMode, Matcher, SecurityEventView, SecurityOutcome, SecurityRuleView } from "@/types";
import { securityLabelsText } from "./labels.i18n";

/**
 * 一项防护的档位，画成状态点的语气。
 *
 * **拦截是绿的**（防护在起作用），**观察是琥珀的**（命中照常放行，只记下来 ——
 * 要留意，但它在工作），**关闭是灰的**（没有在工作，也不是故障）。页头、标签、
 * 档位那一块用同一套，一眼对得上。
 */
export function modeTone(mode: GuardMode): StatusTone {
  return mode === "enforce" ? "ok" : mode === "observe" ? "warn" : "idle";
}

/**
 * 一次命中最后怎么处置的，画成状态点的语气。
 *
 * **三种颜色说三件事**：切断、拒绝是红的（请求的结局变了），替换是绿的（防护在
 * 起作用，请求照常完成），仅记录是琥珀的（命中的东西照常放行了，值得看一眼）。
 */
export function outcomeTone(action: SecurityOutcome): StatusTone {
  return action === "cut" || action === "blocked" ? "error" : action === "replaced" ? "ok" : "warn";
}

/**
 * 几种处置一起列时的先后（页头）：先说改变了请求结局的切断、拒绝，再说替换、
 * 仅记录。和规则「拦截时」的选项同一个先后。
 */
export const OUTCOMES: readonly SecurityOutcome[] = ["cut", "blocked", "replaced", "recorded"];

/**
 * 一条规则叫什么。
 *
 * 出站脱敏的内置规则 id 就是凭据种类（`anthropic-api-key` …），和流量页上
 * 那张名称表是同一张；其余几项各查这里的一张表：工具调用审查查扫描规则那张，
 * 内容过滤查内容规则那张，隐藏字符的「规则」是那一种字符，输出长度只有一条。
 * **自定义规则的 id 就是用户起的名字**，原样显示。表里都没有的，退回 core
 * 给的英文名，再没有就是 id。
 */
export function ruleName(guard: string, id: string, custom?: boolean, fallback?: string): string {
  if (custom) return id;
  const t = textOf(securityLabelsText);
  switch (guard) {
    case "redact": {
      const name = secretLabel(id);
      return name !== id ? name : (fallback ?? id);
    }
    case "content":
      return t.contentRules[id] ?? fallback ?? id;
    case "hidden_text":
      return t.hiddenKinds[id] ?? fallback ?? id;
    case "output_limit":
      return t.outputLimit;
    default:
      return t.rules[id] ?? fallback ?? id;
  }
}

/** 规则列表里的一条叫什么 */
export function viewName(guard: Guard, r: SecurityRuleView): string {
  return ruleName(guard, r.id, r.custom, r.name);
}

/** 内置规则为什么值得看一眼。中文查词表，查不到就用 core 的原话 */
export function ruleWhy(r: SecurityRuleView): string {
  if (r.custom || !r.why) return "";
  if (r.kind !== "invisible") return coreRuleWhy(r.id, r.why);
  // 那句话以名字开头（「双向控制符：……」），名字已经在上一行了
  const why = hiddenWhy(r.id, r.why);
  const rest = /^[^：:]+[：:]\s*(.+)$/s.exec(why)?.[1];
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : why;
}

/** 命中在哪儿：工具调用审查是哪个工具，另两项请求防护是「工具结果」 */
export function whereOf(e: SecurityEventView): string | null {
  if (!e.tool) return null;
  return e.tool === "tool_result" ? textOf(securityLabelsText).toolResult : e.tool;
}

/**
 * 一次命中的细节，日志和请求详情里的第二行。
 *
 * **各项防护的 `excerpt` 和 `count` 说的不是一回事**：出站脱敏是打码的值和出现
 * 几次；隐藏字符是第一个的码位（标签字符后面跟着解出来的原文）和几个字符；
 * 输出长度是上限和超出时数到了多少。
 */
export function EventDetail({ e }: { e: SecurityEventView }) {
  const t = useText(securityLabelsText).detail;
  switch (e.guard) {
    case "hidden_text": {
      const at = e.excerpt.indexOf(" ");
      const code = at < 0 ? e.excerpt : e.excerpt.slice(0, at);
      const revealed = at < 0 ? "" : e.excerpt.slice(at + 1);
      return (
        <>
          <span className="font-mono">{code}</span>
          {revealed && ` · ${t.revealed(revealed)}`}
          {` · ${t.chars(e.count)}`}
        </>
      );
    }
    case "output_limit":
      return <>{t.limit(Number(e.excerpt), e.count)}</>;
    default:
      return (
        <>
          <span className="font-mono">{e.excerpt}</span>
          {e.count > 1 && ` · ${t.times(e.count)}`}
        </>
      );
  }
}

/** 按代码样式画的一小段 */
export function Code({ children }: { children: string }) {
  return (
    // `pre`：内容规则的首尾空格有意义（` dan `），不能被折叠掉
    <code className="rounded bg-surface px-1 font-mono text-[0.92em] whitespace-pre text-foreground">
      {children}
    </code>
  );
}

const code = (s: string) => <Code key={s}>{s}</Code>;

/** 内置规则的匹配判据，写成一句话 */
export function MatcherText({ m }: { m: Matcher }) {
  const t = useText(securityLabelsText).matcher;
  switch (m.kind) {
    case "prefix":
      return t.prefix(code, m.prefix, m.min_tail);
    case "openai-legacy":
      return t.openaiLegacy(code, m.min_len);
    case "pem":
      return t.pem(code);
    case "jwt":
      return t.jwt(code);
    case "conn-string":
      return t.connString(code);
    case "private-ip":
      return t.privateIp(code);
    case "domain-suffix":
      return t.domainSuffix(code, m.suffixes);
    case "regex":
      return t.regex(code, m.pattern);
    case "contains":
      return t.contains(code, m.text);
    case "codepoints":
      return t.codepoints(code, m.ranges);
  }
}

/**
 * 一次命中最后怎么处置的：状态点加一个词，颜色见 `outcomeTone`。
 *
 * **只有切断、拒绝的字是红的** —— 一列里大多数是替换和仅记录，满列彩字等于
 * 没有重点；那两种改变了请求的结局，要一眼挑得出来。
 */
export function ActionBadge({ action }: { action: SecurityOutcome }) {
  const t = useText(securityLabelsText).actions;
  const tone = outcomeTone(action);
  return (
    <StatusLabel tone={tone} muted={tone !== "error"}>
      {t[action] ?? action}
    </StatusLabel>
  );
}

/** 本地时区里的哪一天，当分组的键 */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 一天的标题：今天、昨天写词，日期跟在后面；更早的只写日期（带星期，跨年带年份）。
 * 日期按界面语言写（`9月23日周三` / `Wed, Sep 23`）。
 */
export function dayHead(ms: number, now = Date.now()): { title: string; date: string | null } {
  const t = textOf(securityLabelsText).day;
  const d = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const date = new Intl.DateTimeFormat(getLang() === "zh" ? "zh-CN" : "en-US", {
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    month: getLang() === "zh" ? "long" : "short",
    day: "numeric",
    weekday: "short",
  }).format(d);
  if (dayKey(ms) === dayKey(now)) return { title: t.today, date };
  if (dayKey(ms) === dayKey(yesterday.getTime())) return { title: t.yesterday, date };
  return { title: date, date: null };
}

/** 一天之内的时刻，到秒。日期在那一天的标题上 */
export function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
