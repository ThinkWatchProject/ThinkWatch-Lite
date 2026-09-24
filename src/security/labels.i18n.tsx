import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子里要按代码样式画的那一段。怎么画由组件决定，这里只管是哪几个字 */
type Code = (text: string) => ReactNode;

const or = (xs: ReactNode[], sep: ReactNode, last: ReactNode) =>
  xs.flatMap((x, i) => (i === 0 ? [x] : [i === xs.length - 1 ? last : sep, x]));

/**
 * 各项防护共用的名称：档位、处置、类别、规则名，以及内置规则的匹配判据。
 *
 * **规则名只收内置的。**自定义规则的名字就是用户起的，原样显示；表里没有
 * 的，退回 core 给的英文名或 id。
 */
export const securityLabelsText = messages(
  {
    guards: {
      redact: "出站脱敏",
      inspect_tools: "工具调用审查",
      hidden_text: "隐藏字符",
      content: "内容过滤",
      output_limit: "输出长度",
    },
    /** 日志「类型」一栏，短一点 */
    guardShort: {
      redact: "出站脱敏",
      inspect_tools: "工具调用",
      hidden_text: "隐藏字符",
      content: "内容过滤",
      output_limit: "输出长度",
    },
    modes: {
      off: "关闭",
      observe: "观察",
      enforce: "拦截",
    } as Record<string, string>,
    /** 日志里每一条做了什么 */
    actions: {
      recorded: "仅记录",
      replaced: "已替换",
      cut: "已切断",
      blocked: "已拒绝",
    } as Record<string, string>,
    /** 工具调用规则、内容规则在拦截档下做什么 */
    ruleActions: {
      cut: "切断",
      block: "拒绝",
      record: "仅记录",
    } as Record<string, string>,
    kinds: {
      "api-keys": "API 密钥",
      "private-keys": "私钥",
      jwt: "JWT",
      "conn-strings": "连接串",
      internal: "内网地址",
      command: "内置",
      injection: "指令覆盖",
      persona: "身份与提示词",
      chinese: "中文说法",
      invisible: "隐藏字符",
      custom: "自定义",
    } as Record<string, string>,
    custom: "自定义",
    builtin: "内置",
    /** 命中处在工具结果里（日志的 `tool` 是 `tool_result`） */
    toolResult: "工具结果",
    /** 隐藏字符的两种。和 core.i18n 里扫描发现用的是同一对名字 */
    hiddenKinds: {
      tag: "Unicode 标签字符",
      bidi: "双向控制符",
    } as Record<string, string>,
    /** 输出长度只有一条「规则」，日志里 `rule` 是 `max_chars` */
    outputLimit: "超过输出长度",
    /** 日志一条的第二行 */
    detail: {
      /** 出站脱敏：同一个值在一个请求里出现了几次 */
      times: (n: number) => `出现 ${n} 次`,
      /** 隐藏字符：标签字符解出来的原文 */
      revealed: (text: string) => `隐藏内容「${text}」`,
      chars: (n: number) => `共 ${n.toLocaleString()} 个字符`,
      limit: (max: number, seen: number) =>
        `上限 ${max.toLocaleString()} 个字符，超出时为 ${seen.toLocaleString()} 个字符`,
    },
    /** 内容过滤的内置规则 */
    contentRules: {
      "ignore-previous-instructions": "要求忽略先前的指令",
      "ignore-all-previous": "要求忽略之前的全部内容",
      "disregard-your-instructions": "要求无视指令",
      jailbreak: "越狱",
      dan: "DAN",
      "developer-mode": "开发者模式",
      "you-are-now": "重新设定身份",
      "new-persona": "新的人设",
      "act-as": "要求扮演角色",
      "pretend-to-be": "要求假装身份",
      "system-prompt": "索取系统提示词",
      "reveal-your-instructions": "要求透露指令",
      "what-are-your-rules": "询问规则",
      "base64-wall": "长串 Base64",
      "zh-ignore-previous": "要求忽略先前的指令（中文）",
      "zh-forget-your": "要求忘记指令（中文）",
      "zh-do-not-follow": "要求不要遵循（中文）",
      "zh-you-are-now": "重新设定身份（中文）",
      "zh-role-play": "要求扮演角色（中文）",
      "zh-reveal-your": "要求透露指令（中文）",
      "zh-system-prompt": "系统提示词（中文）",
      "zh-jailbreak": "越狱（中文）",
    } as Record<string, string>,
    /**
     * 内置扫描规则的名字。工具调用审查用其中的危险命令一组；MCP 页的扫描
     * 发现两组都用（提示注入那一组只查客户端配置，不查工具调用）。
     */
    rules: {
      "ignore-previous": "要求忽略先前的指令",
      disregard: "要求无视系统提示",
      "you-are-now": "重新设定模型身份",
      "ignore-previous-zh": "要求忽略先前的指令（中文）",
      "new-instructions-zh": "声明新的指令（中文）",
      "you-are-now-zh": "重新设定模型身份（中文）",
      "chat-marker": "伪造对话标记",
      "fake-system": "伪装的系统发言",
      "curl-pipe-sh": "下载即执行",
      "base64-decode-exec": "解码后执行",
      "exfil-env": "外发环境变量",
      "exfil-credentials": "外发凭据文件",
      "exfil-credentials-reversed": "外发凭据文件（动词在前）",
      "ssh-key-read": "读取私钥或云凭据",
      "write-startup-item": "写入启动项",
      "crontab-install": "安装定时任务",
      "rm-rf-root": "删除主目录或根目录",
      "chmod-777": "开放全部写权限",
    } as Record<string, string>,
    matcher: {
      prefix: (code: Code, prefix: string, n: number) => (
        <>
          {code(prefix)} 开头，其后至少 {n} 个字符
        </>
      ),
      openaiLegacy: (code: Code, n: number) => (
        <>
          {code("sk-")} 开头，全长至少 {n} 个字符，同时含字母和数字
        </>
      ),
      pem: (code: Code) => <>{code("-----BEGIN … PRIVATE KEY-----")} 至对应的 END，整段</>,
      jwt: (code: Code) => <>三段 base64url，首段解码后含 {code('"alg"')}</>,
      connString: (code: Code) => <>{code("协议://用户:口令@主机")} 中的口令，只换口令</>,
      privateIp: (code: Code) => (
        <>
          {code("10.")}、{code("172.16–31.")}、{code("192.168.")} 开头的地址，不含 127.0.0.1
        </>
      ),
      domainSuffix: (code: Code, suffixes: string[]) => (
        <>以 {or(suffixes.map(code), "、", "、")} 结尾的域名</>
      ),
      regex: (code: Code, pattern: string) => <>正则 {code(pattern)}</>,
      contains: (code: Code, text: string) => <>包含 {code(text)}，不区分大小写</>,
      codepoints: (code: Code, ranges: string[]) => <>码位 {or(ranges.map(code), "、", "、")}</>,
    },
  },
  {
    guards: {
      redact: "Outbound redaction",
      inspect_tools: "Tool-call inspection",
      hidden_text: "Hidden characters",
      content: "Content filter",
      output_limit: "Output limit",
    },
    guardShort: {
      redact: "Redaction",
      inspect_tools: "Tool call",
      hidden_text: "Hidden text",
      content: "Content",
      output_limit: "Output",
    },
    modes: {
      off: "Off",
      observe: "Observe",
      enforce: "Enforce",
    },
    actions: {
      recorded: "Recorded",
      replaced: "Replaced",
      cut: "Cut off",
      blocked: "Refused",
    },
    ruleActions: {
      cut: "Cut off",
      block: "Refuse",
      record: "Record only",
    },
    kinds: {
      "api-keys": "API keys",
      "private-keys": "Private keys",
      jwt: "JWTs",
      "conn-strings": "Connection strings",
      internal: "Internal addresses",
      command: "Built-in",
      injection: "Instruction override",
      persona: "Identity and prompts",
      chinese: "Chinese phrasing",
      invisible: "Hidden characters",
      custom: "Custom",
    },
    custom: "Custom",
    builtin: "Built-in",
    toolResult: "tool result",
    hiddenKinds: {
      tag: "Unicode tag characters",
      bidi: "Bidirectional controls",
    },
    outputLimit: "Over the output limit",
    detail: {
      times: (n: number) => `${n} times`,
      revealed: (text: string) => `hidden text “${text}”`,
      chars: (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString()} characters`),
      limit: (max: number, seen: number) =>
        `Limit ${max.toLocaleString()} characters; ${seen.toLocaleString()} when it was passed`,
    },
    contentRules: {
      "ignore-previous-instructions": "Ignore previous instructions",
      "ignore-all-previous": "Ignore all previous",
      "disregard-your-instructions": "Disregard your instructions",
      jailbreak: "Jailbreak",
      dan: "DAN",
      "developer-mode": "Developer mode",
      "you-are-now": "Persona manipulation",
      "new-persona": "New persona",
      "act-as": "Act as",
      "pretend-to-be": "Pretend to be",
      "system-prompt": "System prompt extraction",
      "reveal-your-instructions": "Reveal instructions",
      "what-are-your-rules": "What are your rules",
      "base64-wall": "Base64 smuggling",
      "zh-ignore-previous": "Ignore previous instructions (Chinese)",
      "zh-forget-your": "Forget your instructions (Chinese)",
      "zh-do-not-follow": "Do not follow (Chinese)",
      "zh-you-are-now": "You are now (Chinese)",
      "zh-role-play": "Role-play (Chinese)",
      "zh-reveal-your": "Reveal your instructions (Chinese)",
      "zh-system-prompt": "System prompt (Chinese)",
      "zh-jailbreak": "Jailbreak (Chinese)",
    },
    rules: {
      "ignore-previous": "Ignore previous instructions",
      disregard: "Disregard the system prompt",
      "you-are-now": "Reset the model's identity",
      "ignore-previous-zh": "Ignore previous instructions (Chinese)",
      "new-instructions-zh": "New instructions (Chinese)",
      "you-are-now-zh": "Reset the model's identity (Chinese)",
      "chat-marker": "Forged chat markers",
      "fake-system": "Disguised system text",
      "curl-pipe-sh": "Download and run",
      "base64-decode-exec": "Decode and run",
      "exfil-env": "Send out environment variables",
      "exfil-credentials": "Send out a credential file",
      "exfil-credentials-reversed": "Send out a credential file (verb first)",
      "ssh-key-read": "Read a private key or cloud credential",
      "write-startup-item": "Write a startup item",
      "crontab-install": "Install a scheduled job",
      "rm-rf-root": "Delete home or root",
      "chmod-777": "World-writable permissions",
    },
    matcher: {
      prefix: (code: Code, prefix: string, n: number) => (
        <>
          Starts with {code(prefix)}, followed by at least {n} characters
        </>
      ),
      openaiLegacy: (code: Code, n: number) => (
        <>
          Starts with {code("sk-")}, at least {n} characters, with both letters and digits
        </>
      ),
      pem: (code: Code) => <>From {code("-----BEGIN … PRIVATE KEY-----")} to its END, as a whole</>,
      jwt: (code: Code) => <>Three base64url parts; the first decodes to text containing {code('"alg"')}</>,
      connString: (code: Code) => <>Only the password in {code("scheme://user:password@host")}</>,
      privateIp: (code: Code) => (
        <>
          Addresses starting with {code("10.")}, {code("172.16–31.")} or {code("192.168.")}; not
          127.0.0.1
        </>
      ),
      domainSuffix: (code: Code, suffixes: string[]) => (
        <>Domains ending in {or(suffixes.map(code), ", ", " or ")}</>
      ),
      regex: (code: Code, pattern: string) => <>Regex {code(pattern)}</>,
      contains: (code: Code, text: string) => <>Contains {code(text)}, ignoring case</>,
      codepoints: (code: Code, ranges: string[]) => <>Code points {or(ranges.map(code), ", ", " and ")}</>,
    },
  },
);
