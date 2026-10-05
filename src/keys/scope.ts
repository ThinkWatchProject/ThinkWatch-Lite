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
 *
 * **别名只从真名继承，不反过来。**目录里也列着别名（`alias` 是它的模型列表）。
 * `allow` 里有一条放行了别名列表里的某个模型名，这个别名也可见（core 的
 * `resolve_allowed` 同样这么算）；只放行别名，它的模型不跟着可见。继承是算出来的，
 * **不写进 `allow`**：配置里只有用户自己写的那几条。
 */
import { asciiLower, globMatch } from "@/upstreams/glob";
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

/**
 * 单独选中的一条和一个模型 ID 是不是同一个。**和 core 一样不分大小写**：core 的
 * `glob_match` 两边都按 ASCII 转小写再比，没有 `*` 的条目也是（`Claude-Opus-5` 放行
 * `claude-opus-5`）。以前这里逐字比，目录里那一行显示成没选中，另外多出一行目录里没有
 * 的，勾一下还会再写进去一条。只转 ASCII 字母，和 Rust 的 `to_ascii_lowercase` 一致
 */
export function sameModel(a: string, b: string): boolean {
  return a.length === b.length && asciiLower(a) === asciiLower(b);
}

/**
 * 这个模型为什么可见：被某条规则命中、随它列表里的某个模型放行（只有别名会这样），
 * 还是单独选中的
 */
export type Source =
  | { kind: "pattern"; pattern: string }
  | { kind: "inherited"; model: string }
  | { kind: "picked" }
  | null;

/**
 * 别名随哪个模型放行：列表里第一个被某条条目放行的模型名。没有就是 null。
 *
 * **跳过和别名同名的那个模型。**别名常把自己的名字也列进去（`claude-sonnet-5` 指向
 * 官方的 `claude-sonnet-5` 和 Bedrock 的长名称）：放行这个名字就是直接放行别名，算
 * 「单独选中」或「由规则命中」，能取消；说成「随 claude-sonnet-5 放行」就锁死了
 */
export function inheritedFrom(entries: string[], name: string, models: readonly string[]): string | null {
  return models.find((m) => !sameModel(m, name) && entries.some((e) => globMatch(e, m))) ?? null;
}

/**
 * `alias` 给了就是别名，按它的模型列表算继承。
 *
 * **规则优先，其次继承，最后才是明细。**同时成立时说锁住这一行的那个原因才有用：
 * 规则命中、随别的模型放行的行都取消不掉，原因不是那条重复的明细
 */
export function sourceOf(entries: string[], model: string, alias?: readonly string[] | null): Source {
  const hit = entries.find((e) => isPattern(e) && globMatch(e, model));
  if (hit != null) return { kind: "pattern", pattern: hit };
  const via = alias ? inheritedFrom(entries, model, alias) : null;
  if (via != null) return { kind: "inherited", model: via };
  return entries.some((e) => !isPattern(e) && sameModel(e, model)) ? { kind: "picked" } : null;
}

/** 这一行能不能点：规则命中的和随别的模型放行的都点不动 */
export function locked(source: Source): boolean {
  return source?.kind === "pattern" || source?.kind === "inherited";
}

/** 表格里要画哪些行：目录里的，加上选中了但目录里没有的 */
export interface ScopeRow {
  id: string;
  /** 提供它的上游。目录里没有这个模型时为空 */
  providers: string[];
  /** 目录里没有它 —— 上游改了名，或者当初手打错了。**照样列出来**，否则删不掉 */
  unknown: boolean;
  /** 是别名时它的模型列表，否则 null */
  alias: string[] | null;
  source: Source;
}

export function rowsOf(entries: string[], catalog: KnownModel[]): ScopeRow[] {
  const stale = splitEntries(entries)
    .picked.filter((e) => !catalog.some((m) => sameModel(e, m.id)))
    .map<ScopeRow>((id) => ({ id, providers: [], unknown: true, alias: null, source: { kind: "picked" } }));
  const rest = catalog.map<ScopeRow>((m) => ({
    id: m.id,
    providers: m.providers,
    unknown: false,
    alias: m.alias ?? null,
    source: sourceOf(entries, m.id, m.alias),
  }));
  return [...stale, ...rest];
}

/** 目录里有几个模型对这把密钥可见。别名算在里面，随它的模型放行的也算 */
export function visibleCount(entries: string[], catalog: KnownModel[]): number {
  return catalog.filter((m) => sourceOf(entries, m.id, m.alias) != null).length;
}

/**
 * 一条规则命中几个。目录还没有就答不上来。
 *
 * **只按名称数**，别名也按它自己的名称：`claude-sonnet-*` 命中别名 `claude-sonnet-5`，
 * 不命中只是列表里有个 `claude-sonnet-5` 的别名 `sonnet`（那一个算「随 … 放行」）
 */
export function patternHits(pattern: string, catalog: KnownModel[]): number {
  return catalog.filter((m) => globMatch(pattern, m.id)).length;
}

/** 目录里有没有别名。没有就不必说明别名怎么算 */
export function hasAliases(catalog: KnownModel[]): boolean {
  return catalog.some((m) => m.alias != null);
}

/**
 * 勾上或取消一个模型。
 *
 * **只动明细，不动规则。**规则命中的那些在界面上就点不动，所以这里只会
 * 收到明细的勾选；真收到了也照样只加减明细，规则留在原处。
 */
export function toggleModel(entries: string[], model: string, on: boolean): string[] {
  // 大小写不同的也算已经选中（见 sameModel）：勾上不再写一条，取消时一起拿掉
  const picks = (e: string) => !isPattern(e) && sameModel(e, model);
  if (on) return entries.some(picks) ? entries : [...entries, model];
  return entries.filter((e) => !picks(e));
}

export function addPattern(entries: string[], pattern: string): string[] {
  const p = pattern.trim();
  if (!p || entries.includes(p)) return entries;
  return [...entries, p];
}

export function removeEntry(entries: string[], entry: string): string[] {
  return entries.filter((e) => e !== entry);
}
