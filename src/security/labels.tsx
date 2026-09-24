import { Badge } from "@/ui/badge";
import { textOf, useText } from "@/i18n";
import { ruleWhy as coreRuleWhy } from "@/i18n/core.i18n";
import { secretLabel } from "@/labels";
import type { Guard, Matcher, SecurityEventView, SecurityRuleView } from "@/types";
import { securityLabelsText } from "./labels.i18n";

/**
 * 一条规则叫什么。
 *
 * 出站脱敏的内置规则 id 就是凭据种类（`anthropic-api-key` …），和流量页上
 * 那张名称表是同一张；工具调用审查的查这里的表。**自定义规则的 id 就是用户
 * 起的名字**，原样显示。两张表里都没有的，退回 core 给的英文名，再没有就是
 * id。
 */
export function ruleName(guard: string, id: string, custom?: boolean, fallback?: string): string {
  if (custom) return id;
  if (guard === "redact") {
    const name = secretLabel(id);
    return name !== id ? name : (fallback ?? id);
  }
  return textOf(securityLabelsText).rules[id] ?? fallback ?? id;
}

/** 规则列表里的一条叫什么 */
export function viewName(guard: Guard, r: SecurityRuleView): string {
  return ruleName(guard, r.id, r.custom, r.name);
}

/** 工具调用规则为什么值得看一眼。中文查词表，查不到就用 core 的原话 */
export function ruleWhy(r: SecurityRuleView): string {
  if (r.custom || !r.why) return "";
  return coreRuleWhy(r.id, r.why);
}

/** 按代码样式画的一小段 */
export function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1 font-mono text-[0.92em] whitespace-nowrap text-foreground">
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
  }
}

/**
 * 一次命中最后怎么处置的。
 *
 * **三种颜色说三件事**：切断是红的（请求的结局变了），替换是绿的（防护在
 * 起作用，请求照常完成），仅记录不上色（什么都没改）。
 */
export function ActionBadge({ action }: { action: SecurityEventView["action"] }) {
  const t = useText(securityLabelsText).actions;
  const variant = action === "cut" ? "destructive" : action === "replaced" ? "success" : "outline";
  return <Badge variant={variant}>{t[action] ?? action}</Badge>;
}
