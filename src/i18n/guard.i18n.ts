import type { Matcher } from "@/types";
import CATALOG from "./guard.zh.json";
import HANT_CATALOG from "./guard.zh-Hant.json";
import { getLang, type Lang } from "./index";

type RuleCopy = { name: string; why?: string; about?: string };
type GuardCatalog = Record<string, { rules: Record<string, RuleCopy>; kinds: Record<string, string> }>;

export function guardTables(lang: "zh" | "zh-Hant") {
  const catalog = lang === "zh" ? CATALOG : HANT_CATALOG;
  return {
    scan_rule: Object.fromEntries(Object.entries(catalog.inspect_tools.rules).map(([id, copy]) => [id, copy.name])),
    rule_why: Object.fromEntries(Object.entries(catalog.inspect_tools.rules).map(([id, copy]) => [id, copy.why])),
    content_rule: Object.fromEntries(Object.entries(catalog.content.rules).map(([id, copy]) => [id, copy.name])),
  };
}

function guardCopy(guard: string, lang: Lang) {
  const catalog: GuardCatalog | undefined = lang === "zh" ? CATALOG : lang === "zh-Hant" ? HANT_CATALOG : undefined;
  return catalog && Object.hasOwn(catalog, guard) ? catalog[guard] : undefined;
}

export function guardKind(guard: string, slug: string): string | undefined {
  const kinds = guardCopy(guard, getLang())?.kinds;
  return kinds && Object.hasOwn(kinds, slug) ? kinds[slug] : undefined;
}

/** 前缀、长度和字符类型取实际判据，更新规则时说明跟着变。 */
function guardAboutZh(m: Matcher, traditional: boolean): string | undefined {
  if (m.kind !== "prefix" && m.kind !== "prefixes") return undefined;
  const prefixes = m.kind === "prefix" ? [{ ...m, tail: "any" }] : m.prefixes;
  const groups = new Map<string, { prefixes: string[]; length: number; unit: string }>();
  for (const p of prefixes) {
    const key = `${p.min_tail}:${p.tail}`;
    const unit = traditional
      ? p.tail === "hex" ? "十六進位字元" : p.tail === "alnum" ? "英數字元" : "字元"
      : p.tail === "hex" ? "十六进制字符" : p.tail === "alnum" ? "字母或数字" : "字符";
    const group = groups.get(key) ?? { prefixes: [], length: p.min_tail, unit };
    group.prefixes.push(`\`${p.prefix}\``);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ prefixes, length, unit }) =>
    traditional ? `以 ${prefixes.join("、")} 開頭，後面至少有 ${length} 個${unit}`
      : `${prefixes.join("、")} 开头，其后至少 ${length} 个${unit}`,
  ).join("；") || undefined;
}

export function guardRuleText(guard: string, id: string, field: keyof RuleCopy, english?: string, matcher?: Matcher): string {
  const lang = getLang();
  const rules = guardCopy(guard, lang)?.rules;
  const name = rules && Object.hasOwn(rules, id) ? rules[id]?.[field] : undefined;
  const translated = (lang === "zh" || lang === "zh-Hant") && field === "about" && english && matcher
    ? guardAboutZh(matcher, lang === "zh-Hant") : undefined;
  return translated ?? name ?? english ?? "";
}
