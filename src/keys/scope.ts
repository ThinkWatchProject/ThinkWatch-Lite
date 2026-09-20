/**
 * 一把密钥的「可见模型」。
 *
 * core 那边是一个字段：`allow`，三态 —— 不写（全部）、写 `[]`（无）、
 * 写非空（按 glob 逐条匹配）。写非空时**不区分规则和模型 ID**：`claude-*`
 * 和 `claude-opus-5` 都是 glob，后者只是没有 `*` 的那种。
 *
 * 界面要把这一个列表讲成两件事 —— 「覆盖一组的规则」和「单独选中的模型」
 * —— 因为聚合目录可能有几百个模型：逐个勾不现实，而勾一下就把规则展开成
 * 明细会往配置里写几百行。两者并存，互不摧毁。
 */
import { globMatch } from "@/upstreams/glob";
import type { KnownModel } from "@/types";

export type Scope = "all" | "some" | "none";

export function scopeOf(allow: string[] | null | undefined): Scope {
  if (allow == null) return "all";
  return allow.length === 0 ? "none" : "some";
}

/** 三态加条目，写回 core 认的那个字段 */
export function allowOf(scope: Scope, entries: string[]): string[] | null {
  if (scope === "all") return null;
  if (scope === "none") return [];
  return entries;
}

/** 带 `*` 的是规则，其余是一个具体的模型 ID */
export function isPattern(entry: string): boolean {
  return entry.includes("*");
}

export function splitEntries(entries: string[]): { patterns: string[]; picked: string[] } {
  return {
    patterns: entries.filter(isPattern),
    picked: entries.filter((e) => !isPattern(e)),
  };
}

/** 这个模型为什么可见：被某条规则命中，还是单独选中的 */
export type Source = { kind: "pattern"; pattern: string } | { kind: "picked" } | null;

export function sourceOf(entries: string[], model: string): Source {
  // **规则优先。**同时成立时说「由规则命中」才有用：那一行取消不掉，
  // 而原因是规则，不是那条重复的明细
  const hit = entries.find((e) => isPattern(e) && globMatch(e, model));
  if (hit != null) return { kind: "pattern", pattern: hit };
  return entries.some((e) => !isPattern(e) && e === model) ? { kind: "picked" } : null;
}

/** 表格里要画哪些行：目录里的，加上选中了但目录里没有的 */
export interface ScopeRow {
  id: string;
  /** 提供它的上游。目录里没有这个模型时为空 */
  providers: string[];
  /** 目录里没有它 —— 上游改了名，或者当初手打错了。**照样列出来**，否则删不掉 */
  unknown: boolean;
  source: Source;
}

export function rowsOf(entries: string[], catalog: KnownModel[]): ScopeRow[] {
  const known = new Set(catalog.map((m) => m.id));
  const stale = splitEntries(entries)
    .picked.filter((m) => !known.has(m))
    .map<ScopeRow>((id) => ({ id, providers: [], unknown: true, source: { kind: "picked" } }));
  const rest = catalog.map<ScopeRow>((m) => ({
    id: m.id,
    providers: m.providers,
    unknown: false,
    source: sourceOf(entries, m.id),
  }));
  return [...stale, ...rest];
}

/** 目录里有几个模型对这把密钥可见 */
export function visibleCount(entries: string[], catalog: KnownModel[]): number {
  return catalog.filter((m) => sourceOf(entries, m.id) != null).length;
}

/** 一条规则命中几个。目录还没有就答不上来 */
export function patternHits(pattern: string, catalog: KnownModel[]): number {
  return catalog.filter((m) => globMatch(pattern, m.id)).length;
}

/**
 * 勾上或取消一个模型。
 *
 * **只动明细，不动规则。**规则命中的那些在界面上就点不动，所以这里只会
 * 收到明细的勾选；真收到了也照样只加减明细，规则留在原处。
 */
export function toggleModel(entries: string[], model: string, on: boolean): string[] {
  if (on) return entries.includes(model) ? entries : [...entries, model];
  return entries.filter((e) => e !== model);
}

export function addPattern(entries: string[], pattern: string): string[] {
  const p = pattern.trim();
  if (!p || entries.includes(p)) return entries;
  return [...entries, p];
}

export function removeEntry(entries: string[], entry: string): string[] {
  return entries.filter((e) => e !== entry);
}
