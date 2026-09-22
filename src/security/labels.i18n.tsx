import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子里要按代码样式画的那一段。怎么画由组件决定，这里只管是哪几个字 */
type Code = (text: string) => ReactNode;

const or = (xs: ReactNode[], sep: ReactNode, last: ReactNode) =>
  xs.flatMap((x, i) => (i === 0 ? [x] : [i === xs.length - 1 ? last : sep, x]));

/**
 * 两项防护共用的名称：档位、处置、类别、规则名，以及内置规则的匹配判据。
 *
 * **规则名只收内置的。**自定义规则的名字就是用户起的，原样显示；表里没有
 * 的，退回 core 给的英文名或 id。
 */
export const securityLabelsText = messages(
  {
    guards: {
      redact: "出站脱敏",
      inspect_tools: "工具调用审查",
    },
    /** 日志「类型」一栏，短一点 */
    guardShort: {
      redact: "出站脱敏",
      inspect_tools: "工具调用",
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
    } as Record<string, string>,
    /** 工具调用规则在拦截档下做什么 */
    ruleActions: {
      cut: "切断",
      record: "仅记录",
    } as Record<string, string>,
    kinds: {
      "api-keys": "API 密钥",
      "private-keys": "私钥",
      jwt: "JWT",
      "conn-strings": "连接串",
      internal: "内网地址",
      command: "内置",
      custom: "自定义",
    } as Record<string, string>,
    custom: "自定义",
    builtin: "内置",
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
    },
  },
  {
    guards: {
      redact: "Outbound redaction",
      inspect_tools: "Tool-call inspection",
    },
    guardShort: {
      redact: "Redaction",
      inspect_tools: "Tool call",
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
    },
    ruleActions: {
      cut: "Cut off",
      record: "Record only",
    },
    kinds: {
      "api-keys": "API keys",
      "private-keys": "Private keys",
      jwt: "JWTs",
      "conn-strings": "Connection strings",
      internal: "Internal addresses",
      command: "Built-in",
      custom: "Custom",
    },
    custom: "Custom",
    builtin: "Built-in",
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
    },
  },
);
