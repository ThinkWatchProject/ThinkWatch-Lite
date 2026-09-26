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
    modelsStale: (name: string) => `${name} 的模型列表需要更新：网关上可用的模型已有变化。`,
    updateModels: "更新模型列表…",
    loadFailed: "无法读取本机的客户端",
    noneTitle: "未检测到可接管的客户端",
    noneHint: "已安装的客户端运行一次、生成配置文件后会出现在这里；也可以按下方的配置方法手动接入。",
    manualTitle: "需要手动配置",
    manualIntro: "以下客户端无法自动接管，按步骤填入网关地址和密钥即可。",
    absentTitle: "未检测到",
    absentIntro: "配置文件不在默认位置时，可以更改路径，或按配置方法手动接入。",

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
    changePath: "更改路径…",
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
    alsoModifies: (path: ReactNode) => <>同时修改 {path}，同样先完整备份。</>,
    alsoCreates: (path: ReactNode) => <>同时新建 {path}。</>,
    alsoDeletes: (path: ReactNode) => <>同时删除 {path}（接管时新建，还原后为空）。</>,
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

    // WSL
    thisComputer: "这台电脑",
    wslGroup: (distro: string) => `WSL · ${distro}`,
    inWsl: (name: string, distro: string) => `${name}（WSL · ${distro}）`,
    wslUnreadable: "无法读取",
    /** 组名下面那一句：此刻用的是哪种网络、经由哪个地址连接网关；不能接管的说一声 */
    wslSummary: {
      wsl1: (host: string) => `WSL 1，与 Windows 共用网络，经由 ${host} 连接网关。`,
      mirrored: (host: string) => `mirrored 网络，经由 ${host} 连接网关。`,
      nat: (host: string) => `NAT 网络，经由 ${host} 连接网关。`,
      natBlocked: "NAT 网络，无法接管。",
      restart: "NAT 网络，重启 WSL 后改用 mirrored 网络。",
      fallback: "NAT 网络，未能改用 mirrored 网络。",
    },
    /** 连着远程时，组名下面那一句后面接上：这一组里还有指着本机网关的（组收起时也看得见） */
    wslLeft: (summary: string, n: number) => `${summary}${n} 个已接管的客户端仍指向本机网关。`,
    // 不能接管时，组里的那条说明
    natBody: "WSL 使用 NAT 网络，Windows 上的网关无法从 WSL 内访问；改为 mirrored 网络模式后才能接管。",
    natVersion: "mirrored 网络模式需要 WSL 2.0.5 或更高版本，可在终端中运行 wsl --update 更新。",
    toMirrored: "改为 mirrored 模式…",
    restartBody: "已在 .wslconfig 中设为 mirrored 网络模式，重启 WSL 后生效。",
    fallbackBody: "WSL 重启后仍在使用 NAT 网络，未能启用 mirrored 网络模式，因此无法接管 WSL 中的客户端。",
    restartWsl: "重启 WSL…",
    oldWindowsBody: "这台电脑的 Windows 版本不支持 mirrored 网络模式，因此无法接管 WSL 中的客户端。",
    oldWslBody: (version: string) => `WSL ${version} 不支持 mirrored 网络模式，需先在终端中运行 wsl --update。`,
    unreachable: "WSL 中无法访问网关",
    // 改为 mirrored 的确认
    mirroredTitle: "改为 mirrored 网络模式",
    mirroredAllDistros: "对这台电脑上所有 WSL 2 发行版生效。",
    mirroredRestart: "重启 WSL 后才会生效。",
    mirroredKept: "完全卸载时不会改回。",
    mirroredNoop: "已是 mirrored 网络模式，无需修改。",
    confirmMirrored: "改为 mirrored",
    mirroredSet: "已改为 mirrored 网络模式，重启 WSL 后生效",
    // 重启 WSL 的确认
    restartTitle: "重启 WSL",
    restartWhat: "将执行 wsl --shutdown：所有正在运行的 WSL 发行版都会停止，其中运行的程序随之退出。",
    confirmRestart: "重启 WSL",
    wslRestarted: "已重启 WSL",

    // 更改配置文件路径
    pathTitle: (name: string) => `${name} 的配置文件`,
    pathDesc: "接管与还原时修改的文件。",
    pathLabel: "路径",
    pathDefault: (path: string) => `默认位置：${path}`,
    pathRestore: "恢复默认",
    pathAdopted: "已接管，需先还原才能更改路径。",
    enterPath: "填写路径",

    // 全部还原
    restoreAllTitle: "还原全部客户端",
    restoreAllBody: (n: number) =>
      `以下 ${n} 个客户端将还原到接管之前的配置，之后它们的请求不再经过网关。`,
    keysKept: "各自的密钥保留，再次接管时直接使用。",
    confirmRestoreAll: "全部还原",
  },
  {
    restoreAll: "Restore all…",
    modelsStale: (name: string) =>
      `The model list in ${name} needs updating: the models available on the gateway have changed.`,
    updateModels: "Update model list…",
    loadFailed: "Could not read the clients on this computer",
    noneTitle: "No client to connect was found",
    noneHint:
      "An installed client appears here once it has been run and has created its configuration file. Each one can also be set up by hand below.",
    manualTitle: "Set up by hand",
    manualIntro:
      "These clients cannot be connected automatically; follow the steps to enter the gateway address and key.",
    absentTitle: "Not detected",
    absentIntro:
      "When the configuration file is not in its default location, change the path, or set the client up by hand.",

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
    changePath: "Change path…",
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
    alsoModifies: (path: ReactNode) => <>{path} is changed along with it, and backed up in full first as well.</>,
    alsoCreates: (path: ReactNode) => <>{path} is created along with it.</>,
    alsoDeletes: (path: ReactNode) => <>{path} is removed along with it (it was created on connecting and is empty once restored).</>,
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

    // WSL
    thisComputer: "This computer",
    wslGroup: (distro: string) => `WSL · ${distro}`,
    inWsl: (name: string, distro: string) => `${name} (WSL · ${distro})`,
    wslUnreadable: "Could not be read",
    wslSummary: {
      wsl1: (host: string) => `WSL 1 shares the network with Windows; clients reach the gateway at ${host}.`,
      mirrored: (host: string) => `Mirrored networking; clients reach the gateway at ${host}.`,
      nat: (host: string) => `NAT networking; clients reach the gateway at ${host}.`,
      natBlocked: "NAT networking; clients cannot be connected.",
      restart: "NAT networking; mirrored networking takes over once WSL restarts.",
      fallback: "NAT networking; mirrored networking could not be turned on.",
    },
    wslLeft: (summary: string, n: number) =>
      n === 1
        ? `${summary} 1 connected client still points to the local gateway.`
        : `${summary} ${n} connected clients still point to the local gateway.`,
    natBody:
      "WSL uses NAT networking, so the gateway on Windows cannot be reached from inside WSL. Clients can be connected once WSL uses mirrored networking.",
    natVersion: "Mirrored networking needs WSL 2.0.5 or later; wsl --update in a terminal updates it.",
    toMirrored: "Switch to mirrored…",
    restartBody: "Mirrored networking is set in .wslconfig and takes effect once WSL restarts.",
    fallbackBody:
      "WSL still uses NAT networking after restarting. Mirrored networking could not be turned on, so clients in WSL cannot be connected.",
    restartWsl: "Restart WSL…",
    oldWindowsBody:
      "This version of Windows does not support mirrored networking, so clients in WSL cannot be connected.",
    oldWslBody: (version: string) =>
      `WSL ${version} does not support mirrored networking. Run wsl --update in a terminal first.`,
    unreachable: "The gateway cannot be reached from WSL",
    mirroredTitle: "Switch to mirrored networking",
    mirroredAllDistros: "Applies to every WSL 2 distribution on this computer.",
    mirroredRestart: "Takes effect once WSL restarts.",
    mirroredKept: "A full uninstall does not change it back.",
    mirroredNoop: "Mirrored networking is already set; nothing to change.",
    confirmMirrored: "Switch",
    mirroredSet: "Switched to mirrored networking; it takes effect once WSL restarts",
    restartTitle: "Restart WSL",
    restartWhat:
      "This runs wsl --shutdown: every running WSL distribution stops, and the programs running in it exit.",
    confirmRestart: "Restart WSL",
    wslRestarted: "WSL restarted",

    pathTitle: (name: string) => `${name} configuration file`,
    pathDesc: "The file changed when connecting and restoring.",
    pathLabel: "Path",
    pathDefault: (path: string) => `Default location: ${path}`,
    pathRestore: "Restore default",
    pathAdopted: "Connected. Restore it before changing the path.",
    enterPath: "Enter a path",

    restoreAllTitle: "Restore all clients",
    restoreAllBody: (n: number) =>
      `${count(n, "client", "clients")} will go back to the configuration from before connecting, and their requests will no longer pass through the gateway.`,
    keysKept: "Each keeps its key, which is used again on the next connection.",
    confirmRestoreAll: "Restore all",
  },
);
