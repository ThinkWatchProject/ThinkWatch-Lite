/**
 * 安全页用到的控制面调用。
 *
 * **只是类型化的 invoke。**正则怎么编译、哪些写进文件、测试怎么和网关对齐，
 * 全在 core。界面多判断一次，就多一处和 core 说法不一致的可能。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ConfigWritten,
  Guard,
  SecurityDetail,
  SecurityEventsPage,
  SecurityTestResult,
} from "@/types";


/** 新建或修改一条自定义规则时交过去的 */
export interface CustomRuleSave {
  name: string;
  pattern: string;
  /** 工具调用审查才有：`cut` / `record` */
  action?: "cut" | "record";
  enabled: boolean;
  base_version: string;
}

export const api = {
  detail: () => invoke<SecurityDetail>("security_detail"),
  /** 安全日志的一页。`guard` 不给就是两项都要；`before` 翻页 */
  events: (q: {
    guard?: Guard;
    fromMs?: number;
    toMs?: number;
    before?: number;
    limit?: number;
  }) => invoke<SecurityEventsPage>("security_events", q),
  setMode: (guard: Guard, mode: string, baseVersion: string) =>
    invoke<ConfigWritten>("set_security_mode", {
      guard,
      save: { mode, base_version: baseVersion },
    }),
  /** 启用或停用一条内置规则 */
  toggleBuiltin: (guard: Guard, id: string, enabled: boolean, baseVersion: string) =>
    invoke<ConfigWritten>("toggle_security_rule", {
      guard,
      id,
      save: { enabled, base_version: baseVersion },
    }),
  /** 一条内置规则在拦截档下做什么。只有工具调用审查的规则有这一项 */
  setAction: (id: string, action: "cut" | "record", baseVersion: string) =>
    invoke<ConfigWritten>("set_security_rule_action", {
      guard: "inspect_tools",
      id,
      save: { action, base_version: baseVersion },
    }),
  createRule: (guard: Guard, save: CustomRuleSave) =>
    invoke<ConfigWritten>("create_security_rule", { guard, save }),
  updateRule: (guard: Guard, name: string, save: CustomRuleSave) =>
    invoke<ConfigWritten>("update_security_rule", { guard, name, save }),
  deleteRule: (guard: Guard, name: string, baseVersion: string) =>
    invoke<ConfigWritten>("delete_security_rule", { guard, name, baseVersion }),
  /**
   * 拿一段文本试一试。给了 `pattern` 就只试这一条正则，给了 `rule` 就只试这
   * 一条内置规则（停用着的也能试），都不给就按现在启用的全部规则
   */
  test: (guard: Guard, sample: string, only: { pattern?: string; rule?: string } = {}) =>
    invoke<SecurityTestResult>("test_security", { guard, req: { sample, ...only } }),
};
