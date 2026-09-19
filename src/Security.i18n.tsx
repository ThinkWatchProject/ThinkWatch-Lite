import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子中间要加重的那几个字。怎么画由组件决定，这里只管是哪几个字、在句子的哪儿 */
type Em = (text: string) => ReactNode;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const securityText = messages(
  {
    scanning: "扫描中…",
    scanned: (files: number, rules: string) => `已扫描 ${files} 个文件，${rules}。`,
    rescan: "重新扫描",
    unreadable: (paths: string[]) => `${paths.length} 个文件无法读取，本次未扫描：${paths.join("、")}`,
    newFindings: (n: number) => `新增发现 · ${n} 处`,
    markRead: "标记已读",
    newNote: (em: Em) => <>以下内容为配置文件中{em("新近出现")}的内容，并非原有内容。</>,
    findings: (n: number) => (n > 0 ? `发现 · ${n} 处` : "发现"),
    high: (n: number) => `（${n} 处高危）`,
    noIssues: "未发现问题",
    checked: "检查范围",
    checkedTip: "已检查隐藏字符、提示注入、危险命令与过宽权限四类问题。",
    hooks: (n: number) => `hook · ${n}`,
    hooksNote: "hook 在工具调用前后直接执行 shell 命令",
    hooksRisk: "风险说明",
    hooksRiskTip: "这是唯一无需模型参与即可获得执行权限的入口，其余途径均需先促使模型调用工具。",
    skills: (n: number) => `skill · ${n}`,
    skillsNote: "仅列出，不支持跨客户端复制",
    skillsWhy: "说明",
    skillsWhyTip: "skill 的跨客户端格式尚无通行标准，复制到其他客户端后通常无法被识别。",
    tools: (names: string[]) => `工具：${names.join("、")}`,

    // MCP 矩阵
    cannotWrite: "此客户端不支持写入",
    mcp: "MCP server",
    mcpCount: (n: number) => `MCP server · ${n}`,
    noMcp: "本机未配置任何 MCP server。",
    mcpNote: "每个 MCP server 均可执行程序或读取上下文。",
    mcpEdit: "点击格子可修改",
    mcpEditTip: "点击空白格可从已配置该 server 的客户端复制，点击已配置的格可从该客户端移除。写入前均会显示差异。",
    name: "名称",
    config: "配置",
    conflictTip: "同名 server 在各客户端中的配置不同，点击可并排查看差异",
    removeFrom: (client: string) => `从 ${client} 移除`,
    copyFrom: (client: string) => `从 ${client} 复制`,
    noSource: "没有可复制的来源",
    disabledTip: "配置中为 enabled: false，列出但不会被加载",
    ofClient: (client: string) => `${client}：`,
    readsEnv: (keys: string[]) => `读取环境变量：${keys.join("、")}`,
    differs: "在各客户端中的配置不一致",
    hide: "收起",
    remote: "远端",
    env: "环境变量",
    noEnv: "（无）",
    enabled: "已启用",
    disabled: "已停用",
    unify: "如需统一：选择矩阵中要保留的配置，复制到其他客户端。写入前将显示差异。",

    // 写入 MCP 配置前的确认
    copyTitle: (name: string, to: string) => `将 ${name} 复制到 ${to}`,
    removeTitle: (name: string, from: string) => `从 ${from} 移除 ${name}`,
    modifies: "将修改",
    noop: "配置已是目标状态，无需修改。",
    backup: "写入前将完整备份原文件，除此项外不做任何改动。",
    envCopied: "env 中可能含有密钥，将一并复制。",

    // 上游行为基线
    behavior: "上游行为",
    unobserved: "观测层未启动，此期间的请求未被记录",
    cannotCompare: "无法对比",
    cannotCompareTip: "没有记录即无基线可供对比。此状态表示未进行检测，而非未发现异常。",
    period: (hours: number, days: number) => `最近 ${hours} 小时与此前 ${days} 天对比`,
    sampleRule: "样本要求",
    sampleRuleTip: "两个时段各需至少 20 条样本，样本不足的上游不在此列。",
    steady: "各上游的行为与此前一致",
    compared: (providers: string[]) => `（已对比：${providers.join("、")}）`,
    changed: (provider: string) => `${provider} 的行为发生变化`,
    metric: (label: string) => `${label}：`,
    before: (pct: string) => `，此前为 ${pct}`,
    samples: (recent: number, baseline: number) => `（样本 ${recent} / ${baseline}）`,
    inspected: (inspected: number, total: number) => `${total} 条请求中已检查 ${inspected} 条`,
    uninspected: "未检查的请求",
    uninspectedTip: "其余请求发生在工具调用审查关闭期间，这部分没有数据，并非检查结果为零。",

    // 一个 MCP server 的形态、一处发现的详情
    thirdParty: "上下文将发送至该地址",
    reportOnly: "仅报告，不修改任何文件。请打开上述路径查看后再做处理。",
  },
  {
    scanning: "Scanning…",
    scanned: (files: number, rules: string) => `Scanned ${plural(files, "file", "files")}. ${rules}.`,
    rescan: "Rescan",
    unreadable: (paths: string[]) =>
      paths.length === 1
        ? `1 file could not be read and was not scanned: ${paths.join(", ")}`
        : `${paths.length} files could not be read and were not scanned: ${paths.join(", ")}`,
    newFindings: (n: number) => `New findings · ${n}`,
    markRead: "Mark as read",
    newNote: (em: Em) => (
      <>The following content {em("appeared recently")} in configuration files and was not there before.</>
    ),
    findings: (n: number) => (n > 0 ? `Findings · ${n}` : "Findings"),
    high: (n: number) => `(${n} high-risk)`,
    noIssues: "No issues found",
    checked: "What is checked",
    checkedTip: "Checked for hidden characters, prompt injection, dangerous commands and overly broad permissions.",
    hooks: (n: number) => `Hooks · ${n}`,
    hooksNote: "Hooks run shell commands directly before and after tool calls",
    hooksRisk: "About the risk",
    hooksRiskTip:
      "This is the only way to gain execution rights without involving the model; every other path first has to get the model to call a tool.",
    skills: (n: number) => `Skills · ${n}`,
    skillsNote: "Listed only; copying between clients is not supported",
    skillsWhy: "Why",
    skillsWhyTip:
      "There is no common format for skills across clients yet; a skill copied to another client is usually not recognized.",
    tools: (names: string[]) => `Tools: ${names.join(", ")}`,

    cannotWrite: "Writing to this client is not supported",
    mcp: "MCP servers",
    mcpCount: (n: number) => `MCP servers · ${n}`,
    noMcp: "No MCP servers are configured on this machine.",
    // 后面紧跟一个没有左边距的提示，句号之后要自带空格
    mcpNote: "Every MCP server can run programs or read context. ",
    mcpEdit: "Click a cell to change",
    mcpEditTip:
      "Click an empty cell to copy the server from a client that has it; click a filled cell to remove it from that client. The diff is shown before anything is written.",
    name: "Name",
    config: "Configuration",
    conflictTip: "This server is configured differently across clients. Click to compare them side by side.",
    removeFrom: (client: string) => `Remove from ${client}`,
    copyFrom: (client: string) => `Copy from ${client}`,
    noSource: "No source to copy from",
    disabledTip: "Set to enabled: false in the config; listed but not loaded",
    ofClient: (client: string) => `${client}: `,
    readsEnv: (keys: string[]) => `Reads environment variables: ${keys.join(", ")}`,
    differs: "is configured differently across clients",
    hide: "Hide",
    remote: "Remote",
    env: "Environment variables",
    noEnv: "(none)",
    enabled: "Enabled",
    disabled: "Disabled",
    unify:
      "To make them consistent, choose the configuration to keep in the matrix and copy it to the other clients. The diff is shown before anything is written.",

    copyTitle: (name: string, to: string) => `Copy ${name} to ${to}`,
    removeTitle: (name: string, from: string) => `Remove ${name} from ${from}`,
    modifies: "Modifies",
    noop: "The configuration is already in the target state; nothing needs to change.",
    // 后面可能紧跟一句提醒，句号之后要自带空格
    backup: "The original file is backed up in full before writing, and nothing else is changed. ",
    envCopied: "The env field may contain secrets and is copied as well.",

    behavior: "Upstream behavior",
    unobserved: "The observation layer is not running; requests in this period were not recorded",
    cannotCompare: "Cannot compare",
    cannotCompareTip:
      "Without records there is no baseline to compare against. This means nothing was checked, not that nothing unusual was found.",
    period: (hours: number, days: number) =>
      `Last ${plural(hours, "hour", "hours")} compared with the previous ${plural(days, "day", "days")}`,
    sampleRule: "Minimum samples",
    sampleRuleTip: "Each period needs at least 20 samples; upstreams with fewer are not listed.",
    steady: "Every upstream behaves as before",
    compared: (providers: string[]) => `(compared: ${providers.join(", ")})`,
    changed: (provider: string) => `Behavior of ${provider} has changed`,
    metric: (label: string) => `${label}: `,
    before: (pct: string) => `, previously ${pct}`,
    samples: (recent: number, baseline: number) => ` (${recent} / ${baseline} samples)`,
    inspected: (inspected: number, total: number) =>
      `${inspected} of ${plural(total, "request", "requests")} inspected`,
    uninspected: "Uninspected requests",
    uninspectedTip:
      "The other requests were made while tool-call inspection was off. There is no data for them, which is not the same as a result of zero.",

    thirdParty: "Context is sent to this address",
    reportOnly: "Report only; no file is changed. Open the path above to review it before taking action.",
  },
);
