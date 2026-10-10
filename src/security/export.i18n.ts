import { messages } from "@/i18n";

/**
 * 安全日志导出的 CSV：表头，以及几个值的写法。JSON 用的是控制面的原样字段，不翻译。
 */
export const exportText = messages(
  {
    /** 表头，按列的先后 */
    columns: {
      time: "时间",
      action: "处置",
      guard: "类型",
      rule: "规则",
      ruleId: "规则 ID",
      ruleSource: "规则来源",
      pattern: "规则写法",
      matching: "匹配方式",
      coreVersion: "core 版本",
      excerpt: "命中",
      count: "次数",
      revealed: "隐藏内容",
      direction: "方向",
      locations: "位置",
      outcome: "处置细节",
      requestId: "请求",
      session: "会话",
      key: "密钥",
      keyMasked: "密钥掩码",
      provider: "上游",
      model: "模型",
      sentModel: "发往上游的模型",
      app: "应用",
      peer: "来源",
    },
    builtin: "内置",
    custom: "自定义",
    /** 位置一列里，没有列出的那些 */
    more: (n: number) => `另有 ${n} 处未列出`,
    /** 处置细节一列 */
    outcome: {
      recorded: "仅记录",
      replaced: (placeholders: string) => `替换为 ${placeholders}`,
      cut: (tool: string, args: string, truncated: boolean) => `切断 ${tool} 调用，参数${truncated ? "（仅开头）" : ""}：${args}`,
      clientNotice: (text: string) => `客户端收到：${text}`,
      blocked: "请求未发往上游",
      stripped: (n: number) => `删除 ${n} 处`,
    },
    /** 文件名的开头 */
    fileName: "安全日志",
  },
  {
    columns: {
      time: "Time",
      action: "Action",
      guard: "Type",
      rule: "Rule",
      ruleId: "Rule ID",
      ruleSource: "Rule source",
      pattern: "Pattern",
      matching: "Match by",
      coreVersion: "Core version",
      excerpt: "Match",
      count: "Count",
      revealed: "Hidden text",
      direction: "Direction",
      locations: "Locations",
      outcome: "Action detail",
      requestId: "Request",
      session: "Session",
      key: "Key",
      keyMasked: "Masked key",
      provider: "Upstream",
      model: "Model",
      sentModel: "Model sent to the upstream",
      app: "App",
      peer: "From",
    },
    builtin: "Built-in",
    custom: "Custom",
    more: (n: number) => (n === 1 ? "1 more match not listed" : `${n} more matches not listed`),
    outcome: {
      recorded: "Recorded only",
      replaced: (placeholders: string) => `Replaced with ${placeholders}`,
      cut: (tool: string, args: string, truncated: boolean) =>
        `Cut off the ${tool} call; arguments${truncated ? " (beginning only)" : ""}: ${args}`,
      clientNotice: (text: string) => `Client received: ${text}`,
      blocked: "Not sent to the upstream",
      stripped: (n: number) => (n === 1 ? "Deleted 1 segment" : `Deleted ${n} segments`),
    },
    fileName: "security-log",
  },
);
