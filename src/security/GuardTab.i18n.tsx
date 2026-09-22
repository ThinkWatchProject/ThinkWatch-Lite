import { messages } from "@/i18n";

/** 一项防护在三档下各做什么。**代价写在切换之前** */
interface GuardCopy {
  /** 这项防护做什么，一句话 */
  lead: string;
  now: Record<"off" | "observe" | "enforce", string>;
  /** 「拦截」在这一项上做的事 */
  effect: string;
  /** 「拦截」的代价 */
  risk: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const guardTabText = messages(
  {
    redact: {
      lead: "请求发出前，按以下规则查找凭据。",
      now: {
        off: "当前：不检查，不记录。",
        observe: "当前：检出的凭据记入日志，请求原样发出。",
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
    ifEnforced: (effect: string, risk: string) => `切换到「拦截」后：${effect}${risk}`,
    rules: "规则",
    ruleCount: (on: number, all: number) => `已启用 ${on} 条，共 ${all} 条`,
    test: "测试…",
    newRule: "新建规则",
    rule: "规则",
    match: "匹配",
    regex: "匹配（正则表达式）",
    whenEnforced: "拦截时",
    enabled: "启用",
    builtinGroup: "内置",
    /** 配置里启用或停用了认不出的规则。多半是拼错了 */
    view: "查看规则",
    copyAsCustom: "复制为自定义规则",
    actionsFor: (name: string) => `${name} 的操作`,
    toggleFor: (name: string) => `启用「${name}」`,
    modeFor: (guard: string) => `${guard}的档位`,
  },
  {
    redact: {
      lead: "Before a request is sent, it is searched for credentials using the rules below.",
      now: {
        off: "Currently: nothing is checked or recorded.",
        observe: "Currently: credentials found are recorded in the log, and the request is sent unchanged.",
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
    ifEnforced: (effect: string, risk: string) => `After switching to Enforce: ${effect}${risk}`,
    rules: "Rules",
    ruleCount: (on: number, all: number) => `${on} of ${plural(all, "rule", "rules")} on`,
    test: "Test…",
    newRule: "New rule",
    rule: "Rule",
    match: "Match",
    regex: "Match (regular expression)",
    whenEnforced: "On enforce",
    enabled: "On",
    builtinGroup: "Built-in",
    view: "View rule",
    copyAsCustom: "Copy as a custom rule",
    actionsFor: (name: string) => `Actions for ${name}`,
    toggleFor: (name: string) => `Turn on “${name}”`,
    modeFor: (guard: string) => `${guard} mode`,
  },
);
