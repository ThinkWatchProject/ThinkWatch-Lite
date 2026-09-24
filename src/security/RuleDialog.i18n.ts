import { messages } from "@/i18n";

/** 规则对话框里的一段。新建、编辑、内置规则、测试四个对话框共用 */
export const ruleDialogText = messages(
  {
    /** 有自定义规则的三项 */
    title: {
      redact: { create: "新建脱敏规则", edit: "编辑脱敏规则" },
      inspect_tools: { create: "新建审查规则", edit: "编辑审查规则" },
      content: { create: "新建内容规则", edit: "编辑内容规则" },
    },
    testTitle: {
      redact: "测试出站脱敏",
      inspect_tools: "测试工具调用审查",
      hidden_text: "测试隐藏字符",
      content: "测试内容过滤",
    },
    name: "名称",
    nameHint: {
      redact: "记入日志时显示此名称。",
      inspect_tools: "记入日志和通知时显示此名称。",
      content: "记入日志和拒绝原因时显示此名称。",
    },
    namePlaceholder: {
      redact: "内部令牌",
      inspect_tools: "删除集群资源",
      content: "项目代号",
    },
    /** 内容规则怎么认 */
    matchKind: "匹配方式",
    contains: "包含",
    regexKind: "正则表达式",
    patternLabel: {
      contains: "匹配内容",
      regex: "匹配（正则表达式）",
    },
    patternHint: {
      redact: "匹配到的整段内容按凭据处理。",
      inspect_tools: "按工具调用的参数匹配。",
    },
    contentHint: {
      contains: "在用户消息和工具结果中查找这段文字，不区分大小写，首尾空格也参与匹配。",
      regex: "在用户消息和工具结果中匹配，不区分大小写。",
    },
    match: "匹配",
    whenEnforced: "拦截时",
    /** 选了「切断」或「拒绝」时下面那一句 */
    strongWhat: {
      inspect_tools: "命中的调用不会完整到达客户端，因而无法执行。",
      content: "命中的请求不发出，客户端收到拒绝的原因。",
    },
    recordWhat: {
      inspect_tools: "命中的调用照常返回，只记入日志。",
      content: "命中的请求照常发出，只记入日志。",
    },
    /** 内置规则改过处置时补的一句 */
    factory: (what: string) => `出厂设置为「${what}」。`,
    state: "状态",
    on: "已启用",
    off: "已停用",
    category: (kind: string) => `类别：${kind}`,
    sample: "测试文本",
    samplePlaceholder: {
      redact: "粘贴一段文本，例如一段含有密钥的环境变量",
      inspect_tools: "粘贴一段工具调用的参数，例如一条要执行的命令",
      hidden_text: "粘贴一段文本，例如从网页或文档中复制的内容",
      content: "粘贴一段用户消息或工具结果",
    },
    result: "结果",
    hits: (n: number) => `命中 ${n} 处`,
    rule: "规则",
    noHit: "未命中",
    content: "内容",
    position: "位置",
    line: (n: number) => `第 ${n} 行`,
    testDesc: "按当前启用的规则检查一段文本，不发出任何请求。",
    builtin: "内置",
    copyAsCustom: "复制为自定义规则",
    nameRequired: "请填写名称",
    nameTaken: "已有同名规则",
    patternRequired: {
      contains: "请填写匹配内容",
      regex: "请填写正则表达式",
    },
    create: "创建",
    saveFailed: "未能保存",
    deleteTitle: (name: string) => `删除规则「${name}」`,
    deleteDesc: "删除后不再按此规则检查。日志中已有的记录保留。",
    deleteFailed: "未能删除",
  },
  {
    title: {
      redact: { create: "New redaction rule", edit: "Edit redaction rule" },
      inspect_tools: { create: "New inspection rule", edit: "Edit inspection rule" },
      content: { create: "New content rule", edit: "Edit content rule" },
    },
    testTitle: {
      redact: "Test outbound redaction",
      inspect_tools: "Test tool-call inspection",
      hidden_text: "Test hidden characters",
      content: "Test the content filter",
    },
    name: "Name",
    nameHint: {
      redact: "Shown in the log.",
      inspect_tools: "Shown in the log and in notifications.",
      content: "Shown in the log and in the reason given for a refusal.",
    },
    namePlaceholder: {
      redact: "Internal token",
      inspect_tools: "Delete cluster resources",
      content: "Project codename",
    },
    matchKind: "Match by",
    contains: "Contains",
    regexKind: "Regular expression",
    patternLabel: {
      contains: "Text to find",
      regex: "Match (regular expression)",
    },
    patternHint: {
      redact: "Everything the pattern matches is treated as a credential.",
      inspect_tools: "Matched against the arguments of each tool call.",
    },
    contentHint: {
      contains:
        "Searched for in user messages and tool results, ignoring case. Leading and trailing spaces count.",
      regex: "Matched against user messages and tool results, ignoring case.",
    },
    match: "Match",
    whenEnforced: "On enforce",
    strongWhat: {
      inspect_tools: "A matching call never fully reaches the client, so it cannot run. ",
      content: "A matching request is not sent, and the client is told why. ",
    },
    recordWhat: {
      inspect_tools: "A matching call is returned as usual and recorded in the log. ",
      content: "A matching request is sent as usual and recorded in the log. ",
    },
    factory: (what: string) => `The factory setting is “${what}”.`,
    state: "State",
    on: "On",
    off: "Off",
    category: (kind: string) => `Category: ${kind}`,
    sample: "Test text",
    samplePlaceholder: {
      redact: "Paste some text, such as environment variables that contain a key",
      inspect_tools: "Paste the arguments of a tool call, such as a command to run",
      hidden_text: "Paste some text, such as content copied from a web page or a document",
      content: "Paste a user message or a tool result",
    },
    result: "Result",
    hits: (n: number) => (n === 1 ? "1 match" : `${n} matches`),
    rule: "Rule",
    noHit: "No match",
    content: "Content",
    position: "Position",
    line: (n: number) => `Line ${n}`,
    testDesc: "Checks a piece of text against the rules that are on. No request is sent.",
    builtin: "Built-in",
    copyAsCustom: "Copy as a custom rule",
    nameRequired: "Enter a name",
    nameTaken: "A rule with this name already exists",
    patternRequired: {
      contains: "Enter the text to find",
      regex: "Enter a regular expression",
    },
    create: "Create",
    saveFailed: "Not saved",
    deleteTitle: (name: string) => `Delete the rule “${name}”`,
    deleteDesc: "The rule is no longer checked. Entries already in the log are kept.",
    deleteFailed: "Not deleted",
  },
);
