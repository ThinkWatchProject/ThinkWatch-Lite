/**
 * 安全页用到的控制面调用。
 *
 * **只是类型化的调用。**正则怎么编译、哪些写进文件、测试怎么和网关对齐，
 * 全在 core。界面多判断一次，就多一处和 core 说法不一致的可能。
 */
import { call } from "@/control";
import type { ContentMatch, CustomRuleSave, Guard, GuardMode, RuleAction, SecurityEventsQuery } from "@/types";

/** 自定义规则保存时带的内容。版本号由页面在写的那一刻补上 */
export type RuleSave = Omit<CustomRuleSave, "base_version">;

/** 内置规则能单独改处置的那几项。出站脱敏的规则命中就替换，没有自己的处置 */
export type ActionGuard = "inspect_tools" | "content";
export const hasAction = (g: Guard): g is ActionGuard => g === "inspect_tools" || g === "content";

export const api = {
  detail: () => call("Security", null),
  /** 安全日志的一页。`guard` 不给就是全部；`before` 翻页 */
  events: (q: SecurityEventsQuery) => call("SecurityEvents", q),
  setMode: (guard: Guard, mode: GuardMode, baseVersion: string) =>
    call("SetSecurityMode", { mode, base_version: baseVersion }, guard),
  /** 启用或停用一条内置规则 */
  toggleBuiltin: (guard: Guard, id: string, enabled: boolean, baseVersion: string) =>
    call("ToggleBuiltinRule", { enabled, base_version: baseVersion }, guard, id),
  /** 一条内置规则在第三档下做什么 */
  setAction: (guard: ActionGuard, id: string, action: RuleAction, baseVersion: string) =>
    call("SetBuiltinRuleAction", { action, base_version: baseVersion }, guard, id),
  createRule: (guard: Guard, save: CustomRuleSave) => call("CreateCustomRule", save, guard),
  updateRule: (guard: Guard, name: string, save: CustomRuleSave) => call("UpdateCustomRule", save, guard, name),
  deleteRule: (guard: Guard, name: string, baseVersion: string) =>
    call("DeleteCustomRule", { base_version: baseVersion }, guard, name),
  /**
   * 拿一段文本试一试。给了 `pattern` 就只试这一条（内容过滤按 `match` 认，出站脱敏按
   * `label` 写占位符），给了 `rule` 就只试这一条内置规则（停用着的也能试），都不给就按
   * 现在启用的全部规则。`action` 是对话框里选着、还没保存的处置：发出去的样子和会不会
   * 被拒按它算
   */
  test: (
    guard: Guard,
    sample: string,
    only: { pattern?: string; match?: ContentMatch; rule?: string; label?: string; action?: RuleAction } = {},
  ) => call("TestSecurity", { sample, ...only }, guard),
};
