/**
 * 临时类型：模型别名（ThinkWatch-Core#283）在 core 合并、`src/generated/tw-api.ts` 重新生成之后，
 * 这几样换成生成的同名类型，整个文件删掉。
 *
 * - 规则的 `to` 可以是指定模型的列表（`RuleTarget`），`RuleView`、`RuleInput` 和装着它们的几样跟着变
 * - `/models` 的每一项带上别名字段
 * - 试算的每个候选带上发出的模型名和它的来历（`sent_model`、`model_via`）
 *
 * 现在生成的 `RuleView.to` 是 `string`，可以赋给这里的 `RuleTarget`：路由页的代码按这里写，
 * 生成的类型换上之后不用再改。
 */
import type {
  DryRunRequest,
  DryRunResult,
  KnownModel,
  RouteInput,
  RouteSave,
  RouteView,
  RuleInput,
  RuleView,
} from "@/types";
import type { KnownModelAliasFields, RuleTarget } from "@/aliases/api.provisional";

export type RuleViewX = Omit<RuleView, "to"> & { to?: RuleTarget | null };
export type RuleInputX = Omit<RuleInput, "to"> & { to?: RuleTarget | null };
export type RouteViewX = Omit<RouteView, "rules"> & { rules: Array<RuleViewX> };
export type RouteInputX = Omit<RouteInput, "rules"> & { rules: Array<RuleInputX> };
export type RouteSaveX = Omit<RouteSave, "route"> & { route: RouteInputX };
export type DryRunRequestX = Omit<DryRunRequest, "draft"> & { draft?: RouteInputX | null };

/** `/models` 的一项。`alias` 有值时这一项本身是别名，值是它的模型列表；`aliases` 是指向这个真名的别名 */
export type KnownModelX = KnownModel & Partial<KnownModelAliasFields>;

/** 发出的模型名从哪儿来：别名表、规则改写（`set.model`）、指定模型 */
export type ModelVia = "alias" | "rule" | "pinned";

/** 试算里一个候选发出的模型。和客户端写的名称相同时 core 不给 `sent_model` */
export type CandidateModel = { sent_model?: string | null; model_via?: string | null };

/**
 * 试算结果。约定里写的是「每个候选加 `sent_model`、`model_via`」，而现在的 `candidates` 是
 * 上游名的列表：这里按**和 `candidates` 一一对应的 `candidate_models`** 读；core 若改成
 * 候选本身带这两个字段，`candidatesOf`（`target.ts`）两种都认。集成时按生成的类型定下一种。
 */
export type DryRunResultX = DryRunResult & { candidate_models?: Array<CandidateModel | null> | null };
