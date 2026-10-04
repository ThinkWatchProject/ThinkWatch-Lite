import type { ReactNode } from "react";
import { messages } from "@/i18n";
// 规则名、防护名和 core 消息的中文是同一张表（Rust 写系统通知时也读它）
import CORE_ZH from "@/i18n/core.zh.json";

/** 句子里要按代码样式画的那一段。怎么画由组件决定，这里只管是哪几个字 */
type Code = (text: string) => ReactNode;

/** 卡组织在中文里的名字。只有银联有通行的中文名，别家照写英文 */
const CARD_NETWORK_ZH: Record<string, string> = { UnionPay: "银联" };

const or = (xs: ReactNode[], sep: ReactNode, last: ReactNode) =>
  xs.flatMap((x, i) => (i === 0 ? [x] : [i === xs.length - 1 ? last : sep, x]));

/**
 * 各项防护共用的名称：档位、处置、类别、规则名，以及内置规则的匹配判据。
 *
 * **规则名只收内置的。**自定义规则的名字就是用户起的，原样显示；表里没有
 * 的，退回 core 给的英文名或 id。
 *
 * **第三档按各项做的事命名**（替换、切断、处置），前两档各项一样。
 */
export const securityLabelsText = messages(
  {
    guards: CORE_ZH.tables.guard,
    /** 日志「类型」一栏，短一点 */
    guardShort: {
      redact: "出站脱敏",
      inspect_tools: "工具调用",
      content: "内容过滤",
    },
    /** 前两档，各项一样 */
    modes: {
      off: "关闭",
      observe: "观察",
    },
    /** 第三档，按这一项做的事命名：命中的换成占位符、调用切断、规则各自拒绝或删除 */
    enforce: {
      redact: "替换",
      inspect_tools: "切断",
      content: "处置",
    },
    /** 日志里每一条做了什么 */
    actions: {
      recorded: "仅记录",
      replaced: "已替换",
      cut: "已切断",
      stripped: "已删除",
      blocked: "已拒绝",
    } as Record<string, string>,
    /** 工具调用规则、内容规则在第三档下做什么 */
    ruleActions: {
      cut: "切断",
      block: "拒绝",
      strip: "删除",
      record: "仅记录",
    } as Record<string, string>,
    kinds: {
      "api-keys": "API 密钥",
      "private-keys": "私钥",
      jwt: "JWT",
      "conn-strings": "连接串",
      personal: "个人信息",
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
    /** 日志按天分组时，一天的标题 */
    day: {
      today: "今天",
      yesterday: "昨天",
    },
    /** 日志一条的第二行 */
    detail: {
      /** 出站脱敏：同一个值在一个请求里出现了几次；内容过滤：这条规则命中了几处 */
      times: (n: number) => `出现 ${n} 次`,
      /** 码位规则命中标签字符时，解出来的原文 */
      revealed: (text: string) => `隐藏内容「${text}」`,
      /** 码位规则：命中了几个字符 */
      chars: (n: number) => `共 ${n.toLocaleString()} 个字符`,
    },
    /** 内容过滤的内置规则 */
    contentRules: CORE_ZH.tables.content_rule as Record<string, string>,
    /**
     * 内置扫描规则的名字。工具调用审查用其中的危险命令一组；MCP 页的扫描
     * 发现两组都用（提示注入那一组只查客户端配置，不查工具调用）。
     */
    rules: CORE_ZH.tables.scan_rule as Record<string, string>,
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
      cnResidentId: (bornSince: number) => (
        <>18 位居民身份证号：地区码、{bornSince} 年以来的出生日期和校验码都对得上</>
      ),
      /** 卡组织的名字按英文名查，查不到的照写 */
      bankCard: (networks: string[]) => (
        <>{or(networks.map((n) => CARD_NETWORK_ZH[n] ?? n), "、", "、")} 的卡号：号段、位数对得上并通过 Luhn 校验；公开的测试卡号除外</>
      ),
      email: (code: Code) => <>邮箱地址：{code("名称@域名")}</>,
      /** 代码里做的检查（`builtin`），按检查名说它查什么 */
      builtin: {
        "credential-to-network": "凭据发往本机和该凭据的服务商以外的主机",
        "file-to-network": "本地文件的内容上传到外部主机",
        "thinkwatch-data": "路径或命令指向 ThinkWatch 的数据目录；只是提到不算",
      } as Record<string, string>,
      /** 没见过的检查名 */
      builtinOther: "由内置检查判断",
      cnMobilePhone: (code: Code) => (
        <>
          中国大陆手机号：{code("1")} 开头的 11 位数字，第二位为 3 到 9，前后不紧挨其他数字
        </>
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
      content: "Content filter",
    },
    guardShort: {
      redact: "Redaction",
      inspect_tools: "Tool call",
      content: "Content",
    },
    modes: {
      off: "Off",
      observe: "Observe",
    },
    enforce: {
      redact: "Replace",
      inspect_tools: "Cut off",
      content: "Enforce",
    },
    actions: {
      recorded: "Recorded",
      replaced: "Replaced",
      cut: "Cut off",
      stripped: "Deleted",
      blocked: "Refused",
    },
    ruleActions: {
      cut: "Cut off",
      block: "Refuse",
      strip: "Delete",
      record: "Record only",
    },
    kinds: {
      "api-keys": "API keys",
      "private-keys": "Private keys",
      jwt: "JWTs",
      "conn-strings": "Connection strings",
      personal: "Personal information",
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
    day: {
      today: "Today",
      yesterday: "Yesterday",
    },
    detail: {
      times: (n: number) => `${n} times`,
      revealed: (text: string) => `hidden text “${text}”`,
      chars: (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString()} characters`),
    },
    contentRules: {
      "unicode-tags": "Unicode tag characters",
      "bidi-controls": "Bidirectional controls",
      "zero-width": "Zero-width characters",
      "private-use": "Private-use characters",
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
      "secret-to-unknown-host": "Send a credential to an unknown host",
      "thinkwatch-data": "Read or change ThinkWatch's own data",
      "upload-file-to-host": "Upload a local file to an external host",
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
      cnResidentId: (bornSince: number) => (
        <>An 18-character resident ID number whose region code, birth date since {bornSince} and check character all check out</>
      ),
      bankCard: (networks: string[]) => (
        <>A {or(networks, ", ", " or ")} card number whose prefix and length match and that passes the Luhn check; public test card numbers excepted</>
      ),
      email: (code: Code) => <>Email addresses: {code("name@domain")}</>,
      builtin: {
        "credential-to-network": "A credential sent to a host other than this machine and the credential's provider",
        "file-to-network": "The contents of a local file uploaded to an external host",
        "thinkwatch-data": "A path or command that points into ThinkWatch's data directory; a mention does not count",
      },
      builtinOther: "Decided by a built-in check",
      cnMobilePhone: (code: Code) => (
        <>
          Chinese mainland mobile numbers: 11 digits starting with {code("1")}, the second 3 to 9, not run together with other digits
        </>
      ),
      regex: (code: Code, pattern: string) => <>Regex {code(pattern)}</>,
      contains: (code: Code, text: string) => <>Contains {code(text)}, ignoring case</>,
      codepoints: (code: Code, ranges: string[]) => <>Code points {or(ranges.map(code), ", ", " and ")}</>,
    },
  },
);
