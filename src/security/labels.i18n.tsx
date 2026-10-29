import type { ReactNode } from "react";
import { messages } from "@/i18n";
// 防护名和 core 消息的中文是同一张表（Rust 写系统通知时也读它）
import CORE_ZH from "@/i18n/core.zh.json";
import type { SavedSourceKind } from "@/types";

/** 句子里要按代码样式画的那一段。怎么画由组件决定，这里只管是哪几个字 */
type Code = (text: string) => ReactNode;

const or = (xs: ReactNode[], sep: ReactNode, last: ReactNode) =>
  xs.flatMap((x, i) => (i === 0 ? [x] : [i === xs.length - 1 ? last : sep, x]));

/**
 * 各项防护共用的名称：状态、动作，以及没有 core 写的说明时规则判据的写法。
 *
 * **规则的名字、说明和分组名不在这里**：core 在规则表里给出中英文（见 `catalog.ts`）。
 *
 * **三种状态各项一样**：开启、监控、关闭（配置里是 `enforce` / `observe` / `off`）。
 */
export const securityLabelsText = messages(
  {
    guards: CORE_ZH.tables.guard,
    /** 日志「类型」一栏，短一点 */
    guardShort: {
      redact: "密钥与隐私",
      inspect_tools: "危险命令",
      content: "内容过滤",
    },
    /** 一项防护的三种状态，各项一样 */
    modes: {
      enforce: "开启",
      observe: "监控",
      off: "关闭",
    },
    /** 防护处于「监控」时，规则的动作后面那一句：实际只记录 */
    monitoring: "监控中",
    /** 日志里每一条做了什么 */
    actions: {
      recorded: "仅记录",
      replaced: "已替换",
      cut: "已切断",
      stripped: "已删除",
      blocked: "已拒绝",
    } as Record<string, string>,
    /** 规则在「开启」状态下做什么 */
    ruleActions: {
      placeholder: "替换为占位符",
      cut: "切断",
      block: "拒绝",
      strip: "删除",
      replace: "替换",
      record: "仅记录",
    } as Record<string, string>,
    custom: "自定义",
    /** 命中处在工具结果里（日志的 `tool` 是 `tool_result`） */
    toolResult: "工具结果",
    /** 命中的一处在请求（或回答）的哪一段。消息按第几条数，从 1 数 */
    parts: {
      system: "系统提示",
      message: (n: number) => `第 ${n} 条消息`,
      tool_result: "工具结果",
      tool_call: "工具调用",
      response_text: "回答 · 正文",
    },
    /** 消息的角色，按客户端写的查；表里没有的照写 */
    roles: {
      user: "用户",
      assistant: "助手",
      tool: "工具",
      system: "系统",
      developer: "开发者",
    } as Record<string, string>,
    /** 命中在请求里还是回答里 */
    directions: {
      request: "请求",
      response: "回答",
    },
    /** 内容规则怎么认（规则快照、导出） */
    matching: {
      contains: "包含",
      regex: "正则",
      codepoints: "码位",
    },
    caseSensitive: "区分大小写",
    /** 日志按天分组时，一天的标题 */
    day: {
      today: "今天",
      yesterday: "昨天",
    },
    /**
     * 「ThinkWatch 中保存的密钥」命中的是哪一处配置里的值。**只写是哪一处，不写值的任何部分**
     * （日志一条的第二行、流量页徽标的提示、导出）
     */
    savedSource: {
      "upstream-key": (name: string) => `上游「${name}」的密钥`,
      "upstream-header": (name: string) => `上游「${name}」请求头中的值`,
      "access-key": (name: string) => `网关密钥「${name}」`,
      "proxy-password": (name: string) => `代理「${name}」的密码`,
      "control-key": () => "远程控制密钥",
      "sync-credential": () => "同步与备份凭据",
    } as Record<SavedSourceKind, (name: string) => string>,
    /** 日志一条的第二行 */
    detail: {
      /** 出站脱敏：同一个值在一个请求里出现了几次；内容过滤：这条规则命中了几处 */
      times: (n: number) => `出现 ${n} 次`,
      /** 码位规则命中标签字符时，解出来的原文 */
      revealed: (text: string) => `隐藏内容「${text}」`,
      /** 码位规则：命中了几个字符 */
      chars: (n: number) => `共 ${n.toLocaleString()} 个字符`,
    },
    matcher: {
      /**
       * 危险命令里代码实现的检查（`builtin`），按检查名说它查什么。密钥与隐私的内置规则不在
       * 这里：它们的说明由 core 给（`about` / `about_zh`）
       */
      builtin: {
        "credential-to-network": "凭据发往本机和该凭据的服务商以外的主机",
        "file-to-network": "本地文件的内容上传到外部主机",
        "thinkwatch-data": "路径或命令指向 ThinkWatch 的数据目录；只是提到不算",
      } as Record<string, string>,
      /** 说明缺了时列出的几种写法之间 */
      listSep: "、",
      /** 没见过的检查名 */
      builtinOther: "由内置检查判断",
      // 正则一般区分大小写，不区分的才说；包含两种都说
      regex: (code: Code, pattern: string, cased: boolean) => (
        <>
          正则 {code(pattern)}
          {!cased && "，不区分大小写"}
        </>
      ),
      contains: (code: Code, text: string, cased: boolean) => (
        <>
          包含 {code(text)}，{cased ? "区分大小写" : "不区分大小写"}
        </>
      ),
      codepoints: (code: Code, ranges: string[]) => <>码位 {or(ranges.map(code), "、", "、")}</>,
    },
  },
  {
    guards: {
      redact: "Secrets & privacy",
      inspect_tools: "Dangerous commands",
      content: "Content filter",
    },
    guardShort: {
      redact: "Secrets",
      inspect_tools: "Commands",
      content: "Content",
    },
    modes: {
      enforce: "On",
      observe: "Monitor",
      off: "Off",
    },
    monitoring: "Monitoring",
    actions: {
      recorded: "Recorded",
      replaced: "Replaced",
      cut: "Cut off",
      stripped: "Deleted",
      blocked: "Refused",
    },
    ruleActions: {
      placeholder: "Replace with placeholder",
      cut: "Cut off",
      block: "Refuse",
      strip: "Delete",
      replace: "Replace",
      record: "Record only",
    },
    custom: "Custom",
    toolResult: "tool result",
    parts: {
      system: "System prompt",
      message: (n: number) => `Message ${n}`,
      tool_result: "Tool result",
      tool_call: "Tool call",
      response_text: "Answer · text",
    },
    roles: {
      user: "User",
      assistant: "Assistant",
      tool: "Tool",
      system: "System",
      developer: "Developer",
    },
    directions: {
      request: "Request",
      response: "Answer",
    },
    matching: {
      contains: "Contains",
      regex: "Regex",
      codepoints: "Code points",
    },
    caseSensitive: "Matching case",
    day: {
      today: "Today",
      yesterday: "Yesterday",
    },
    savedSource: {
      "upstream-key": (name: string) => `Key of upstream “${name}”`,
      "upstream-header": (name: string) => `Header value of upstream “${name}”`,
      "access-key": (name: string) => `Gateway key “${name}”`,
      "proxy-password": (name: string) => `Password of proxy “${name}”`,
      "control-key": () => "Remote control key",
      "sync-credential": () => "Sync and backup credential",
    },
    detail: {
      times: (n: number) => `${n} times`,
      revealed: (text: string) => `hidden text “${text}”`,
      chars: (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString()} characters`),
    },
    matcher: {
      builtin: {
        "credential-to-network": "A credential sent to a host other than this machine and the credential's provider",
        "file-to-network": "The contents of a local file uploaded to an external host",
        "thinkwatch-data": "A path or command that points into ThinkWatch's data directory; a mention does not count",
      },
      listSep: ", ",
      builtinOther: "Decided by a built-in check",
      regex: (code: Code, pattern: string, cased: boolean) => (
        <>
          Regex {code(pattern)}
          {!cased && ", ignoring case"}
        </>
      ),
      contains: (code: Code, text: string, cased: boolean) => (
        <>
          Contains {code(text)}, {cased ? "matching case" : "ignoring case"}
        </>
      ),
      codepoints: (code: Code, ranges: string[]) => <>Code points {or(ranges.map(code), ", ", " and ")}</>,
    },
  },
);
