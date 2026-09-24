import { Badge } from "@/ui/badge";
import { textOf, useText } from "@/i18n";
import { hiddenWhy, ruleWhy as coreRuleWhy } from "@/i18n/core.i18n";
import { secretLabel } from "@/labels";
import type { Guard, Matcher, SecurityEventView, SecurityRuleView } from "@/types";
import { securityLabelsText } from "./labels.i18n";

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
    <code className="rounded bg-muted px-1 font-mono text-[0.92em] whitespace-pre text-foreground">
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
 * 一次命中最后怎么处置的。
 *
 * **三种颜色说三件事**：切断、拒绝是红的（请求的结局变了），替换是绿的（防护在
 * 起作用，请求照常完成），仅记录不上色（什么都没改）。
 */
export function ActionBadge({ action }: { action: SecurityEventView["action"] }) {
  const t = useText(securityLabelsText).actions;
  const variant =
    action === "cut" || action === "blocked" ? "destructive" : action === "replaced" ? "success" : "outline";
  return <Badge variant={variant}>{t[action] ?? action}</Badge>;
}
