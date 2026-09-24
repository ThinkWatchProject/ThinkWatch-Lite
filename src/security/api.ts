/**
 * 安全页用到的控制面调用。
 *
 * **只是类型化的调用。**正则怎么编译、哪些写进文件、测试怎么和网关对齐，
 * 全在 core。界面多判断一次，就多一处和 core 说法不一致的可能。
 */
import { call } from "@/control";
import type {
  ContentMatch,
  CustomRuleSave,
  Guard,
  GuardMode,
  RuleAction,
  RuleGuard,
  SecurityEventsQuery,
} from "@/types";

/** 自定义规则保存时带的内容。版本号由页面在写的那一刻补上 */
export type RuleSave = Omit<CustomRuleSave, "base_version">;

/** 有自定义规则的那几项 */
export type CustomGuard = "redact" | "inspect_tools" | "content";
export const hasCustom = (g: Guard): g is CustomGuard =>
  g === "redact" || g === "inspect_tools" || g === "content";

/** 内置规则能单独改处置的那几项 */
export type ActionGuard = "inspect_tools" | "content";
export const hasAction = (g: Guard): g is ActionGuard => g === "inspect_tools" || g === "content";

export const api = {
  detail: () => call("Security", null),
  /** 安全日志的一页。`guard` 不给就是全部；`before` 翻页 */
  events: (q: SecurityEventsQuery) => call("SecurityEvents", q),
  setMode: (guard: Guard, mode: GuardMode, baseVersion: string) =>
    call("SetSecurityMode", { mode, base_version: baseVersion }, guard),
  /** 启用或停用一条内置规则 */
  toggleBuiltin: (guard: RuleGuard, id: string, enabled: boolean, baseVersion: string) =>
    call("ToggleBuiltinRule", { enabled, base_version: baseVersion }, guard, id),
  /** 一条内置规则在拦截档下做什么 */
  setAction: (guard: ActionGuard, id: string, action: RuleAction, baseVersion: string) =>
    call("SetBuiltinRuleAction", { action, base_version: baseVersion }, guard, id),
  /** 输出长度的上限，按字符数 */
  setLimit: (maxChars: number, baseVersion: string) =>
    call("SetSecurityLimit", { max_chars: maxChars, base_version: baseVersion }, "output_limit"),
  createRule: (guard: CustomGuard, save: CustomRuleSave) => call("CreateCustomRule", save, guard),
  updateRule: (guard: CustomGuard, name: string, save: CustomRuleSave) =>
    call("UpdateCustomRule", save, guard, name),
  deleteRule: (guard: CustomGuard, name: string, baseVersion: string) =>
    call("DeleteCustomRule", { base_version: baseVersion }, guard, name),
  /**
   * 拿一段文本试一试。给了 `pattern` 就只试这一条（内容过滤按 `match` 认），
   * 给了 `rule` 就只试这一条内置规则（停用着的也能试），都不给就按现在启用的
   * 全部规则
   */
  test: (guard: RuleGuard, sample: string, only: { pattern?: string; match?: ContentMatch; rule?: string } = {}) =>
    call("TestSecurity", { sample, ...only }, guard),
};
