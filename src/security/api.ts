/**
 * 安全页用到的控制面调用。
 *
 * **只是类型化的调用。**正则怎么编译、哪些写进文件、测试怎么和网关对齐，
 * 全在 core。界面多判断一次，就多一处和 core 说法不一致的可能。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type {
  ContentMatch,
  ContentScope,
  CustomRuleSave,
  Guard,
  GuardMode,
  RuleAction,
  RulesToggle,
  SecurityEventsQuery,
} from "@/types";

/** 只试哪一条，见 `api.test` */
export interface TrialOnly {
  pattern?: string;
  match?: ContentMatch;
  case_sensitive?: boolean;
  rule?: string;
  label?: string;
  action?: RuleAction;
  /** 内容过滤：这段文本当作请求还是回答来试 */
  scope?: ContentScope;
  /** 内容过滤：动作为「替换」时换成的文字 */
  replacement?: string;
}

/** 自定义规则保存时带的内容。版本号由页面在写的那一刻补上 */
export type RuleSave = Omit<CustomRuleSave, "base_version">;

/** 每一项防护的规则在「开启」档下能做的几件事，按选项的顺序 */
export const ACTIONS: Record<Guard, readonly RuleAction[]> = {
  redact: ["placeholder", "record"],
  inspect_tools: ["cut", "record"],
  content: ["block", "strip", "replace", "record"],
};

export const api = {
  detail: () => call("Security", null),
  /** 安全日志的一页。`guard` 不给就是全部；`before` 翻页 */
  events: (q: SecurityEventsQuery) => call("SecurityEvents", q),
  /**
   * 导出的文件：弹系统的「存储」对话框，`name` 是默认文件名，存到用户选的地方。返回存到的
   * 路径；用户取消了是 `null`。**对话框和写文件都在 Rust 这一侧**（`export::save_export`），
   * 网页拿不到任意写文件的能力
   */
  saveExport: (name: string, contents: string) => invoke<string | null>("save_export", { name, contents }),
  setMode: (guard: Guard, mode: GuardMode, baseVersion: string) =>
    call("SetSecurityMode", { mode, base_version: baseVersion }, guard),
  /** 启用或停用一条内置规则 */
  toggleBuiltin: (guard: Guard, id: string, enabled: boolean, baseVersion: string) =>
    call("ToggleBuiltinRule", { enabled, base_version: baseVersion }, guard, id),
  /** 一组规则一起启用或停用：一次写配置 */
  setEnabled: (guard: Guard, save: RulesToggle) => call("SetRulesEnabled", save, guard),
  /** 一条内置规则在「开启」档下做什么 */
  setAction: (guard: Guard, id: string, action: RuleAction, baseVersion: string) =>
    call("SetBuiltinRuleAction", { action, base_version: baseVersion }, guard, id),
  createRule: (guard: Guard, save: CustomRuleSave) =>
    call("CreateCustomRule", save, guard),
  updateRule: (guard: Guard, name: string, save: CustomRuleSave) =>
    call("UpdateCustomRule", save, guard, name),
  deleteRule: (guard: Guard, name: string, baseVersion: string) =>
    call("DeleteCustomRule", { base_version: baseVersion }, guard, name),
  /**
   * 拿一段文本试一试。给了 `pattern` 就只试这一条（按 `match` 认、按 `case_sensitive` 分不分
   * 大小写，密钥与隐私按 `label` 写占位符），给了 `rule` 就只试这一条内置规则（停用着的也能
   * 试），都不给就按现在启用的全部规则。`action` 是对话框里选着、还没保存的动作：处理后的
   * 样子和会不会被拒按它算。内容过滤的 `scope` 说这段当作请求还是回答来试，`replacement`
   * 是还没保存的替换文字
   */
  test: (guard: Guard, sample: string, only: TrialOnly = {}) =>
    call("TestSecurity", { sample, ...only }, guard),
};
