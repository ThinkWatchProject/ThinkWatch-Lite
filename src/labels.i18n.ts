import { messages } from "@/i18n";

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
    // 尝试链
    served: "成功",
    servedStatus: (status: number) => `成功 · ${status}`,
    rejected: (status: number) => `${status} · 请求被上游拒绝`,
    rateLimited: "429 · 限流",
    upstreamError: (status: number | string) => `${status} · 上游错误`,
    noResponse: "未收到响应",

    // ------------------------------------------------------------ 请求与费用
    quote: {
      free: "不计费。",
      estimate: (amount: string) => `预估费用约 ${amount}。`,
      unpriced: (model: string) => `无法计价：${model} 不在价目表中。`,
    },
    // ------------------------------------------------------------ 配置
    origins: {
      ui: "界面",
      cli: "命令行",
      external: "外部编辑",
      rollback: "回滚",
      rotation: "凭据轮换",
    },
    /** 后面接「错误」 */
    stages: {
      syntax: "语法",
      schema: "字段",
      semantics: "语义",
    },

    // ------------------------------------------------------------ 安全
    secrets: {
      "anthropic-api-key": "Anthropic API 密钥",
      "openai-api-key": "OpenAI API 密钥",
      "openai-project-key": "OpenAI 项目密钥",
      "github-personal-token": "GitHub 个人令牌",
      "github-oauth-token": "GitHub OAuth 令牌",
      "github-server-token": "GitHub 服务器令牌",
      "github-user-token": "GitHub 用户令牌",
      "github-fine-grained-token": "GitHub 细粒度令牌",
      "slack-bot-token": "Slack 机器人令牌",
      "slack-user-token": "Slack 用户令牌",
      "slack-app-token": "Slack 应用令牌",
      "aws-access-key-id": "AWS 访问密钥 ID",
      "aws-temporary-key-id": "AWS 临时访问密钥 ID",
      "google-api-key": "Google API 密钥",
      "google-oauth-token": "Google OAuth 令牌",
      "gitlab-token": "GitLab 令牌",
      "stripe-live-key": "Stripe 生产密钥",
      "stripe-restricted-key": "Stripe 受限密钥",
      "npm-token": "npm 令牌",
      "digitalocean-token": "DigitalOcean 令牌",
      "sendgrid-key": "SendGrid 密钥",
      "private-key": "私钥",
      jwt: "JWT",
      "conn-string-password": "连接串口令",
      "internal-ip": "内网地址",
      "internal-domain": "内部域名",
    },

    // ------------------------------------------------------------ 客户端接管
    takesEffect: {
      immediately: "下一个请求即使用新配置。",
      onRestart: "重新启动客户端后生效；通过环境变量读取配置的客户端需重新打开终端。",
    },
    fieldsOnly: "字段名已查证，尚未在本机实际运行验证。",
  },
  {
    groupKinds: {
      fallback: "In order",
      select: "Manual",
      "load-balance": "Round robin",
      "url-test": "Lowest latency",
      cheapest: "Lowest cost",
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
    served: "Succeeded",
    servedStatus: (status: number) => `Succeeded · ${status}`,
    rejected: (status: number) => `${status} · Rejected by the upstream`,
    rateLimited: "429 · Rate limited",
    upstreamError: (status: number | string) => `${status} · Upstream error`,
    noResponse: "No response received",

    quote: {
      free: "Free.",
      estimate: (amount: string) => `Estimated cost: about ${amount}.`,
      unpriced: (model: string) => `Unpriced: ${model} is not in the price sheet.`,
    },
    origins: {
      ui: "App",
      cli: "Command line",
      external: "External edit",
      rollback: "Rollback",
      rotation: "Credential rotation",
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
      "internal-ip": "Internal IP address",
      "internal-domain": "Internal domain",
    },

    takesEffect: {
      immediately: "The next request uses the new configuration.",
      onRestart:
        "Takes effect after the client restarts; clients that read their configuration from environment variables also need the terminal reopened.",
    },
    fieldsOnly: "Field names are verified; not yet confirmed by an actual run on this machine.",
  },
);
