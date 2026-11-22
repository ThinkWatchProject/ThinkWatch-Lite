import type { Matcher } from "@/types";
import CATALOG from "./guard.zh.json";
import { getLang } from "./index";

type RuleCopy = { name: string; why?: string; about?: string };
const catalog: Record<string, { rules: Record<string, RuleCopy>; kinds: Record<string, string> }> = CATALOG;

export const GUARD_TABLES = {
  scan_rule: Object.fromEntries(Object.entries(CATALOG.inspect_tools.rules).map(([id, copy]) => [id, copy.name])),
  rule_why: Object.fromEntries(Object.entries(CATALOG.inspect_tools.rules).map(([id, copy]) => [id, copy.why])),
  content_rule: Object.fromEntries(Object.entries(CATALOG.content.rules).map(([id, copy]) => [id, copy.name])),
};

export function guardRuleZh(guard: string, id: string): RuleCopy | undefined {
  const rules = Object.hasOwn(catalog, guard) ? catalog[guard]?.rules : undefined;
  return rules && Object.hasOwn(rules, id) ? rules[id] : undefined;
}

export function guardKindZh(guard: string, slug: string): string | undefined {
  const kinds = Object.hasOwn(catalog, guard) ? catalog[guard]?.kinds : undefined;
  return kinds && Object.hasOwn(kinds, slug) ? kinds[slug] : undefined;
}

/** 前缀、长度和字符类型取实际判据，更新规则时说明跟着变。 */
function guardAboutZh(m: Matcher): string | undefined {
  if (m.kind !== "prefix" && m.kind !== "prefixes") return undefined;
  const prefixes = m.kind === "prefix" ? [{ ...m, tail: "any" }] : m.prefixes;
  const groups = new Map<string, { prefixes: string[]; length: number; unit: string }>();
  for (const p of prefixes) {
    const key = `${p.min_tail}:${p.tail}`;
    const unit = p.tail === "hex" ? "十六进制字符" : p.tail === "alnum" ? "字母或数字" : "字符";
    const group = groups.get(key) ?? { prefixes: [], length: p.min_tail, unit };
    group.prefixes.push(`\`${p.prefix}\``);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ prefixes, length, unit }) =>
    `${prefixes.join("、")} 开头，其后至少 ${length} 个${unit}`,
  ).join("；") || undefined;
}

export function guardRuleText(guard: string, id: string, field: keyof RuleCopy, english?: string, matcher?: Matcher): string {
  if (getLang() !== "zh") return english ?? "";
  const translated = field === "about" && english && matcher ? guardAboutZh(matcher) : undefined;
  return translated ?? guardRuleZh(guard, id)?.[field] ?? english ?? "";
}
