import { messages } from "@/i18n";
import type { GuardMode } from "@/types";

/** 一项防护在三档下各做什么。**代价写在切换之前** */
export interface GuardCopy {
  /** 这项防护做什么，一句话 */
  lead: string;
  now: Record<GuardMode, string>;
  /** 第三档在这一项上做的事 */
  effect: string;
  /** 第三档的代价 */
  risk: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const guardTabText = messages(
  {
    redact: {
      lead: "请求发出前，按以下规则查找凭据和个人信息。",
      now: {
        off: "当前：不检查，不记录。",
        observe: "当前：检出的内容记入日志，请求原样发出。",
        enforce: "当前：检出的内容替换为占位符后发出，响应中的占位符还原为原值。",
      },
      effect: "检出的内容替换为占位符后发出，响应中的占位符还原为原值。",
      risk: "请求内容改变后，上游缓存可能无法命中。",
    } as GuardCopy,
    inspect_tools: {
      lead: "检查上游返回的工具调用参数。",
      now: {
        off: "当前：不检查，不记录。",
        observe: "当前：命中的调用记入日志，照常返回。",
        enforce:
          "当前：命中「切断」规则的调用不会完整到达客户端，因而无法执行；命中「仅记录」规则的调用照常返回。两类都记入日志。",
      },
      effect: "命中「切断」规则的调用不会完整到达客户端，因而无法执行。",
      risk: "误判时，回答会在该调用处中断。",
    } as GuardCopy,
    content: {
      lead: "按以下规则检查请求中的用户消息和工具结果。",
      now: {
        off: "当前：不检查，不记录。",
        observe: "当前：命中的内容记入日志，请求原样发出。",
        enforce:
          "当前：命中「拒绝」规则的请求不发出，客户端收到拒绝的原因；命中「删除」规则的内容删除后发出；命中「仅记录」规则的请求照常发出。三类都记入日志。",
      },
      effect: "命中「拒绝」规则的请求不发出，命中「删除」规则的内容删除后发出。",
      risk: "误判时，正常的请求会被拒绝，或正常的文字被删除。",
    } as GuardCopy,
    /** 不在第三档时，档位下面那一句：切过去之后会怎样，代价是什么 */
    ifEnforced: (mode: string, effect: string, risk: string) => `切换到「${mode}」后：${effect}${risk}`,
    rules: "规则",
    ruleCount: (on: number, all: number) => `已启用 ${on} 条，共 ${all} 条`,
    test: "测试…",
    newRule: "新建规则",
    rule: "规则",
    match: "匹配",
    /** 规则在第三档下做什么 */
    action: "处置",
    enabled: "启用",
    builtinGroup: "内置",
    view: "查看规则",
    turnOn: "启用",
    turnOff: "停用",
    copyAsCustom: "复制为自定义规则",
    actionsFor: (name: string) => `${name} 的操作`,
    toggleFor: (name: string) => `启用「${name}」`,
    modeFor: (guard: string) => `${guard}的档位`,
  },
  {
    redact: {
      lead: "Before a request is sent, it is searched for credentials and personal information using the rules below.",
      now: {
        off: "Currently: nothing is checked or recorded.",
        observe: "Currently: what is found is recorded in the log, and the request is sent unchanged.",
        enforce:
          "Currently: what is found is replaced with placeholders before sending, and the placeholders in the response are restored to the original values.",
      },
      effect:
        "what is found is replaced with placeholders before sending, and the placeholders in the response are restored to the original values. ",
      risk: "Once the request content changes, the upstream cache may no longer be hit.",
    },
    inspect_tools: {
      lead: "Tool-call arguments returned by the upstream are checked.",
      now: {
        off: "Currently: nothing is checked or recorded.",
        observe: "Currently: matching calls are recorded in the log and returned as usual.",
        enforce:
          "Currently: calls that match a “cut off” rule never fully reach the client, so they cannot run; calls that match a “record only” rule are returned as usual. Both are recorded in the log.",
      },
      effect: "calls that match a “cut off” rule never fully reach the client, so they cannot run. ",
      risk: "On a false match, the answer stops at that call.",
    },
    content: {
      lead: "User messages and tool results in each request are checked against the rules below.",
      now: {
        off: "Currently: nothing is checked or recorded.",
        observe: "Currently: matches are recorded in the log, and the request is sent unchanged.",
        enforce:
          "Currently: a request that matches a “refuse” rule is not sent, and the client is told why; text that matches a “delete” rule is deleted before sending; a request that matches a “record only” rule is sent as usual. All three are recorded in the log.",
      },
      effect:
        "a request that matches a “refuse” rule is not sent, and text that matches a “delete” rule is deleted before sending. ",
      risk: "On a false match, an ordinary request is refused, or ordinary text is deleted.",
    },
    ifEnforced: (mode: string, effect: string, risk: string) => `After switching to ${mode}: ${effect}${risk}`,
    rules: "Rules",
    ruleCount: (on: number, all: number) => `${on} of ${plural(all, "rule", "rules")} on`,
    test: "Test…",
    newRule: "New rule",
    rule: "Rule",
    match: "Match",
    action: "Action",
    enabled: "On",
    builtinGroup: "Built-in",
    view: "View rule",
    turnOn: "Turn on",
    turnOff: "Turn off",
    copyAsCustom: "Copy as a custom rule",
    actionsFor: (name: string) => `Actions for ${name}`,
    toggleFor: (name: string) => `Turn on “${name}”`,
    modeFor: (guard: string) => `${guard} mode`,
  },
);
