import { messages } from "@/i18n";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * 插件的名词：权限、状态、运行结果、出错时的处置、适用范围。插件页、安装与审核的
 * 对话框、请求详情都用这一份。
 *
 * **权限按它允许做的事说**，不按清单里的写法（`reply.tool_calls`）说：用户决定装不装，
 * 看的是「它能改什么」。`note` 是会让人做错决定的那一句后果。
 */
export const pluginLabelsText = messages(
  {
    permissions: {
      system: { short: "系统提示词", what: "读取和修改系统提示词", note: "" },
      messages: {
        short: "对话消息",
        what: "读取和修改对话消息中的文字和工具结果",
        note: "可以向对话中加入指令",
      },
      tools: { short: "工具定义", what: "读取和修改工具定义", note: "会改变模型可用的工具" },
      params: {
        short: "请求参数",
        what: "读取和修改模型名、max_tokens、温度等参数",
        note: "可能改变发给上游的模型和产生的费用",
      },
      reply_text: { short: "回答文字", what: "读取和修改回答中的文字", note: "" },
      reply_tool_calls: {
        short: "回答中的工具调用",
        what: "修改、删除和新增回答中的工具调用",
        note: "高风险：可以改写客户端将要执行的命令和文件路径",
      },
    } as Record<string, { short: string; what: string; note: string }>,
    highRisk: "高风险",
    chipTip: (what: string, note: string) => (note ? `${what}。${note}。` : `${what}。`),
    added: "新增",
    removed: "已移除",
    /** 改回答文字的插件，整段模式下文字到齐才交给客户端 */
    blockMode: "回答文字整段到齐后才显示",

    /** 插件处理的请求种类。只处理对话的（出厂就是这样）不写 */
    kinds: { conversation: "对话", embeddings: "向量化", completions: "补全" } as Record<string, string>,
    alsoHandles: (list: string) => `也处理：${list}`,
    onlyHandles: (list: string) => `仅处理：${list}`,

    status: {
      ok: "生效中",
      disabled: "已停用",
      changed: "文件已更改",
      error: "加载失败",
    } as Record<string, string>,

    outcomes: {
      unchanged: "未改动",
      changed: "已改写",
      rejected: "已拒绝",
      error: "出错",
      skipped: "已跳过",
    } as Record<string, string>,
    hooks: { request: "请求", reply: "回答" } as Record<string, string>,

    onError: "出错时",
    onErrorOptions: { reject: "拒绝这次请求", skip: "跳过此插件" },

    scope: "适用范围",
    scopeParts: { clients: "客户端", models: "模型", upstreams: "上游" },
    all: "全部",
    allRequests: "全部请求",
    scopeLine: (part: string, value: string) => `${part}：${value}`,
    allOf: { clients: "全部客户端", models: "全部模型", upstreams: "全部上游" },
    listSep: "、",

    /** 平均 CPU 时间 */
    cpu: (ms: string) => `${ms} 毫秒`,
    lessThanMs: "不到 0.1 毫秒",
  },
  {
    permissions: {
      system: { short: "System prompt", what: "Read and change the system prompt", note: "" },
      messages: {
        short: "Messages",
        what: "Read and change the text and tool results in conversation messages",
        note: "Can add instructions to the conversation",
      },
      tools: { short: "Tool definitions", what: "Read and change tool definitions", note: "Changes which tools the model can use" },
      params: {
        short: "Parameters",
        what: "Read and change the model, max_tokens, temperature and other parameters",
        note: "May change the model sent upstream and what it costs",
      },
      reply_text: { short: "Reply text", what: "Read and change the text of replies", note: "" },
      reply_tool_calls: {
        short: "Tool calls in replies",
        what: "Change, remove and add tool calls in replies",
        note: "High risk: can rewrite the commands and file paths a client is about to run",
      },
    } as Record<string, { short: string; what: string; note: string }>,
    highRisk: "High risk",
    chipTip: (what: string, note: string) => (note ? `${what}. ${note}.` : `${what}.`),
    added: "New",
    removed: "Removed",
    blockMode: "Reply text appears once each block is complete",

    kinds: { conversation: "conversations", embeddings: "embeddings", completions: "completions" } as Record<string, string>,
    alsoHandles: (list: string) => `Also handles: ${list}`,
    onlyHandles: (list: string) => `Handles only: ${list}`,

    status: {
      ok: "Active",
      disabled: "Disabled",
      changed: "File changed",
      error: "Failed to load",
    } as Record<string, string>,

    outcomes: {
      unchanged: "Unchanged",
      changed: "Changed",
      rejected: "Rejected",
      error: "Error",
      skipped: "Skipped",
    } as Record<string, string>,
    hooks: { request: "Request", reply: "Reply" } as Record<string, string>,

    onError: "On error",
    onErrorOptions: { reject: "Reject the request", skip: "Skip this plugin" },

    scope: "Applies to",
    scopeParts: { clients: "Clients", models: "Models", upstreams: "Upstreams" },
    all: "All",
    allRequests: "All requests",
    scopeLine: (part: string, value: string) => `${part}: ${value}`,
    allOf: { clients: "All clients", models: "All models", upstreams: "All upstreams" },
    listSep: ", ",

    cpu: (ms: string) => `${ms} ms`,
    lessThanMs: "under 0.1 ms",
  },
);

/** 统计：运行几次、改写几次。插件页的那一格和它的悬停 */
export const pluginStatsText = messages(
  {
    runs: (n: number) => `${n.toLocaleString()} 次运行`,
    changedShort: (n: number) => `改写 ${n.toLocaleString()}`,
    errorsShort: (n: number) => `出错 ${n.toLocaleString()}`,
    noRuns: "尚未运行",
    since: "网关启动以来",
    lines: {
      calls: "运行",
      changed: "改写",
      rejected: "拒绝",
      errors: "出错",
      cpu: "平均 CPU 时间",
      lastError: "最近一次出错",
    },
  },
  {
    runs: (n: number) => plural(n, "run", "runs"),
    changedShort: (n: number) => `${n.toLocaleString()} changed`,
    errorsShort: (n: number) => plural(n, "error", "errors"),
    noRuns: "Not run yet",
    since: "Since the gateway started",
    lines: {
      calls: "Runs",
      changed: "Changed",
      rejected: "Rejected",
      errors: "Errors",
      cpu: "Average CPU time",
      lastError: "Last error",
    },
  },
);
