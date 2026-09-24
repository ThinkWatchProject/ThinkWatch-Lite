import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isLinux, isMac, isWindows } from "@/platform";

/** 句中嵌着的一段代码（配置项、命令）。怎么画由组件决定 */
type Code = (text: string) => ReactNode;

/** 密钥存在哪。按平台说用户认得的那个名字 */
const vaultZh = isWindows ? "凭据管理器" : isLinux ? "系统密钥环" : "钥匙串";
const vaultEn = isWindows ? "Credential Manager" : isLinux ? "the system keyring" : "the keychain";
/** 启动时按住哪个键 */
const holdZh = isMac ? "Option" : "Alt";

/**
 * 连接：侧栏的切换器、设置里的「连接」一节、添加与编辑、切换确认、未连接页、
 * 断线横幅、启动时的连接选择。
 */
export const connText = messages(
  {
    /** 内置的那一条 */
    local: "本机",
    localNote: (dir: string) => `${dir} · 内置，不可删除`,
    localCore: "本地 core",
    localStopped: "本地 core · 已停止",

    // 侧栏
    switcherTip: "切换连接",
    menuTitle: "连接",
    addRemote: "添加远程连接…",
    manage: "管理连接…",
    connected: "已连接",
    connecting: "正在连接",
    unlinked: "未连接",

    // 设置 → 连接
    title: "连接",
    add: "添加远程连接",
    intro: isMac
      ? "应用同一时间连接一个 core。连接到远程 core 时，本机 core 停止运行，本机数据保留。"
      : "应用同一时间连接一个 core。连接到远程 core 时，本机的 core 停止运行，本机数据保留。",
    current: "当前",
    switchTo: "切换到此连接",
    lastConnected: (when: string) => `上次连接 ${when}`,
    neverConnected: "尚未连接",
    coreVersion: (v: string) => `core ${v}`,
    currentOnlyDelete: "当前连接不能删除，请先切换到其他连接。",
    startupGroup: "启动",
    startupLabel: "启动时连接",
    startupLast: "上次使用的连接",
    startupLocal: "本机",
    startupHint: isLinux
      ? "连续两次启动未能完成时，下次启动先显示连接选择。"
      : `按住 ${holdZh} 键启动应用时，先显示连接选择。`,
    deleteTitle: (name: string) => `删除连接「${name}」？`,
    deleteBody: `保存在${vaultZh}中的密钥一并删除。服务器上的 core 不受影响。`,

    // 添加与编辑
    addTitle: "添加远程连接",
    editTitle: "编辑连接",
    dialogDesc: "连接到运行在另一台机器上的 ThinkWatch core。",
    name: "名称",
    namePlaceholder: "例如 home-server",
    host: "地址",
    hostHint: "主机名或 IP 地址。",
    port: "控制端口",
    portHint: (code: Code) => <>服务器配置中 {code("listen.control.remote.port")} 的值。</>,
    key: "密钥",
    keyHint: (code: Code) => (
      <>
        在服务器上执行 {code("twcore control-key")} 获取。保存在{vaultZh}中。
      </>
    ),
    keySaved: `已保存在${vaultZh}中`,
    replaceKey: "更换",
    test: "测试连接",
    testHint: "完成握手并读取服务器 core 的版本。",
    testOk: (version: string, gateway: string | null) =>
      `连接成功 · core ${version}${gateway ? ` · 网关 ${gateway}` : ""}`,
    saveAndSwitch: "保存并切换",
    enterName: "填写名称",
    nameTaken: "已有同名的连接",
    enterHost: "填写地址",
    badHost: "地址格式不正确",
    badPort: "端口应为 1–65535 之间的整数",
    enterKey: "填写密钥",
    badKey: "密钥应为 64 位十六进制字符",

    // 连接失败的几种说法：标题一句，下一步一句
    unreachable: (addr: string) => `无法连接到 ${addr}`,
    unreachableNext: (code: Code) => (
      <>检查地址和端口，以及服务器配置中 {code("listen.control.remote")} 是否已启用。</>
    ),
    timeoutNext: (code: Code) => (
      <>连接超时。检查地址和端口，以及服务器配置中 {code("listen.control.remote")} 是否已启用。</>
    ),
    closed: "连接被服务器关闭",
    closedNext: (code: Code) => (
      <>本机地址可能不在服务器配置 {code("listen.control.remote.allow_from")} 中。</>
    ),
    wrongKey: "密钥不正确",
    wrongKeyNext: (code: Code) => <>在服务器上执行 {code("twcore control-key")} 查看当前密钥。</>,
    mismatch: (theirs: string, ours: string) => `版本不一致：服务器 core ${theirs}，本应用需要 ${ours}`,
    mismatchNext: "在服务器上升级 core 后再连接。",
    unsupported: "此版本尚不支持连接远程 core",
    unsupportedNext: "服务器可以访问。更新应用后即可连接。",
    reasonTimeout: "连接超时",
    reasonUnreachable: "无法访问该地址",

    // 切换
    testingTitle: (name: string) => `正在连接 ${name}…`,
    failedTitle: (name: string) => `无法切换到 ${name}`,
    confirmTitle: (name: string) => `切换到 ${name}？`,
    switchedTo: (name: string) => `已切换到 ${name}`,
    adoptedWarn: (n: number, addr: string) => `已接管的 ${n} 个客户端仍指向本机网关 ${addr}。`,
    adoptedWarnNext: (name: string) =>
      `切换后本机网关停止，这些客户端的请求会失败，直到重新连接本机，或在客户端页将它们改为指向 ${name}。`,
    retarget: (name: string) => `同时将这些客户端改为指向 ${name}`,
    localStops: "本机 core 将在在途请求结束后停止",
    localKept: "，本机的配置、密钥和请求历史保留。",
    remoteConfig: (name: string) => `切换后，上游、路由、密钥等页面显示和修改的是 ${name} 上的配置。`,
    switchAction: "切换",
    editConnection: "编辑连接",
    keychainFailed: `无法从${vaultZh}中读取密钥`,
    gone: "该连接已被删除。",

    // 未连接页
    cannotConnect: (name: string) => `无法连接到 ${name}`,
    connectingTo: (name: string) => `正在连接 ${name}`,
    address: "地址",
    reason: "原因",
    retry: "重试",
    retryIn: (attempt: number, secs: number) => `第 ${attempt} 次，${secs} 秒后`,
    retrying: (attempt: number) => `第 ${attempt} 次，正在连接`,
    retryNow: "立即重试",
    switchToLocal: "切换到本机",
    autoResume: "连接恢复后自动回到上次打开的页面。",
    mismatchTitle: (name: string) => `${name} 上的 core 版本与本应用不一致`,
    server: "服务器",
    appNeeds: "本应用需要",
    runOnServer: "在服务器上执行：",
    upgradeCommand: "twcore upgrade",
    reconnect: "重新连接",
    localDown: "本机 core 未在运行",
    restartLocal: "重新启动",

    // 断线横幅
    lostBanner: (name: string, attempt: number) =>
      attempt > 0
        ? `与 ${name} 的连接已断开，正在重连（第 ${attempt} 次）。页面内容为断开前的状态，暂不可修改。`
        : `与 ${name} 的连接已断开，正在重连。页面内容为断开前的状态，暂不可修改。`,

    // 启动时的连接选择
    pickTitle: "选择连接",
    pickOption: `按住 ${holdZh} 键启动。选择这次要连接的 core。`,
    pickUnfinished: "上次启动未能完成。选择这次要连接的 core。",
    lastUsed: "上次使用",
    connect: "连接",
  },
  {
    local: isMac ? "This Mac" : "This computer",
    localNote: (dir: string) => `${dir} · Built in, cannot be deleted`,
    localCore: "Local core",
    localStopped: "Local core · Stopped",

    switcherTip: "Switch connection",
    menuTitle: "Connection",
    addRemote: "Add remote connection…",
    manage: "Manage connections…",
    connected: "Connected",
    connecting: "Connecting",
    unlinked: "Not connected",

    title: "Connection",
    add: "Add remote connection",
    intro: isMac
      ? "The app connects to one core at a time. While it is connected to a remote core, the core on this Mac stops running; its data is kept."
      : "The app connects to one core at a time. While it is connected to a remote core, the core on this computer stops running; its data is kept.",
    current: "Current",
    switchTo: "Switch to this connection",
    lastConnected: (when: string) => `Last connected ${when}`,
    neverConnected: "Never connected",
    coreVersion: (v: string) => `core ${v}`,
    currentOnlyDelete: "The current connection cannot be deleted. Switch to another connection first.",
    startupGroup: "Startup",
    startupLabel: "Connect at startup",
    startupLast: "Last used connection",
    startupLocal: isMac ? "This Mac" : "This computer",
    startupHint: isLinux
      ? "After two startups in a row fail to finish, the next startup shows the connection choice first."
      : `Hold ${holdZh} while opening the app to choose a connection first.`,
    deleteTitle: (name: string) => `Delete the connection “${name}”?`,
    deleteBody: `The key saved in ${vaultEn} is deleted as well. The core on the server is not affected.`,

    addTitle: "Add remote connection",
    editTitle: "Edit connection",
    dialogDesc: "Connect to a ThinkWatch core running on another machine.",
    name: "Name",
    namePlaceholder: "e.g. home-server",
    host: "Address",
    hostHint: "Host name or IP address.",
    port: "Control port",
    portHint: (code: Code) => <>The value of {code("listen.control.remote.port")} in the server's config.</>,
    key: "Key",
    keyHint: (code: Code) => (
      <>
        Run {code("twcore control-key")} on the server to get it. Saved in {vaultEn}.
      </>
    ),
    keySaved: `Saved in ${vaultEn}`,
    replaceKey: "Replace",
    test: "Test connection",
    testHint: "Completes the handshake and reads the server's core version.",
    testOk: (version: string, gateway: string | null) =>
      `Connected · core ${version}${gateway ? ` · gateway ${gateway}` : ""}`,
    saveAndSwitch: "Save and switch",
    enterName: "Enter a name",
    nameTaken: "A connection with this name already exists",
    enterHost: "Enter an address",
    badHost: "The address is not valid",
    badPort: "The port must be a whole number from 1 to 65535",
    enterKey: "Enter the key",
    badKey: "The key must be 64 hexadecimal characters",

    unreachable: (addr: string) => `Cannot connect to ${addr}`,
    unreachableNext: (code: Code) => (
      <>Check the address and port, and whether {code("listen.control.remote")} is enabled in the server's config.</>
    ),
    timeoutNext: (code: Code) => (
      <>
        The connection timed out. Check the address and port, and whether {code("listen.control.remote")} is
        enabled in the server's config.
      </>
    ),
    closed: "The server closed the connection",
    closedNext: (code: Code) => (
      <>This computer's address may be missing from {code("listen.control.remote.allow_from")} in the server's config.</>
    ),
    wrongKey: "The key is not correct",
    wrongKeyNext: (code: Code) => <>Run {code("twcore control-key")} on the server to see the current key.</>,
    mismatch: (theirs: string, ours: string) =>
      `Version mismatch: the server runs core ${theirs}; this app needs ${ours}`,
    mismatchNext: "Upgrade core on the server, then connect again.",
    unsupported: "This version cannot connect to a remote core yet",
    unsupportedNext: "The server is reachable. Connecting becomes possible after an app update.",
    reasonTimeout: "The connection timed out",
    reasonUnreachable: "The address is not reachable",

    testingTitle: (name: string) => `Connecting to ${name}…`,
    failedTitle: (name: string) => `Cannot switch to ${name}`,
    confirmTitle: (name: string) => `Switch to ${name}?`,
    switchedTo: (name: string) => `Switched to ${name}`,
    adoptedWarn: (n: number, addr: string) =>
      n === 1
        ? `1 connected client still points to the local gateway ${addr}.`
        : `${n} connected clients still point to the local gateway ${addr}.`,
    adoptedWarnNext: (name: string) =>
      `After the switch, the local gateway stops and their requests fail until the app switches back, or until they are pointed at ${name} on the Clients page.`,
    retarget: (name: string) => `Also point these clients at ${name}`,
    localStops: "The local core stops once in-progress requests finish",
    localKept: "; its config, keys and request history are kept.",
    remoteConfig: (name: string) =>
      `After the switch, the Upstreams, Routing, Keys and other pages show and change the config on ${name}.`,
    switchAction: "Switch",
    editConnection: "Edit connection",
    keychainFailed: `The key could not be read from ${vaultEn}`,
    gone: "This connection has been deleted.",

    cannotConnect: (name: string) => `Cannot connect to ${name}`,
    connectingTo: (name: string) => `Connecting to ${name}`,
    address: "Address",
    reason: "Reason",
    retry: "Retry",
    retryIn: (attempt: number, secs: number) => `Attempt ${attempt}, in ${secs} s`,
    retrying: (attempt: number) => `Attempt ${attempt}, connecting`,
    retryNow: "Retry now",
    switchToLocal: isMac ? "Switch to this Mac" : "Switch to this computer",
    autoResume: "Once the connection is restored, the app returns to the page that was open.",
    mismatchTitle: (name: string) => `The core on ${name} does not match this app`,
    server: "Server",
    appNeeds: "This app needs",
    runOnServer: "Run on the server:",
    upgradeCommand: "twcore upgrade",
    reconnect: "Reconnect",
    localDown: "The local core is not running",
    restartLocal: "Restart",

    lostBanner: (name: string, attempt: number) =>
      attempt > 0
        ? `Disconnected from ${name}. Reconnecting (attempt ${attempt}). The page shows the state before the disconnect and cannot be changed for now.`
        : `Disconnected from ${name}. Reconnecting. The page shows the state before the disconnect and cannot be changed for now.`,

    pickTitle: "Choose a connection",
    pickOption: `${holdZh} was held at startup. Choose the core to connect to this time.`,
    pickUnfinished: "The last startup did not finish. Choose the core to connect to this time.",
    lastUsed: "Last used",
    connect: "Connect",
  },
);
