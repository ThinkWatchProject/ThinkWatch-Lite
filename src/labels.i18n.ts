import { messages } from "@/i18n";
// 密钥与隐私的规则名和 core 消息的中文是同一张表（Rust 写系统通知时也读它）
import CORE_ZH from "@/i18n/core.zh.json";

/** `labels.ts` 里那些名称表和说法 */
export const labelsText = messages(
  {
    // ------------------------------------------------------------ 路由
    groupKinds: {
      fallback: "按顺序",
      select: "手动选择",
      "load-balance": "轮询",
      "url-test": "延迟最低",
      cheapest: "费用最低",
    },
    /** 轮询组按什么分请求（`balance_by`） */
    balanceBy: {
      weights: "按比例",
      latency: "按速度",
      health: "按稳定性",
      "latency-health": "按速度和稳定性",
    },
    allUpstreams: "全部上游",
    probes: {
      health_check: {
        label: "连通性检查",
        what: "客户端启动时发送的空请求，用于确认网关可达。",
      },
      warmup: { label: "预热", what: "正文为 Warmup 的请求，用于预热连接与缓存。" },
      titling: { label: "生成标题", what: "为会话生成标题。设为本地应答时，所有会话使用同一标题。" },
      topic_detect: {
        label: "话题识别",
        what: "判断本轮对话的话题，客户端据此决定是否切换上下文。",
      },
      suggestion: { label: "输入建议", what: "输入框中显示的补全建议。" },
    },
    /** 布尔条件满足（`yes`）和不满足（`no`）时的说法 */
    flags: {
      cache: { yes: "带缓存", no: "不带缓存" },
      tools: { yes: "带工具", no: "不带工具" },
      image: { yes: "带图片", no: "不带图片" },
      thinking: { yes: "开启扩展思考", no: "未开启扩展思考" },
      stream: { yes: "流式", no: "非流式" },
    },
    conditionNames: {
      model: "模型",
      client: "密钥",
      dialect: "客户端格式",
      input_tokens: "输入 token",
      max_tokens: "max_tokens",
      tool_count: "工具数",
      intent: "辅助请求",
      provider_would_be: "选定上游",
      time: "时段",
    },
    anyProbe: "任一辅助请求",
    /** 一个条件的几个取值之间 */
    or: " 或 ",
    // 试算里没命中的原因
    userRequest: "用户请求",
    notSet: "未设置",
    flagMismatch: (want: string, got: string) => `要求${want}，实际为${got}`,
    /** 数量条件：值是比较式（`>200k`） */
    countMismatch: (name: string, want: string, got: string) => `要求${name} ${want}，实际为 ${got}`,
    valueMismatch: (name: string, want: string, got: string) => `要求${name}为 ${want}，实际为 ${got}`,
    // 参数改写
    setModel: (model: string) => `模型改为 ${model}，prompt cache 整体失效`,
    onlyAtSessionStart: "以上改写仅在新会话开始时应用",
    setField: (field: string, value: string) => `${field} 改为 ${value}`,
    reasoningLevel: (level: string) => `推理 ${level}`,
    reasoningOff: "关闭推理",
    // 尝试链
    /** 一跳发出的推理强度和客户端要的不同 */
    effort: {
      rule: (asked: string, sent: string) => `推理强度 ${asked} → ${sent}：规则改写`,
      ruleRemoved: "已去掉推理强度：规则改写",
      ruleOff: "已关闭推理：规则改写",
      rejected: (asked: string, sent: string) => `推理强度 ${asked} 被上游拒收，已改用 ${sent} 重发`,
      rejectedRemoved: (asked: string) => `推理强度 ${asked} 被上游拒收，已去掉后重发`,
      rejectedOff: "关闭推理（none）被上游拒收，已去掉该字段后重发",
      rejectedOffTo: (sent: string) => `关闭推理（none）被上游拒收，已改用 ${sent} 重发`,
      remembered: (asked: string, sent: string) => `推理强度 ${asked} → ${sent}：该模型不支持 ${asked}`,
      rememberedRemoved: (asked: string) => `已去掉推理强度：该模型不支持 ${asked}`,
      rememberedOff: "已去掉推理强度：该模型不支持关闭推理（none）",
      rememberedOffTo: (sent: string) => `推理强度 none → ${sent}：该模型不支持关闭推理`,
    },
    served: "成功",
    servedStatus: (status: number) => `成功 · ${status}`,
    rejected: (status: number) => `${status} · 请求被上游拒绝`,
    rateLimited: "429 · 限流",
    upstreamError: (status: number | string) => `${status} · 上游错误`,
    noResponse: "未收到响应",
    estimated: "本地估算",
    estimatedAfter: (status: number) => `${status} · 本地估算`,
    /** 等到无响应超时还没有内容，放弃了这个上游 */
    idleTimeout: "无响应超时",
    idleTimeoutSecs: (secs: string) => `无响应超时 · ${secs} 秒`,
    /** 在界面上手动中止 */
    aborted: "手动中止",
    /** 选定上游之后被规则拒绝的那一跳：没有发给这个上游 */
    deniedHop: (rule: string) => `未发送 · 被规则「${rule}」拒绝`,
    // 没有上游接下的请求，在「上游」的位置上写的那一句：规则拒绝、没有可用的上游、
    // 密钥的用量上限拒绝、上游都满着、上游都在限流暂停、上游都到了用量上限、几种都有
    notSent: {
      denied: "规则拒绝",
      unavailable: "无可用上游",
      model: "模型不可用",
      unrouted: "未能路由",
      limited: "用量上限",
      busy: "并发已满",
      throttled: "上游限流中",
      full: "上游用量已满",
      timeout: "等待超时",
    },

    // ------------------------------------------------------------ 请求与费用
    quote: {
      free: "不计费。",
      estimate: (amount: string) => `预估费用约 ${amount}。`,
      unpriced: (model: string) => `无法计价：${model} 不在价目表中。`,
    },
    // ------------------------------------------------------------ 配置
    /** 后面接「错误」 */
    stages: {
      syntax: "语法",
      schema: "字段",
      semantics: "语义",
    },

    // ------------------------------------------------------------ 安全
    /** 密钥与隐私的内置规则名。和系统通知（Rust）共用 core.zh.json 里的同一张表 */
    secrets: CORE_ZH.tables.secret_rule as Record<string, string>,

    // ------------------------------------------------------------ 客户端接管
    takesEffect: {
      immediately: "下一个请求即使用新配置。",
      onRestart: "重新启动客户端后生效；通过环境变量读取配置的客户端需重新打开终端。",
    },
  },
  {
    groupKinds: {
      fallback: "In order",
      select: "Manual",
      "load-balance": "Round robin",
      "url-test": "Lowest latency",
      cheapest: "Lowest cost",
    },
    balanceBy: {
      weights: "By ratio",
      latency: "By speed",
      health: "By reliability",
      "latency-health": "By speed and reliability",
    },
    allUpstreams: "All upstreams",
    probes: {
      health_check: {
        label: "Health check",
        what: "An empty request sent when the client starts, to confirm the gateway is reachable.",
      },
      warmup: {
        label: "Warm-up",
        what: "A request with Warmup as its body, sent to warm up the connection and cache.",
      },
      titling: {
        label: "Title generation",
        what: "Generates a title for the session. When set to “Answer locally”, every session gets the same title.",
      },
      topic_detect: {
        label: "Topic detection",
        what: "Detects the topic of the current turn; the client uses it to decide whether to switch context.",
      },
      suggestion: { label: "Suggestions", what: "Completion suggestions shown in the input box." },
    },
    flags: {
      cache: { yes: "With cache", no: "Without cache" },
      tools: { yes: "With tools", no: "Without tools" },
      image: { yes: "With images", no: "Without images" },
      thinking: { yes: "Extended thinking on", no: "Extended thinking off" },
      stream: { yes: "Streaming", no: "Non-streaming" },
    },
    conditionNames: {
      model: "Model",
      client: "Key",
      dialect: "Client format",
      input_tokens: "Input tokens",
      max_tokens: "max_tokens",
      tool_count: "Tool count",
      intent: "Auxiliary request",
      provider_would_be: "Selected upstream",
      time: "Time",
    },
    anyProbe: "Any auxiliary request",
    or: " or ",
    // 这两个只出现在句中「actual:」之后，所以小写
    userRequest: "user request",
    notSet: "not set",
    // 布尔条件的说法本身是一个标签（With cache），放进句子里加引号，不改大小写
    flagMismatch: (want: string, got: string) => `Requires “${want}”; actual: “${got}”`,
    countMismatch: (name: string, want: string, got: string) => `${name} must be ${want}; actual: ${got}`,
    valueMismatch: (name: string, want: string, got: string) => `${name} must be ${want}; actual: ${got}`,
    setModel: (model: string) => `Model set to ${model}; the entire prompt cache is invalidated`,
    onlyAtSessionStart: "The rewrites above apply only when a new session starts",
    setField: (field: string, value: string) => `${field} set to ${value}`,
    reasoningLevel: (level: string) => `Reasoning ${level}`,
    reasoningOff: "Reasoning off",
    effort: {
      rule: (asked: string, sent: string) => `Reasoning effort ${asked} → ${sent}: rewritten by a rule`,
      ruleRemoved: "Reasoning effort removed: rewritten by a rule",
      ruleOff: "Reasoning turned off: rewritten by a rule",
      rejected: (asked: string, sent: string) =>
        `Reasoning effort ${asked} was rejected by the upstream; resent with ${sent}`,
      rejectedRemoved: (asked: string) => `Reasoning effort ${asked} was rejected by the upstream; resent without it`,
      rejectedOff: "Turning reasoning off (none) was rejected by the upstream; resent without the field",
      rejectedOffTo: (sent: string) => `Turning reasoning off (none) was rejected by the upstream; resent with ${sent}`,
      remembered: (asked: string, sent: string) =>
        `Reasoning effort ${asked} → ${sent}: the model does not support ${asked}`,
      rememberedRemoved: (asked: string) => `Reasoning effort removed: the model does not support ${asked}`,
      rememberedOff: "Reasoning effort removed: the model does not support turning reasoning off (none)",
      rememberedOffTo: (sent: string) => `Reasoning effort none → ${sent}: the model does not support turning reasoning off`,
    },
    served: "Succeeded",
    servedStatus: (status: number) => `Succeeded · ${status}`,
    rejected: (status: number) => `${status} · Rejected by the upstream`,
    rateLimited: "429 · Rate limited",
    upstreamError: (status: number | string) => `${status} · Upstream error`,
    noResponse: "No response received",
    estimated: "Estimated locally",
    estimatedAfter: (status: number) => `${status} · Estimated locally`,
    idleTimeout: "No response",
    idleTimeoutSecs: (secs: string) => `No response · ${secs} s`,
    aborted: "Aborted",
    deniedHop: (rule: string) => `Not sent · denied by rule “${rule}”`,
    // 流量表「上游」那一列放得下的长度：再长就折成两行
    notSent: {
      denied: "Denied",
      unavailable: "No upstream",
      model: "Model unavailable",
      unrouted: "Not routed",
      limited: "Usage limit",
      busy: "At capacity",
      throttled: "Rate limited",
      full: "Upstream limit",
      timeout: "Wait timed out",
    },

    quote: {
      free: "Free.",
      estimate: (amount: string) => `Estimated cost: about ${amount}.`,
      unpriced: (model: string) => `Unpriced: ${model} is not in the price sheet.`,
    },
    stages: {
      syntax: "Syntax",
      schema: "Field",
      semantics: "Semantic",
    },

    secrets: {
      "anthropic-api-key": "Anthropic API key",
      "openai-api-key": "OpenAI API key",
      "openai-project-key": "OpenAI project key",
      "github-personal-token": "GitHub personal access token",
      "github-oauth-token": "GitHub OAuth token",
      "github-server-token": "GitHub server token",
      "github-user-token": "GitHub user token",
      "github-fine-grained-token": "GitHub fine-grained token",
      "slack-bot-token": "Slack bot token",
      "slack-user-token": "Slack user token",
      "slack-app-token": "Slack app token",
      "aws-access-key-id": "AWS access key ID",
      "aws-temporary-key-id": "AWS temporary access key ID",
      "google-api-key": "Google API key",
      "google-oauth-token": "Google OAuth token",
      "gitlab-token": "GitLab token",
      "stripe-live-key": "Stripe live key",
      "stripe-restricted-key": "Stripe restricted key",
      "npm-token": "npm token",
      "digitalocean-token": "DigitalOcean token",
      "sendgrid-key": "SendGrid key",
      "private-key": "Private key",
      jwt: "JWT",
      "conn-string-password": "Connection string password",
      "cn-resident-id": "Chinese resident ID number",
      "bank-card": "Bank card number",
      email: "Email address",
      "cn-mobile-phone": "Chinese mainland mobile number",
      "internal-ip": "Internal IP address",
      "internal-domain": "Internal domain",
    },

    takesEffect: {
      immediately: "The next request uses the new configuration.",
      onRestart:
        "Takes effect after the client restarts; clients that read their configuration from environment variables also need the terminal reopened.",
    },
  },
);
