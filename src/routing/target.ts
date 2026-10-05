/**
 * 规则的去向有两种：上游或策略组的名称，或者指定模型的列表（上游 + 模型，按顺序备用）。
 * 读去向的地方都经过这里，不各自去猜 `to` 是哪一种。**纯函数**，路由图也用。
 */
import type { PinnedModel, RuleTarget } from "@/aliases/api.provisional";
import type { CandidateModel, DryRunResultX, KnownModelX } from "./provisional";
import { globMatch } from "@/upstreams/glob";

/** 指定模型的列表。去向是上游或策略组、或者没有去向时为空 */
export function pinnedOf(to: RuleTarget | null | undefined): PinnedModel[] | null {
  return Array.isArray(to) ? to : null;
}

/** 上游或策略组的名称。指定模型、没有去向时为空 */
export function targetNameOf(to: RuleTarget | null | undefined): string | null {
  return typeof to === "string" && to !== "" ? to : null;
}

/** 有去向：一个名称，或者至少一个指定模型 */
export function hasTarget(to: RuleTarget | null | undefined): boolean {
  const pinned = pinnedOf(to);
  return pinned ? pinned.length > 0 : targetNameOf(to) != null;
}

/** `bedrock · us.anthropic.claude-opus-5-v1:0` */
export function pinnedText(p: PinnedModel): string {
  return `${p.provider} · ${p.model}`;
}

// ---------------------------------------------------------------- 别名

/** 这个名称本身是别名（别名优先：和某个上游模型同名时也算别名） */
export function aliasNamed(name: string, known: readonly KnownModelX[]): KnownModelX | undefined {
  const n = name.trim();
  if (!n || n.includes("*")) return undefined;
  return known.find((m) => m.alias && globMatch(n, m.id));
}

/**
 * 条件里写上游模型名（可以带 `*`）时，**经继承**也匹配的别名：别名自己的名称不匹配，
 * 但它的模型列表里有匹配的。写别名时只管别名本身，这里为空。和 core 的规则条件、
 * 密钥范围是同一条规矩（真名 → 别名，单向）。
 */
export function inheritedAliases(patterns: readonly string[], known: readonly KnownModelX[]): string[] {
  const ps = patterns.map((p) => p.trim()).filter(Boolean);
  if (ps.length === 0) return [];
  const hit = (s: string) => ps.some((p) => globMatch(p, s));
  const out: string[] = [];
  const add = (name: string) => {
    if (!out.includes(name) && !hit(name)) out.push(name);
  };
  for (const m of known) {
    if (m.alias) {
      if (m.alias.some(hit)) add(m.id);
    } else if (hit(m.id)) {
      // 清单里没有的模型名也可能被别名列着：两边都看，取并集
      for (const a of m.aliases ?? []) add(a);
    }
  }
  return out;
}

/** 规则条件里模型这一项的提示 */
export type ModelHint =
  /** 写的就是别名：只匹配用这个别名的请求 */
  | { kind: "alias"; alias: string }
  /**
   * 写的是上游模型名或通配：匹配到几个已知模型，以及经继承也匹配的别名。
   * `exact` 是没有通配的一个名称（「指向它的别名」）
   */
  | { kind: "models"; matches: number; inherited: string[]; exact: boolean };

/** 已知模型为空（还没取到）时不给提示 */
export function modelHint(pattern: string, known: readonly KnownModelX[]): ModelHint | null {
  const p = pattern.trim();
  if (!p || known.length === 0) return null;
  const alias = aliasNamed(p, known);
  if (alias) return { kind: "alias", alias: alias.id };
  return {
    kind: "models",
    matches: known.filter((m) => globMatch(p, m.id)).length,
    inherited: inheritedAliases([p], known),
    exact: !p.includes("*"),
  };
}

// ---------------------------------------------------------------- 试算

export interface CandidateView extends CandidateModel {
  provider: string;
}

/**
 * 试算的候选，带上每一个发出的模型。两种写法都认：和 `candidates` 一一对应的
 * `candidate_models`，或者候选本身就是 `{ provider, sent_model, model_via }`（见 `provisional.ts`）
 */
export function candidatesOf(r: DryRunResultX): CandidateView[] {
  return (r.candidates as Array<string | CandidateView>).map((c, i) =>
    typeof c === "string" ? { provider: c, ...(r.candidate_models?.[i] ?? {}) } : c,
  );
}
