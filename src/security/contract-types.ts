/**
 * **临时文件：安全页重整（控制面协议 48）落地之前的类型和几处未定的形状。**
 *
 * core 那一侧（`feat/security-restructure`）合入、钉点换成带这些字段的版本后：
 *
 * 1. 删掉这个文件；`src/security/` 里 `from "./contract-types"` 一律改回 `from "@/types"`
 *    （下面每个类型在生成的 `tw-api.ts` 里同名）。
 * 2. 下面「未定的形状」那几个函数按 core 的最终写法改成直接读字段或直接 `call(...)`，调用方
 *    不用动：批量启停的端点名进 `src/control.ts` 的 `WEBVIEW_ENDPOINTS` 和
 *    `src-tauri/src/call.rs` 的白名单，`setRulesEnabled` 改用 `call`。
 *
 * 这里只写协议 48 新增的那几样，其余原样转出生成的类型。
 */
import { invoke } from "@tauri-apps/api/core";
import type * as G from "@/types";

export type * from "@/types";

// ------------------------------------------------------------------ 新增的字段与取值

/** 规则在「开启」档下做什么。新增 `placeholder`（密钥与隐私）和 `replace`（内容过滤） */
export type RuleAction = G.RuleAction | "placeholder" | "replace";

/** 内容规则查哪一边：请求（用户消息与工具结果）、回答（模型输出的正文） */
export type RuleScope = "request" | "response";

/** 一条规则：内容规则多了 `scope`、`replacement`；密钥与隐私的规则也有 `action` / `default_action` */
export type SecurityRuleView = Omit<G.SecurityRuleView, "action" | "default_action"> & {
  action?: RuleAction | null;
  default_action?: RuleAction | null;
  /** 内容过滤：查哪一边。内置规则固定是 `["request"]` */
  scope?: RuleScope[];
  /** 内容过滤：动作为「替换」时换成的文字。缺省是 `***` */
  replacement?: string | null;
};

export type GuardDetail = Omit<G.GuardDetail, "rules"> & { rules: SecurityRuleView[] };

export type SecurityDetail = { redact: GuardDetail; inspect_tools: GuardDetail; content: GuardDetail };

/** 保存一条自定义规则：`action` 对密钥与隐私也收；内容规则多了 `scope`、`replacement`、`case_sensitive` */
export type CustomRuleSave = Omit<G.CustomRuleSave, "action"> & {
  action?: RuleAction | null;
  scope?: RuleScope[] | null;
  replacement?: string | null;
};

/**
 * 试一段文本：内容过滤多了 `scope`（这段当作请求还是回答来试）。`replacement` 是对话框里
 * 填着、还没保存的替换文字 —— **约定里没写**，见 `api.test` 的说明
 */
export type SecurityTestRequest = Omit<G.SecurityTestRequest, "action"> & {
  action?: RuleAction | null;
  scope?: RuleScope | null;
  replacement?: string | null;
};

export type SecurityTestHit = Omit<G.SecurityTestHit, "action"> & { action?: RuleAction | null };

export type SecurityTestResult = Omit<G.SecurityTestResult, "hits"> & { hits: SecurityTestHit[] };

/**
 * 具体做了什么。`replaced` 以前只有占位符（密钥与隐私）；内容过滤的「替换」带几处和换成的
 * 文字（字段名约定里没定，读它走 `replacedOf`）
 */
export type OutcomeDetail =
  | Exclude<G.OutcomeDetail, { action: "replaced" }>
  | { action: "replaced"; placeholders: string[]; segments?: number; replacement?: string };

export type SecurityEventView = Omit<G.SecurityEventView, "outcome_detail"> & { outcome_detail: OutcomeDetail };

export type SecurityEventsPage = Omit<G.SecurityEventsPage, "events"> & { events: SecurityEventView[] };

/** 一组规则一起启用或停用（组标题的复选框）。一次写配置 */
export interface RulesEnabledSave {
  /** 内置规则的 id */
  builtin: string[];
  /** 自定义规则的名字 */
  custom: string[];
  enabled: boolean;
  base_version: string;
}

// ------------------------------------------------------------------ 缺省值

/** 内容规则「替换」的缺省文字 */
export const DEFAULT_REPLACEMENT = "***";

/** 一条规则查哪一边。core 不给（内置规则、协议 48 之前）就是只查请求 */
export function scopeOf(r: SecurityRuleView): RuleScope[] {
  return r.scope && r.scope.length > 0 ? r.scope : ["request"];
}

/** 一条规则在「开启」档下做什么。不给时：密钥与隐私是替换为占位符，其余是仅记录 */
export function actionOf(guard: G.Guard, r: Pick<SecurityRuleView, "action">): RuleAction {
  return r.action ?? (guard === "redact" ? "placeholder" : "record");
}

// ------------------------------------------------------------------ 未定的形状

/**
 * 一组规则一起启用或停用。**端点名和路径约定里只给了一个例子**
 * （`PUT /security/{guard}/rules/enabled`）；集成时换成 `call("<端点名>", save, guard)`，
 * 并把端点名加进两份白名单。在那之前走 `call` 命令的原样形状，预览里的模拟按这个名字答
 */
export const RULES_ENABLED_ENDPOINT = "SetRulesEnabled";

export function setRulesEnabled(guard: G.Guard, save: RulesEnabledSave): Promise<G.ConfigWritten> {
  return invoke<G.ConfigWritten>("call", { endpoint: RULES_ENABLED_ENDPOINT, params: [guard], req: save });
}

/**
 * 「已替换」具体换成了什么：密钥与隐私是一组占位符，内容过滤是几处换成同一段文字。
 * 内容过滤那两个字段的名字未定（约定只说「segments, replacement」），只在这里读
 */
export function replacedOf(
  d: Extract<OutcomeDetail, { action: "replaced" }>,
): { kind: "placeholders"; placeholders: string[] } | { kind: "text"; segments: number; replacement: string } {
  if (d.replacement != null) return { kind: "text", segments: d.segments ?? 1, replacement: d.replacement };
  return { kind: "placeholders", placeholders: d.placeholders ?? [] };
}
