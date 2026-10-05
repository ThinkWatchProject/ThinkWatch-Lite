// 临时类型：core 的模型别名合并后由 src/generated/tw-api.ts 生成的同名类型替换。
import type { Msg } from "@/generated/tw-api";

export type PinnedModel = { provider: string; model: string };
export type AliasInput = { name: string; models: Array<string> };
export type AliasSave = { alias: AliasInput; base_version?: string };
export type AliasModel = { model: string; providers: Array<string> };
export type AliasView = {
  name: string;
  models: Array<AliasModel>;
  served_by: Array<PinnedModel>;
  shadows: Array<string>;
  context_window?: number;
  requests_24h: number;
  cost_micros_24h?: number;
};
export type AliasSuggestion = { label: string; models: Array<PinnedModel> };
export type AliasesView = { aliases: Array<AliasView>; suggestions: Array<AliasSuggestion> };
export type AliasPreviewRequest = { alias: AliasInput; original?: string };
export type AliasPreview = {
  problems: Array<Msg>;
  served_by: Array<PinnedModel>;
  unserved: Array<string>;
  shadows: Array<string>;
  same_model: Array<PinnedModel>;
};
export type AliasRuleRef = { route: string; rule: string; field: string };
export type AliasUsage = { requests_24h: number; keys: Array<string>; rules: Array<AliasRuleRef> };
export type AliasWritten = { version: string; renamed_in: AliasUsage };
/** 规则的去向：上游或策略组的名称，或指定模型的列表 */
export type RuleTarget = string | Array<PinnedModel>;
/** KnownModel / ModelRow 新加的字段 */
export type KnownModelAliasFields = { alias?: Array<string>; aliases: Array<string> };
export type ModelRowAliasFields = { aliases: Array<string> };
