import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子中间要加重的那几个字。怎么画由组件决定，这里只管是哪几个字、在句子的哪儿 */
type Em = (text: string) => ReactNode;

const rules = (n: number) => (n === 1 ? "rule" : "rules");

export const guardText = messages(
  {
    off: "关闭",
    observe: "观察",
    enforce: "拦截",

    redact: {
      title: "出站脱敏",
      what: "请求发送前，检查其中是否含有密钥、私钥或连接串。",
      verb: "将检出的内容替换为占位符后发送，并在响应中还原为原值",
      cost: "请求体将被改写，相同上下文可能无法命中上游缓存。",
    },
    inspectTools: {
      title: "工具调用审查",
      what: "检查上游返回的工具调用中是否含有可直接获得执行权限的命令。",
      verb: "切断响应流，客户端收到的工具调用不完整，无法构成有效参数",
      cost: "仅对不受信任的上游生效。发生误判时，回答将在中途中断。",
    },
    scanConfigs: {
      title: "配置面扫描",
      what: "检查客户端配置文件中是否含有隐藏字符、注入内容、危险命令或过宽权限。",
      verb: "在界面中发出告警",
      cost: "扫描不会删除任何内容，「拦截」仅在界面中发出告警。",
    },

    noVersion: "配置版本尚未读取，请稍后重试",
    intro: "三项防护各有三档，默认均为「观察」。",
    observeMeaning: "「观察」的含义",
    observeTip: "「观察」照常检测并记录，但不改变任何请求。可根据记录结果决定是否切换到「拦截」。",
    oldCore: "core 版本较旧，未提供防护状态。升级后可使用此页面。",
    nowOff: "当前：不检测，不记录。",
    nowObserve: (em: Em) => <>当前：检测并记录，{em("不改变任何请求")}。检测结果显示在「安全 › 发现」中。</>,
    nowEnforce: (verb: string) => `当前：${verb}。`,
    ifEnforced: (cost: string) => `切换到「拦截」后：${cost}`,

    rules: "扫描规则",
    rulesMadeOf: "扫描规则由内置规则与自定义规则组成。",
    rulesAppended: (em: Em) => <>自定义规则{em("追加")}在内置规则之后，不替换内置规则，新版本增加的内置规则同样生效。</>,
    rulesCount: (added: number, disabled: number) =>
      `已添加 ${added} 条自定义规则，停用 ${disabled} 条内置规则。增删规则需编辑 config.yaml。`,

    scope: "按上游配置脱敏范围",
    scopeNote: (em: Em) => <>「出站脱敏」决定是否脱敏，此处列出{em("各上游的脱敏类别")}。官方端点默认不脱敏。</>,
    howToChange: "修改方式",
    howToChangeTip: "在「上游」中编辑该上游，于「安全」一节设置发送前脱敏。",
    upstream: "上游",
    trust: "信任",
    categories: "脱敏类别",
    official: "官方端点",
    unofficial: "非官方端点",
    autoDetected: "（自动识别）",
    noRedactSet: "已设置为不脱敏",
    noRedactOfficial: "不脱敏（官方端点）",
  },
  {
    off: "Off",
    observe: "Observe",
    enforce: "Enforce",

    redact: {
      title: "Outbound redaction",
      what: "Checks each request for API keys, private keys and connection strings before it is sent.",
      verb: "replaces detected values with placeholders before sending and restores the original values in the response",
      cost: "Request bodies are rewritten, so identical context may no longer hit the upstream cache.",
    },
    inspectTools: {
      title: "Tool-call inspection",
      what: "Checks tool calls returned by upstreams for commands that would gain execution rights directly.",
      verb: "cuts off the response stream, so the client receives an incomplete tool call that cannot form valid arguments",
      cost: "Applies only to untrusted upstreams. On a false positive, the answer stops midway.",
    },
    scanConfigs: {
      title: "Config scan",
      what: "Checks client configuration files for hidden characters, injected content, dangerous commands and overly broad permissions.",
      verb: "shows an alert in the app",
      cost: "Scanning never deletes anything; Enforce only shows an alert in the app.",
    },

    noVersion: "The config version has not been read yet. Try again shortly.",
    intro: "Each of the three defenses has three modes; all default to Observe.",
    observeMeaning: "What Observe means",
    observeTip:
      "Observe detects and records as usual but does not change any request. The records help decide whether to switch to Enforce.",
    oldCore: "This core version is too old to report protection status. The page is available after upgrading.",
    nowOff: "Currently: nothing is detected or recorded.",
    nowObserve: (em: Em) => (
      <>Currently: detects and records {em("without changing any request")}. Results appear under Security › Findings.</>
    ),
    nowEnforce: (verb: string) => `Currently: ${verb}.`,
    ifEnforced: (cost: string) => `After switching to Enforce: ${cost}`,

    rules: "Scan rules",
    // 后面紧跟下一句，句号之后要自带空格
    rulesMadeOf: "Scan rules consist of built-in rules and custom rules. ",
    rulesAppended: (em: Em) => (
      <>Custom rules are {em("appended")} to the built-in rules and do not replace them; built-in rules added in new versions also apply.</>
    ),
    rulesCount: (added: number, disabled: number) =>
      `${added} custom ${rules(added)} added, ${disabled} built-in ${rules(disabled)} disabled. Adding or removing rules requires editing config.yaml.`,

    scope: "Redaction per upstream",
    scopeNote: (em: Em) => (
      <>Outbound redaction decides whether anything is redacted; this table lists {em("the categories redacted for each upstream")}. Official endpoints are not redacted by default.</>
    ),
    howToChange: "How to change",
    howToChangeTip: "Edit the upstream in Upstreams and set redaction in its Security section.",
    upstream: "Upstream",
    trust: "Trust",
    categories: "Redacted categories",
    official: "Official endpoint",
    unofficial: "Unofficial endpoint",
    autoDetected: "(auto-detected)",
    noRedactSet: "Set to no redaction",
    noRedactOfficial: "Not redacted (official endpoint)",
  },
);
