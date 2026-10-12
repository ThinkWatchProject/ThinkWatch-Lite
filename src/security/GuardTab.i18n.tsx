import { messages } from "@/i18n";
import type { Guard, GuardMode } from "@/types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const guardTabText = messages(
  {
    /**
     * 状态选择右边那一句：当前状态下命中之后怎样。「开启」各项一样（按每条规则的动作）；
     * 「监控」说清记录、通知、内容不变
     */
    now: {
      enforce: "开启：命中内容按各条规则设定的动作处理。",
      observe: {
        redact: "监控：命中内容记入日志并发出通知，请求不作修改。",
        inspect_tools: "监控：命中的工具调用记入日志并发出通知，照常返回客户端。",
        content: "监控：命中内容记入日志并发出通知，请求与回答不作修改。",
      },
      off: "关闭：不检查，不记录。",
    } as { enforce: string; observe: Record<Guard, string>; off: string },
    ruleCount: (on: number, all: number) => `已启用 ${on} 条，共 ${all} 条。`,
    /** 规则表上方的检索框 */
    search: "检索规则",
    noMatch: "无匹配的规则",
    test: "测试…",
    newRule: "新建规则",
    enabled: "启用",
    rule: "规则",
    match: "匹配内容",
    /** 内容规则查哪一边 */
    scope: "检查对象",
    /** 规则在「开启」状态下做什么 */
    action: "动作",
    /** 组标题：「隐藏字符 · 内置 · 已启用 2 条，共 3 条」 */
    builtin: "内置",
    groupCount: (on: number, all: number) => `已启用 ${on} 条，共 ${all} 条`,
    /** 组标题的复选框 */
    groupToggle: (group: string) => `启用「${group}」中的全部规则`,
    /** 行内的动作选择，给读屏 */
    actionFor: (name: string) => `「${name}」的动作`,
    /** 动作为「替换」时，行内选项写出换成什么 */
    replaceWith: (text: string) => `替换为 ${text}`,
    turnOn: "启用",
    turnOff: "停用",
    copyAsCustom: "复制为自定义规则",
    actionsFor: (name: string) => `${name} 的操作`,
    toggleFor: (name: string) => `启用「${name}」`,
    modeFor: (guard: string) => `${guard}的状态`,
  },
  {
    now: {
      enforce: "On: matches are handled by the action set on each rule.",
      observe: {
        redact: "Monitor: matches are recorded in the log and notified; requests are not changed.",
        inspect_tools:
          "Monitor: matching tool calls are recorded in the log and notified, and are returned to the client as usual.",
        content: "Monitor: matches are recorded in the log and notified; requests and answers are not changed.",
      },
      off: "Off: nothing is checked or recorded.",
    },
    ruleCount: (on: number, all: number) => `${on} of ${plural(all, "rule", "rules")} on.`,
    search: "Search rules",
    noMatch: "No matching rules",
    test: "Test…",
    newRule: "New rule",
    enabled: "On",
    rule: "Rule",
    match: "Match",
    scope: "Checks",
    action: "Action",
    builtin: "Built-in",
    groupCount: (on: number, all: number) => `${on} of ${all} on`,
    groupToggle: (group: string) => `Turn on all rules in “${group}”`,
    actionFor: (name: string) => `Action for “${name}”`,
    replaceWith: (text: string) => `Replace with ${text}`,
    turnOn: "Turn on",
    turnOff: "Turn off",
    copyAsCustom: "Copy as a custom rule",
    actionsFor: (name: string) => `Actions for ${name}`,
    toggleFor: (name: string) => `Turn on “${name}”`,
    modeFor: (guard: string) => `${guard} state`,
  },
);

/** 「开启」「监控」「关闭」下那一句 */
export function nowText(t: typeof guardTabText.zh, guard: Guard, mode: GuardMode): string {
  return mode === "observe" ? t.now.observe[guard] : t.now[mode];
}
