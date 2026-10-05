/**
 * 「别名」标签上几处要算的东西：哪几条建议还该说、标签名旁的小圆点、每一行下面的
 * 提醒、从建议预填的新建内容、删除时列出的客户端。都是纯函数，组件只管画。
 */
import type { HintId } from "@/guide/hints";
import type { DetectedClient } from "@/types";
import type { AliasInput, AliasSuggestion, AliasView } from "@/types";

/**
 * 一条建议的标识，「忽略」按它记（`@/guide/hints`，和引导提示的「不再显示」同一处，
 * 设置里「重新显示」一起恢复）。
 *
 * **由名称和其中的模型名组成，不含上游**：又接了一个上游、提供的还是这几个名称，
 * 建议不重新出现；多出一个新的名称（又一种写法）才算一条新建议。
 */
export function suggestionKey(s: AliasSuggestion): HintId {
  const models = [...new Set(s.models.map((m) => m.model))].sort();
  return `alias-suggestion:${s.label}|${models.join(",")}`;
}

/** 还该说的建议：没点过「忽略」的，按 core 给的顺序 */
export function visibleSuggestions(
  all: readonly AliasSuggestion[],
  dismissed: readonly string[],
): AliasSuggestion[] {
  return all.filter((s) => !dismissed.includes(suggestionKey(s)));
}

/**
 * 标签名旁的小圆点：有没点过「忽略」的建议，而且此刻看的不是「别名」标签。
 * 数据没取到时不画 —— 不在数据到之前先闪一下。
 */
export function showTabDot(
  suggestions: readonly AliasSuggestion[] | undefined,
  dismissed: readonly string[],
  active: boolean,
): boolean {
  return !active && suggestions !== undefined && visibleSuggestions(suggestions, dismissed).length > 0;
}

/** 一条建议里出现了哪几个上游，按出现的顺序、不重复 */
export function suggestionProviders(s: AliasSuggestion): string[] {
  return [...new Set(s.models.map((m) => m.provider))];
}

/**
 * 「建为别名…」打开新建对话框时的预填：上游模型是建议里的几个名称（按 core 给的顺序、
 * 不重复），名称取其中不带前缀和后缀的那一个 —— 通常就是官方上游的写法
 * （`claude-opus-5`），和它同名的请求照常能用。没有这样的名称时取第一个去掉前缀、
 * 后缀之后的样子。对话框里可以改。
 */
export function suggestionInput(s: AliasSuggestion): Partial<AliasInput> {
  const models = [...new Set(s.models.map((m) => m.model))];
  const bare = models.find((m) => bareName(m) === m);
  return { name: bare ?? (models[0] ? bareName(models[0]) : ""), models };
}

/** 去掉路径前缀（`anthropic/`）、Bedrock 的地域与厂商前缀和版本后缀，Vertex 的 `@日期` 换成 `-日期` */
function bareName(model: string): string {
  let m = model.replace(/^.*\//, "");
  if (BEDROCK.test(m)) m = m.replace(BEDROCK, "").replace(/-v\d+(?::\d+)?$/, "");
  return m.replace("@", "-");
}

const BEDROCK = /^(?:(?:us|eu|apac|jp|au|us-gov|global)\.)?anthropic\./;

/** 「上游模型」一格里的一行：哪个上游、发给它的名称。`provider` 为 null = 没有上游提供这个名称 */
export interface ModelLine {
  provider: string | null;
  model: string;
}

/**
 * 「上游模型」一格：每个能服务它的上游一行，写实际发给它的名称（core 按列表顺序取
 * 它有的第一个）；列表里没有任何上游提供的名称各一行，上游写「—」。
 */
export function modelLines(a: AliasView): ModelLine[] {
  return [
    ...a.served_by.map((p) => ({ provider: p.provider, model: p.model })),
    ...a.models.filter((m) => m.providers.length === 0).map((m) => ({ provider: null, model: m.model })),
  ];
}

/** 一行下面的提醒 */
export type AliasWarning =
  /** 没有上游提供列表里的任何一个名称：用这个别名的请求会失败。`models` 是列表里有几个名称 */
  | { kind: "unserved"; models: number }
  /** 这几个上游有和别名同名的模型，但没列进来：这个名称的请求不会发给它们 */
  | { kind: "shadowed"; providers: string[] };

/** 一行下面要说的提醒，要紧的在前 */
export function aliasWarnings(a: AliasView): AliasWarning[] {
  const out: AliasWarning[] = [];
  if (a.served_by.length === 0) out.push({ kind: "unserved", models: a.models.length });
  if (a.shadows.length > 0) out.push({ kind: "shadowed", providers: a.shadows });
  return out;
}

/**
 * 模型列表里写着这个名称的、这一份接管着的客户端（opencode、Pi 这类把模型写进配置的）。
 * 删掉别名之后，它们的模型列表里留着一个没有上游提供的名称。
 */
export function clientsListing(clients: readonly DetectedClient[] | undefined, name: string): DetectedClient[] {
  return (clients ?? []).filter(
    (c) => c.adopted_at_ms != null && !c.other_instance && (c.models ?? []).includes(name),
  );
}
