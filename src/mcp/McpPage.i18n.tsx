import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子中间要加重的那几个字。怎么画由组件决定，这里只管是哪几个字、在句子的哪儿 */
type Em = (text: string) => ReactNode;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const mcpText = messages(
  {
    /** 和源列表里那一项同一个词 */
    title: "MCP",
    tabServers: "服务器",
    tabExtensions: "技能与钩子",
    tabFindings: "发现",
    rescan: "重新扫描",
    loadFailed: "扫描失败",

    // 页头
    /** 各级发现几项：「1 项高风险」 */
    levelCount: { high: "项高风险", medium: "项中风险", low: "项低风险" } as Record<string, string>,
    clean: "未发现问题",
    unreadableCount: "个文件无法读取",
    scannedAt: (files: number, time: string) => `已扫描 ${files} 个文件 · ${time}`,
    newDot: "有新发现",

    // 服务器
    server: "服务器",
    noMcp: "未配置 MCP 服务器",
    noMcpHint: "在客户端中添加 MCP 服务器后，各客户端的配置将并列在此。",
    enabled: "已启用",
    disabled: "已停用",
    none: "未配置",
    legendNote: "点击格子复制或移除，写入前显示改动。",
    cannotWrite: "此客户端不支持写入",
    removeFrom: (client: string) => `从 ${client} 移除`,
    copyFrom: (from: string, to: string) => `从 ${from} 复制到 ${to}`,
    copyTo: (to: string) => `复制到 ${to}`,
    noSource: "没有可复制的来源",
    disabledTip: "配置中为 enabled: false，列出但不会被加载",
    differs: "配置不一致",
    differsTip: "同名服务器在各客户端中的配置不同，点击并排查看",
    readsEnv: (keys: string[]) => `读取 ${keys.join("、")}`,
    remote: "远程",
    thirdParty: "第三方",
    thirdPartyTip: "上下文将发送至该地址",
    cellLabel: (server: string, client: string, state: string) => `${server} · ${client}：${state}`,
    viewConfig: "查看配置",
    actionsFor: (name: string) => `${name} 的操作`,

    // 一个服务器在各客户端中的配置
    configuredIn: (n: number) => `已在 ${n} 个客户端中配置。`,
    compareDesc: "各客户端中的配置不一致，不一致的字段已标出。",
    env: "环境变量",
    noEnv: "（无）",
    file: "配置文件",
    unify: "如需统一：在矩阵中选择要保留的配置，复制到其他客户端。写入前将显示改动。",

    // 写入前的确认
    copyTitle: (name: string, to: string) => `将 ${name} 复制到 ${to}`,
    removeTitle: (name: string, from: string) => `从 ${from} 移除 ${name}`,
    modifies: "将修改",
    noop: "配置已是目标状态，无需修改。",
    backup: "写入前将完整备份原文件，除此项外不做任何改动。",
    envCopied: "env 中可能含有密钥，将一并复制。",
    applyFailed: "未能写入",

    // 技能与钩子
    hooks: "钩子",
    hooksNote: "钩子在工具调用前后直接执行命令，无需模型参与即可获得执行权限。",
    skills: "技能",
    skillsNote: "仅列出，不支持跨客户端复制：技能的跨客户端格式尚无通行标准。",
    client: "客户端",
    event: "事件",
    command: "命令",
    name: "名称",
    allowedTools: "允许的工具",
    level: "级别",
    noHooks: "未配置钩子",
    noSkills: "未安装技能",
    listSep: "、",
    copyCommand: "复制命令",
    copyPath: "复制路径",
    viewFinding: "查看发现",

    // 发现
    newFindings: (n: number, em: Em) => <>{em(`${n} 项新发现`)}，此前扫描时不存在。</>,
    markRead: "标为已读",
    scope: "扫描范围：客户端配置、技能、钩子、斜杠命令、subagent 与项目指令。",
    unreadable: (n: number) => `${n} 个文件无法读取，本次未扫描`,
    finding: "发现",
    levels: { high: "高", medium: "中", low: "低" } as Record<string, string>,
    isNew: "新",
    noIssues: "未发现问题",
    checked: "已检查隐藏字符、提示注入、危险命令与过宽权限四类问题。",
    reportOnly: "仅报告，不修改任何文件。请打开上述路径查看后再做处理。",
    viewDetail: "查看详情",
  },
  {
    title: "MCP",
    tabServers: "Servers",
    tabExtensions: "Skills and hooks",
    tabFindings: "Findings",
    rescan: "Rescan",
    loadFailed: "The scan failed",

    levelCount: { high: "high", medium: "medium", low: "low" },
    clean: "No issues found",
    unreadableCount: "unreadable",
    scannedAt: (files: number, time: string) => `${plural(files, "file", "files")} scanned · ${time}`,
    newDot: "New findings",

    server: "Server",
    noMcp: "No MCP servers",
    noMcpHint: "Once MCP servers are added in a client, each client's configuration is listed here side by side.",
    enabled: "Enabled",
    disabled: "Disabled",
    none: "Not configured",
    legendNote: "Click a cell to copy or remove; the change is shown before anything is written.",
    cannotWrite: "Writing to this client is not supported",
    removeFrom: (client: string) => `Remove from ${client}`,
    copyFrom: (from: string, to: string) => `Copy from ${from} to ${to}`,
    copyTo: (to: string) => `Copy to ${to}`,
    noSource: "No source to copy from",
    disabledTip: "Set to enabled: false in the config; listed but not loaded",
    differs: "Differs",
    differsTip: "This server is configured differently across clients. Click to compare them side by side.",
    readsEnv: (keys: string[]) => `Reads ${keys.join(", ")}`,
    remote: "Remote",
    thirdParty: "Third party",
    thirdPartyTip: "Context is sent to this address",
    cellLabel: (server: string, client: string, state: string) => `${server} · ${client}: ${state}`,
    viewConfig: "View configuration",
    actionsFor: (name: string) => `Actions for ${name}`,

    configuredIn: (n: number) => `Configured in ${plural(n, "client", "clients")}.`,
    compareDesc: "The configuration differs across clients; the fields that differ are highlighted.",
    env: "Environment variables",
    noEnv: "(none)",
    file: "Configuration file",
    unify:
      "To make them consistent, choose the configuration to keep in the matrix and copy it to the other clients. The change is shown before anything is written.",

    copyTitle: (name: string, to: string) => `Copy ${name} to ${to}`,
    removeTitle: (name: string, from: string) => `Remove ${name} from ${from}`,
    modifies: "Modifies",
    noop: "The configuration is already in the target state; nothing needs to change.",
    // 后面可能紧跟一句提醒，句号之后要自带空格
    backup: "The original file is backed up in full before writing, and nothing else is changed. ",
    envCopied: "The env field may contain secrets and is copied as well.",
    applyFailed: "Not written",

    hooks: "Hooks",
    hooksNote: "Hooks run commands directly before and after tool calls, gaining execution rights without involving the model.",
    skills: "Skills",
    skillsNote: "Listed only. Copying between clients is not supported: there is no common format for skills across clients yet.",
    client: "Client",
    event: "Event",
    command: "Command",
    name: "Name",
    allowedTools: "Allowed tools",
    level: "Level",
    noHooks: "No hooks",
    noSkills: "No skills",
    listSep: ", ",
    copyCommand: "Copy command",
    copyPath: "Copy path",
    viewFinding: "View finding",

    newFindings: (n: number, em: Em) => (
      <>
        {em(n === 1 ? "1 new finding" : `${n} new findings`)} that did not exist at the previous scan.
      </>
    ),
    markRead: "Mark as read",
    scope: "Scanned: client configuration, skills, hooks, slash commands, subagents and project instructions.",
    unreadable: (n: number) =>
      n === 1 ? "1 file could not be read and was not scanned" : `${n} files could not be read and were not scanned`,
    finding: "Finding",
    levels: { high: "High", medium: "Medium", low: "Low" },
    isNew: "New",
    noIssues: "No issues found",
    checked: "Checked for hidden characters, prompt injection, dangerous commands and overly broad permissions.",
    reportOnly: "Report only; no file is changed. Open the path above to review it before taking action.",
    viewDetail: "View details",
  },
);
