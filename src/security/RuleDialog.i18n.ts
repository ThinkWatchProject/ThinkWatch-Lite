import { messages } from "@/i18n";

/** 规则对话框里的一段。新建、编辑、内置规则、测试四个对话框共用 */
export const ruleDialogText = messages(
  {
    title: {
      redact: { create: "新建脱敏规则", edit: "编辑脱敏规则" },
      inspect_tools: { create: "新建审查规则", edit: "编辑审查规则" },
      content: { create: "新建内容规则", edit: "编辑内容规则" },
    },
    testTitle: {
      redact: "测试出站脱敏",
      inspect_tools: "测试工具调用审查",
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
    matchKinds: {
      contains: "包含",
      regex: "正则",
      codepoints: "码位",
    },
    patternLabel: {
      contains: "匹配内容",
      regex: "匹配（正则表达式）",
      codepoints: "码位",
    },
    patternHint: {
      redact: "匹配到的整段内容按凭据处理。",
      inspect_tools: "按工具调用的参数匹配。",
    },
    contentHint: {
      contains: "在用户消息和工具结果中查找这段文字，不区分大小写，首尾空格也参与匹配。",
      regex: "在用户消息和工具结果中匹配，不区分大小写。",
      codepoints: "码位或码位范围，多个之间用逗号分隔，如 U+200B, U+E0000–U+E007F。在用户消息和工具结果中查找这些字符。",
    },
    /** 码位输入框里的样子 */
    codepointsExample: "U+200B, U+E0000–U+E007F",
    /** 码位写错时，输入框下面那一句 */
    codepointsBad: {
      syntax: (item: string) => `「${item}」不是码位写法，应写成 U+200B 或 U+E0000–U+E007F。`,
      range: (item: string) => `「${item}」超出码位范围，最大为 U+10FFFF。`,
      surrogate: (item: string) => `「${item}」落在代理区（U+D800–U+DFFF），不能单独作为码位。`,
      order: (item: string) => `「${item}」的起点大于终点。`,
      count: (max: number) => `最多 ${max} 项。`,
    },
    /** 出站脱敏：换成的占位符叫什么 */
    label: "占位符名称",
    labelHint: "替换为 <<TW_名称_序号>>。只能使用大写字母、数字和下划线。",
    labelBad: "须以大写字母开头，只能使用大写字母、数字和下划线，最多 24 个字符。",
    match: "匹配",
    /** 规则在第三档下做什么 */
    action: "处置",
    /** 选了某一种处置时下面那一句 */
    actionWhat: {
      cut: "命中的调用不会完整到达客户端，因而无法执行。",
      block: "命中的请求不发出，客户端收到拒绝的原因。",
      strip: "命中的文字从用户消息和工具结果中删除，请求照常发出。",
      record: {
        inspect_tools: "命中的调用照常返回，只记入日志。",
        content: "命中的请求照常发出，只记入日志。",
      },
    },
    /** 内置规则：出厂时的处置 */
    factory: (what: string) => `出厂设置为「${what}」。`,
    state: "状态",
    on: "已启用",
    off: "已停用",
    /** 内置脱敏规则：命中的内容换成什么 */
    replacedWith: "替换为",
    category: (kind: string) => `类别：${kind}`,
    sample: "测试文本",
    samplePlaceholder: {
      redact: "粘贴一段文本，例如一段含有密钥的环境变量",
      inspect_tools: "粘贴一段工具调用的参数，例如一条要执行的命令",
      content: "粘贴一段用户消息或工具结果",
    },
    hits: (n: number) => `命中 ${n} 处`,
    rule: "规则",
    noHit: "未命中",
    content: "内容",
    position: "位置",
    line: (n: number) => `第 ${n} 行`,
    testDesc: "按当前启用的规则检查一段文本，不发出任何请求。",
    /** 测试结果：替换、删除之后真正发出去的那一份 */
    output: "发出的内容",
    /** 测试结果：有「拒绝」规则命中 */
    refused: (mode: string) => `在「${mode}」档下，此请求不会发出，客户端收到拒绝的原因。`,
    builtin: "内置",
    copyAsCustom: "复制为自定义规则",
    nameRequired: "请填写名称",
    nameTaken: "已有同名规则",
    patternRequired: {
      contains: "请填写匹配内容",
      regex: "请填写正则表达式",
      codepoints: "请填写码位",
    },
    labelRequired: "请填写占位符名称",
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
    matchKinds: {
      contains: "Contains",
      regex: "Regex",
      codepoints: "Code points",
    },
    patternLabel: {
      contains: "Text to find",
      regex: "Match (regular expression)",
      codepoints: "Code points",
    },
    patternHint: {
      redact: "Everything the pattern matches is treated as a credential.",
      inspect_tools: "Matched against the arguments of each tool call.",
    },
    contentHint: {
      contains:
        "Searched for in user messages and tool results, ignoring case. Leading and trailing spaces count.",
      regex: "Matched against user messages and tool results, ignoring case.",
      codepoints:
        "Code points or ranges, separated by commas, such as U+200B, U+E0000–U+E007F. These characters are searched for in user messages and tool results.",
    },
    codepointsExample: "U+200B, U+E0000–U+E007F",
    codepointsBad: {
      syntax: (item: string) => `“${item}” is not a code point; write U+200B or U+E0000–U+E007F.`,
      range: (item: string) => `“${item}” is out of range; the largest code point is U+10FFFF.`,
      surrogate: (item: string) => `“${item}” is in the surrogate range (U+D800–U+DFFF), which cannot stand on its own.`,
      order: (item: string) => `“${item}” starts after it ends.`,
      count: (max: number) => `At most ${max} items.`,
    },
    label: "Placeholder name",
    labelHint: "Replaced with <<TW_NAME_n>>. Use capital letters, digits and underscores only.",
    labelBad: "Start with a capital letter and use capital letters, digits and underscores only, up to 24 characters.",
    match: "Match",
    action: "Action",
    actionWhat: {
      cut: "A matching call never fully reaches the client, so it cannot run. ",
      block: "A matching request is not sent, and the client is told why. ",
      strip: "Matching text is deleted from user messages and tool results, and the request is sent. ",
      record: {
        inspect_tools: "A matching call is returned as usual and recorded in the log. ",
        content: "A matching request is sent as usual and recorded in the log. ",
      },
    },
    factory: (what: string) => `The factory setting is “${what}”.`,
    state: "State",
    on: "On",
    off: "Off",
    replacedWith: "Replaced with",
    category: (kind: string) => `Category: ${kind}`,
    sample: "Test text",
    samplePlaceholder: {
      redact: "Paste some text, such as environment variables that contain a key",
      inspect_tools: "Paste the arguments of a tool call, such as a command to run",
      content: "Paste a user message or a tool result",
    },
    hits: (n: number) => (n === 1 ? "1 match" : `${n} matches`),
    rule: "Rule",
    noHit: "No match",
    content: "Content",
    position: "Position",
    line: (n: number) => `Line ${n}`,
    testDesc: "Checks a piece of text against the rules that are on. No request is sent.",
    output: "What is sent",
    refused: (mode: string) => `In ${mode} mode this request is not sent, and the client is told why.`,
    builtin: "Built-in",
    copyAsCustom: "Copy as a custom rule",
    nameRequired: "Enter a name",
    nameTaken: "A rule with this name already exists",
    patternRequired: {
      contains: "Enter the text to find",
      regex: "Enter a regular expression",
      codepoints: "Enter code points",
    },
    labelRequired: "Enter a placeholder name",
    create: "Create",
    saveFailed: "Not saved",
    deleteTitle: (name: string) => `Delete the rule “${name}”`,
    deleteDesc: "The rule is no longer checked. Entries already in the log are kept.",
    deleteFailed: "Not deleted",
  },
);
