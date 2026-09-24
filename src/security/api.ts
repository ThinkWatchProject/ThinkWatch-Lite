/**
 * 安全页用到的控制面调用。
 *
 * **只是类型化的调用。**正则怎么编译、哪些写进文件、测试怎么和网关对齐，
 * 全在 core。界面多判断一次，就多一处和 core 说法不一致的可能。
 */
import { call } from "@/control";
import type { CustomRuleSave, SecurityEventsQuery, Guard } from "@/types";

export type { CustomRuleSave };

export const api = {
  detail: () => call("Security", null),
  /** 安全日志的一页。`guard` 不给就是两项都要；`before` 翻页 */
  events: (q: SecurityEventsQuery & { guard?: Guard }) => call("SecurityEvents", q),
  setMode: (guard: Guard, mode: string, baseVersion: string) =>
    call("SetSecurityMode", { mode, base_version: baseVersion }, guard),
  /** 启用或停用一条内置规则 */
  toggleBuiltin: (guard: Guard, id: string, enabled: boolean, baseVersion: string) =>
    call("ToggleBuiltinRule", { enabled, base_version: baseVersion }, guard, id),
  /** 一条内置规则在拦截档下做什么。只有工具调用审查的规则有这一项 */
  setAction: (id: string, action: "cut" | "record", baseVersion: string) =>
    call("SetBuiltinRuleAction", { action, base_version: baseVersion }, "inspect_tools", id),
  createRule: (guard: Guard, save: CustomRuleSave) => call("CreateCustomRule", save, guard),
  updateRule: (guard: Guard, name: string, save: CustomRuleSave) =>
    call("UpdateCustomRule", save, guard, name),
  deleteRule: (guard: Guard, name: string, baseVersion: string) =>
    call("DeleteCustomRule", { base_version: baseVersion }, guard, name),
  /**
   * 拿一段文本试一试。给了 `pattern` 就只试这一条正则，给了 `rule` 就只试这
   * 一条内置规则（停用着的也能试），都不给就按现在启用的全部规则
   */
  test: (guard: Guard, sample: string, only: { pattern?: string; rule?: string } = {}) =>
    call("TestSecurity", { sample, ...only }, guard),
};
