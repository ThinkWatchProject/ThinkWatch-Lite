import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isLinux, isWindows } from "@/platform";

/** 英文的单复数：`count(3, "client", "clients")` 是 `3 clients` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 客户端页的文案。
 *
 * `.tsx`：几句话中间嵌着路径（`<code>`），片段由组件画好传进来。
 */
export const clientsText = messages(
  {
    restoreAll: "全部还原…",
    loadFailed: "无法读取本机的客户端",
    noneTitle: "未检测到可接管的客户端",
    noneHint: "已安装的客户端运行一次、生成配置文件后会出现在这里；也可以按下方的配置方法手动接入。",
    manualTitle: "需要手动配置",
    manualIntro: "以下客户端无法自动接管，按步骤填入网关地址和密钥即可。",
    absentTitle: "未检测到",
    absentIntro: "配置文件不在默认位置时，可以按配置方法手动接入。",

    // 页头的摘要
    noneConnected: "尚未接管客户端",
    nDetected: (_n: number, n: ReactNode) => <>检测到 {n} 个</>,
    nInUse: "使用中",
    nWaiting: "等待首个请求",
    nBroken: "未生效",
    nIdle: "未接管",

    // 表头
    client: "客户端",
    status: "状态",
    key: "密钥",
    last24h: "24 小时",
    actions: "操作",

    // 状态
    inUse: "使用中",
    waiting: "等待首个请求",
    broken: "未生效",
    idle: "未接管",
    absent: "未检测到",
    notSet: "未配置",
    moved: (host: string) => `配置中的地址已改为 ${host}`,
    pointsAtLocal: (host: string) => `指向本机网关 ${host}`,
    shadowed: (file: string) => `被 ${file} 覆盖`,
    silent: "接管五分钟仍无请求",
    restart: "重新启动后生效",
    pointsTo: (host: string) => `当前指向 ${host}`,
    ownService: "使用自带的服务",
    seeWhy: "查看原因",

    // 操作
    adopt: "接管…",
    restore: "还原…",
    manual: "配置方法…",
    details: "详情…",
    reveal: isWindows
      ? "在文件资源管理器中显示配置文件"
      : isLinux
        ? "在文件管理器中显示配置文件"
        : "在访达中显示配置文件",
    traffic: "查看流量",
    actionsFor: (name: string) => `${name} 的操作`,
    restoredAll: (n: number) => `已还原 ${n} 个客户端`,
    restoreFailed: (failures: { client: string; detail: string }[]) =>
      `${failures.length} 个客户端还原失败：` + failures.map((r) => `${r.client}（${r.detail}）`).join("；"),

    // 详情
    file: "配置文件",
    realFile: (path: string) => `实际文件：${path}`,
    revealShort: isWindows ? "在资源管理器中显示" : isLinux ? "在文件管理器中显示" : "在访达中显示",
    endpoint: "地址",
    pointsHere: "指向本网关",
    notHere: "未指向本网关",
    noEndpoint: "未设置，使用自带的服务",
    keyOnAdopt: "接管时生成",
    effect: "生效",
    usage: "24 小时",
    usageLine: (n: number, at: string) => `${n.toLocaleString()} 次请求 · 最近一次 ${at}`,
    lastSeenLine: (at: string) => `最近一次 ${at}`,
    noUsage: "尚无请求",
    costs: "接管的影响",
    check: "配置链检查",
    recheck: "重新检查",
    checkFailed: "配置链检查未能完成",

    // 接管、还原的确认
    adoptTitle: (name: string) => `接管 ${name}`,
    restoreTitle: (name: string) => `还原 ${name}`,
    modifies: (path: ReactNode) => <>将修改 {path}，写入前完整备份原文件。</>,
    creates: (path: ReactNode) => <>将新建 {path}。</>,
    noop: "配置已是目标状态，无需修改。",
    field: "字段",
    written: "写入",
    change: "改动",
    newKey: (name: string) => `新密钥「${name}」`,
    keyNamed: (name: string) => `密钥「${name}」`,
    remove: "删除",
    restoreTo: (v: string) => `恢复为 ${v}`,
    notes: "说明",
    keepsKey: (name: string) => `密钥「${name}」保留，再次接管时直接使用。`,
    diff: "完整改动",
    secretMasked: "改动中的密钥已遮盖，写入的是配置中的密钥原文。",
    confirmAdopt: "接管",
    confirmRestore: "还原",

    // 手动配置
    manualDialogTitle: (name: string) => `配置 ${name}`,
    keyGoesBelow: "密钥（见下方）",
    endpointLabel: "网关地址",
    keyLabel: "密钥",
    newKeyFor: (name: string) => `为 ${name} 新建专用密钥`,
    createAndCopy: "创建并复制",
    done: "完成",

    // 全部还原
    restoreAllTitle: "还原全部客户端",
    restoreAllBody: (n: number) =>
      `以下 ${n} 个客户端将还原到接管之前的配置，之后它们的请求不再经过网关。`,
    keysKept: "各自的密钥保留，再次接管时直接使用。",
    confirmRestoreAll: "全部还原",
  },
  {
    restoreAll: "Restore all…",
    loadFailed: "Could not read the clients on this computer",
    noneTitle: "No client to connect was found",
    noneHint:
      "An installed client appears here once it has been run and has created its configuration file. Each one can also be set up by hand below.",
    manualTitle: "Set up by hand",
    manualIntro:
      "These clients cannot be connected automatically; follow the steps to enter the gateway address and key.",
    absentTitle: "Not detected",
    absentIntro: "When the configuration file is not in its default location, the client can be set up by hand.",

    noneConnected: "No client connected yet",
    nDetected: (count: number, n: ReactNode) => <>{n} {count === 1 ? "client" : "clients"} detected</>,
    nInUse: "in use",
    nWaiting: "waiting for first request",
    nBroken: "not in effect",
    nIdle: "not connected",

    client: "Client",
    status: "Status",
    key: "Key",
    last24h: "Last 24 hours",
    actions: "Actions",

    inUse: "In use",
    waiting: "Waiting for first request",
    broken: "Not in effect",
    idle: "Not connected",
    absent: "Not detected",
    notSet: "Not set up",
    moved: (host: string) => `The address in its configuration is now ${host}`,
    pointsAtLocal: (host: string) => `Points to the local gateway ${host}`,
    shadowed: (file: string) => `Overridden by ${file}`,
    silent: "No request five minutes after connecting",
    restart: "Takes effect after a restart",
    pointsTo: (host: string) => `Points to ${host}`,
    ownService: "Uses its own service",
    seeWhy: "See why",

    adopt: "Connect…",
    restore: "Restore…",
    manual: "Set up…",
    details: "Details…",
    reveal: isWindows
      ? "Show configuration file in File Explorer"
      : isLinux
        ? "Show configuration file in the file manager"
        : "Show configuration file in Finder",
    traffic: "Show traffic",
    actionsFor: (name: string) => `Actions for ${name}`,
    restoredAll: (n: number) => `${count(n, "client", "clients")} restored`,
    restoreFailed: (failures: { client: string; detail: string }[]) =>
      `${count(failures.length, "client", "clients")} could not be restored: ` +
      failures.map((r) => `${r.client} (${r.detail})`).join("; "),

    file: "Configuration",
    realFile: (path: string) => `Actual file: ${path}`,
    revealShort: isWindows ? "Show in File Explorer" : isLinux ? "Show in file manager" : "Show in Finder",
    endpoint: "Address",
    pointsHere: "Points to this gateway",
    notHere: "Does not point to this gateway",
    noEndpoint: "Not set; uses its own service",
    keyOnAdopt: "Generated when connecting",
    effect: "Takes effect",
    usage: "Last 24 hours",
    usageLine: (n: number, at: string) =>
      `${n === 1 ? "1 request" : `${n.toLocaleString()} requests`} · last at ${at}`,
    lastSeenLine: (at: string) => `Last at ${at}`,
    noUsage: "No requests yet",
    costs: "What changes",
    check: "Configuration check",
    recheck: "Check again",
    checkFailed: "The configuration check could not finish",

    adoptTitle: (name: string) => `Connect ${name}`,
    restoreTitle: (name: string) => `Restore ${name}`,
    modifies: (path: ReactNode) => <>{path} will be changed; the original is backed up in full first.</>,
    creates: (path: ReactNode) => <>{path} will be created.</>,
    noop: "The configuration is already as it should be; nothing to change.",
    field: "Field",
    written: "Value",
    change: "Change",
    newKey: (name: string) => `New key “${name}”`,
    keyNamed: (name: string) => `Key “${name}”`,
    remove: "Removed",
    restoreTo: (v: string) => `Back to ${v}`,
    notes: "Notes",
    keepsKey: (name: string) => `Key “${name}” is kept and used again on the next connection.`,
    diff: "Full change",
    secretMasked: "Keys are masked in the change; the key from the configuration is what gets written.",
    confirmAdopt: "Connect",
    confirmRestore: "Restore",

    manualDialogTitle: (name: string) => `Set up ${name}`,
    keyGoesBelow: "The key (below)",
    endpointLabel: "Gateway address",
    keyLabel: "Key",
    newKeyFor: (name: string) => `A new key for ${name}`,
    createAndCopy: "Create and copy",
    done: "Done",

    restoreAllTitle: "Restore all clients",
    restoreAllBody: (n: number) =>
      `${count(n, "client", "clients")} will go back to the configuration from before connecting, and their requests will no longer pass through the gateway.`,
    keysKept: "Each keeps its key, which is used again on the next connection.",
    confirmRestoreAll: "Restore all",
  },
);
