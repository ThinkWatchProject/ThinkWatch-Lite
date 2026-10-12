import { messages } from "@/i18n";

/** 规则对话框里的一段。新建、编辑、内置规则、测试四个对话框共用 */
export const ruleDialogText = messages(
  {
    title: {
      redact: { create: "新建密钥与隐私规则", edit: "编辑密钥与隐私规则" },
      inspect_tools: { create: "新建危险命令规则", edit: "编辑危险命令规则" },
      content: { create: "新建内容规则", edit: "编辑内容规则" },
    },
    testTitle: {
      redact: "测试密钥与隐私",
      inspect_tools: "测试危险命令",
      content: "测试内容过滤",
    },
    name: "名称",
    nameHint: "记入日志及发出通知时显示此名称。",
    namePlaceholder: {
      redact: "内部令牌",
      inspect_tools: "删除集群资源",
      content: "项目代号",
    },
    /** 内容规则查哪一边 */
    scope: "检查对象",
    scopes: {
      request: "请求",
      response: "回答",
      both: "请求和回答",
    },
    scopeHint: "请求：用户消息与工具结果。回答：模型输出的正文，不含工具调用与思考过程。",
    /** 规则怎么认 */
    matchKind: "匹配方式",
    matchKinds: {
      contains: "包含",
      regex: "正则",
      codepoints: "码位",
    },
    caseSensitive: "区分大小写",
    patternLabel: "匹配内容",
    toolHint: "按工具调用的参数匹配，使用正则表达式。",
    /** 匹配方式下面那一句。`cased`：区分大小写 */
    matchHint: {
      contains: (cased: boolean) =>
        `按原文查找，「.」「*」等字符不作特殊处理；${cased ? "区分" : "不区分"}大小写。`,
      regex: (cased: boolean) => `按正则表达式匹配；${cased ? "区分" : "不区分"}大小写。`,
      codepoints: "码位或码位范围，多个之间用逗号分隔，如 U+200B, U+E0000–U+E007F。",
    },
    /** 检查对象含回答时，「码位」为何不可选 */
    codepointsRequestOnly: "码位仅适用于请求。",
    /** 检查对象含回答的正则规则：流式回答只暂缓有限的末尾 */
    regexAnswerLimit: "回答中超过 256 个字符的命中，起始部分可能已送达客户端。",
    /** 改了检查对象，选着的那一项不可选了，自动换成可选的 */
    switchedMatch: "检查对象含回答，匹配方式已改为「包含」。",
    switchedAction: "检查对象含回答，动作已改为「删除」。",
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
    /** 密钥与隐私：换成的占位符叫什么 */
    label: "占位符名称",
    labelHint: "替换为 <<TW_名称_序号>>。只能使用大写字母、数字和下划线。",
    labelBad: "须以大写字母开头，只能使用大写字母、数字和下划线，最多 24 个字符。",
    match: "匹配",
    /** 规则在「开启」状态下做什么 */
    action: "动作",
    /** 选了某一种动作时下面那一句 */
    actionWhat: {
      placeholder: "命中内容替换为占位符后发出，回答中出现该占位符时还原为原值。",
      cut: "命中的调用不完整送达客户端，客户端无法执行该调用。",
      block: "命中的请求不发出，客户端收到拒绝的原因。",
      strip: "删除命中内容，不保留任何标记。",
      replace: "命中内容替换为下方的替换文本。",
      record: {
        redact: "命中内容照常发出，记入日志并发出系统通知。",
        inspect_tools: "命中的调用照常返回，记入日志并发出系统通知。",
        content: "命中内容不作修改，记入日志并发出系统通知。",
      },
    },
    /** 检查对象含回答时，「拒绝」为何不可选 */
    blockRequestOnly: "拒绝仅适用于请求：回答以流式输出，已送达的内容无法撤回。",
    /** 内容规则：换成什么 */
    replacement: "替换文本",
    replacementHint: "命中内容替换为此文本，不可还原。",
    replacementRequired: "请填写替换文本",
    /** 内置规则选了「替换」：换成的文字固定 */
    builtinReplace: (text: string) => `命中内容替换为 ${text}，不可还原。`,
    /** 内置规则：出厂时的动作 */
    factory: (what: string) => `出厂设置为「${what}」。`,
    state: "状态",
    on: "已启用",
    off: "已停用",
    /** 内置脱敏规则：命中的内容换成什么 */
    replacedWith: "替换为",
    category: (kind: string) => `类别：${kind}`,
    sample: "测试文本",
    /** 测试文本当作哪一边来试 */
    testAs: {
      request: "按请求测试",
      response: "按回答测试",
    },
    samplePlaceholder: {
      redact: "粘贴一段文本，例如一段含有密钥的环境变量",
      inspect_tools: "粘贴一段工具调用的参数，例如一条要执行的命令",
      content: "粘贴一段用户消息或工具结果",
    },
    sampleAnswer: "粘贴一段模型回答的正文",
    hits: (n: number) => `命中 ${n} 处`,
    rule: "规则",
    noHit: "未命中",
    content: "内容",
    line: (n: number) => `第 ${n} 行`,
    testDesc: "按当前启用的规则检查一段文本，不发出任何请求。",
    /** 测试结果：处理后的样子 */
    output: "处理后",
    /** 测试结果：有「拒绝」规则命中 */
    refused: (mode: string) => `在「${mode}」状态下，此请求不会发出，客户端收到拒绝的原因。`,
    /** 防护处于「监控」时，对话框底部那一句 */
    monitoring: "当前分项处于监控状态，规则仅记录命中，不修改内容。",
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
      redact: { create: "New secrets & privacy rule", edit: "Edit secrets & privacy rule" },
      inspect_tools: { create: "New dangerous command rule", edit: "Edit dangerous command rule" },
      content: { create: "New content rule", edit: "Edit content rule" },
    },
    testTitle: {
      redact: "Test secrets & privacy",
      inspect_tools: "Test dangerous commands",
      content: "Test the content filter",
    },
    name: "Name",
    nameHint: "Shown in the log and in notifications.",
    namePlaceholder: {
      redact: "Internal token",
      inspect_tools: "Delete cluster resources",
      content: "Project codename",
    },
    scope: "Checks",
    scopes: {
      request: "Request",
      response: "Answer",
      both: "Request and answer",
    },
    scopeHint:
      "Request: user messages and tool results. Answer: the text the model writes, excluding tool calls and thinking.",
    matchKind: "Match by",
    matchKinds: {
      contains: "Contains",
      regex: "Regex",
      codepoints: "Code points",
    },
    caseSensitive: "Match case",
    patternLabel: "Match",
    toolHint: "A regular expression matched against the arguments of each tool call.",
    matchHint: {
      contains: (cased: boolean) =>
        `Looked for as written; characters such as . and * have no special meaning. ${cased ? "Case must match" : "Case is ignored"}.`,
      regex: (cased: boolean) => `A regular expression. ${cased ? "Case must match" : "Case is ignored"}.`,
      codepoints: "Code points or ranges, separated by commas, such as U+200B, U+E0000–U+E007F.",
    },
    codepointsRequestOnly: "Code points apply to requests only.",
    regexAnswerLimit: "In answers, the beginning of a match longer than 256 characters may already have reached the client.",
    switchedMatch: "The rule checks answers, so the match was changed to Contains.",
    switchedAction: "The rule checks answers, so the action was changed to Delete.",
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
      placeholder:
        "Matches are replaced with placeholders before sending; a placeholder that appears in the answer is restored to the original value. ",
      cut: "A matching call never fully reaches the client, so the client cannot run it. ",
      block: "A matching request is not sent, and the client is told why. ",
      strip: "Matches are deleted without leaving any marker. ",
      replace: "Matches are replaced with the replacement text below. ",
      record: {
        redact: "Matches are sent as usual, recorded in the log and notified. ",
        inspect_tools: "A matching call is returned as usual, recorded in the log and notified. ",
        content: "Matches are left unchanged, recorded in the log and notified. ",
      },
    },
    blockRequestOnly:
      "Refuse applies to requests only: answers are streamed, and text already delivered cannot be withdrawn.",
    replacement: "Replacement text",
    replacementHint: "Matches are replaced with this text, which cannot be restored.",
    replacementRequired: "Enter the replacement text",
    builtinReplace: (text: string) => `Matches are replaced with ${text}, which cannot be restored. `,
    factory: (what: string) => `The factory setting is “${what}”.`,
    state: "State",
    on: "On",
    off: "Off",
    replacedWith: "Replaced with",
    category: (kind: string) => `Category: ${kind}`,
    sample: "Test text",
    testAs: {
      request: "Test as request",
      response: "Test as answer",
    },
    samplePlaceholder: {
      redact: "Paste some text, such as environment variables that contain a key",
      inspect_tools: "Paste the arguments of a tool call, such as a command to run",
      content: "Paste a user message or a tool result",
    },
    sampleAnswer: "Paste the text of a model answer",
    hits: (n: number) => (n === 1 ? "1 match" : `${n} matches`),
    rule: "Rule",
    noHit: "No match",
    content: "Content",
    line: (n: number) => `Line ${n}`,
    testDesc: "Checks a piece of text against the rules that are on. No request is sent.",
    output: "After processing",
    refused: (mode: string) => `When the protection is ${mode}, this request is not sent, and the client is told why.`,
    monitoring: "This protection is in Monitor: rules only record matches and change nothing.",
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
