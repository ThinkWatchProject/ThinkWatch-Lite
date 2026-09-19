import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句中要套一层组件（悬浮说明、加粗）的那一段 */
type Wrap = (text: string) => ReactNode;

export const configText = messages(
  {
    versionNotLoaded: "配置版本尚未读取，请稍后重试",

    // 监听方式
    loopback: "仅本机",
    loopbackWhat: "绑定 127.0.0.1。仅本机程序可连接，同网络的其他设备无法访问。",
    nic: "指定网卡",
    nicWhat: "绑定所选网卡的地址。仅该网卡所在网络中的设备可连接，密钥校验强制开启。",
    all: "所有网卡",
    allWhat: "绑定 0.0.0.0，在所有网卡上监听，包括连接公网的网卡。密钥校验强制开启。",

    // 来源白名单
    anySource: "（允许所有来源）",
    removeSource: (cidr: string) => `删除 ${cidr}`,
    sourcePlaceholder: "例如 192.168.1.0/24",

    // 客户端探测请求
    intercept: "本地应答",
    interceptWhat: "由网关直接应答，不发送到上游，不产生费用。",
    passthrough: "原样放行",
    passthroughWhat: "作为普通请求转发，按上游计费方式产生费用。",
    routed: "交给路由",
    routedWhat: "按路由规则转发，可分流至费用更低的上游。",
    probesTitle: "客户端探测请求",
    probesIntro: "客户端自动发起的辅助请求，不由用户操作触发，同样产生费用。",
    probesNote: "仅当对应类别设为「交给路由」时，路由规则中的「辅助请求」条件才会命中。",

    // 并发
    limitsTitle: "并发",
    maxConcurrent: "全局并发",
    maxConcurrentWhat: "同时处理的请求数上限，超出后进入队列。",
    perProvider: "单个上游",
    perProviderWhat: "单个上游同时处理的请求数上限，避免个别上游变慢时占满全局并发。",
    queueDepth: "队列上限",
    queueDepthWhat: "队列达到此长度后拒绝新请求。",
    queueTimeout: "排队超时",
    queueTimeoutWhat: "排队超过此时长后放弃（秒）。",

    // 监听与访问
    noNic: "未找到可绑定的网卡，请检查网线或 Wi-Fi 连接。",
    listenTitle: "监听与访问",
    exposedTitle: "网关已暴露在局域网",
    exposedBody: "同一网络中的设备均可连接网关。来源白名单仅按 IP 地址限制访问。",
    enforcedTip: "网关暴露在局域网时，密钥校验强制开启且无法关闭，以防同一网段的其他设备使用上游额度。",
    enforced: "密钥强制校验",
    nicMissing: (addr: string) => `${addr}（未找到此网卡）`,
    nicOption: (name: string, addr: string) => `${name}　${addr}`,
    addressTip:
      "此为该网卡当前的地址。DHCP 续租、切换网络或 VPN 连接变化都可能改变该地址，地址变化后网关将无法启动。如需在地址变化后保持可用，请选择「所有网卡」并配置来源白名单。",
    addressMayChange: "地址可能变化",
    listening: "正在监听",
    clientKeys: "客户端密钥",
    keyList: (items: string[]) => items.join("，"),
    allowlist: "来源白名单",

    // 开机启动
    autostartTitle: "开机启动",
    autostartLabel: "开机时自动启动",
    autostartNote: (tip: Wrap) => <>默认关闭。{tip("开启后的效果")}</>,
    autostartTip: "开启后将在「系统设置 › 通用 › 登录项」中添加一项。开机后应用仅在菜单栏显示图标，不打开窗口。",

    // 关于
    aboutTitle: "关于",
    version: "版本",
    dataDir: "数据目录",
    coreBin: "core 二进制",

    // 诊断包
    diagnosticsTitle: "诊断包",
    diagnosticsBody: (tip: Wrap) => (
      <>
        包含版本、上游、熔断状态、近期失败记录与脱敏后的配置文件。{tip("不含请求与响应正文")}。
      </>
    ),
    diagnosticsTip: "不包含请求体与响应体，其中可能含有用户粘贴的内容。",
    generate: "生成",
    saved: (path: ReactNode) => <>已生成：{path}</>,
    review: (em: Wrap) => <>其中的密钥与地址已脱敏，{em("提交前请自行核对")}。</>,

    // 完全卸载
    uninstalled: "卸载完成",
    uninstallTitle: "完全卸载",
    uninstallIntro: (em: Wrap) => (
      <>
        还原所有已接管的客户端，并取消开机启动。{em("直接将应用移到废纸篓不会执行这些操作")}，已接管的客户端将指向一个无人监听的端口。
      </>
    ),
    uninstall: "卸载…",
    willDo: "将执行以下操作：",
    restoreClients: "将所有已接管的客户端还原为接管前的配置",
    stopAutostart: "取消开机启动",
    dropData: "同时删除数据目录（请求历史、费用记录、配置备份）",
    confirmUninstall: "确认卸载",
  },
  {
    versionNotLoaded: "The config version has not been loaded yet. Try again in a moment.",

    loopback: "Local only",
    loopbackWhat:
      "Binds to 127.0.0.1. Only programs on this computer can connect; other devices on the network cannot reach it.",
    nic: "Specific interface",
    nicWhat:
      "Binds to the address of the selected interface. Only devices on that interface's network can connect, and key verification is always on.",
    all: "All interfaces",
    allWhat:
      "Binds to 0.0.0.0 and listens on every interface, including any connected to the internet. Key verification is always on.",

    anySource: "(All sources allowed)",
    removeSource: (cidr: string) => `Remove ${cidr}`,
    sourcePlaceholder: "e.g. 192.168.1.0/24",

    intercept: "Answer locally",
    interceptWhat: "The gateway answers directly. Nothing is sent upstream and no cost is incurred.",
    passthrough: "Pass through",
    passthroughWhat: "Forwarded as an ordinary request, with costs according to the upstream's billing.",
    routed: "Use routing",
    routedWhat: "Forwarded by the routing rules, which can send it to a lower-cost upstream.",
    probesTitle: "Client probes",
    probesIntro:
      "Auxiliary requests that clients send on their own, without any user action. They incur costs as well.",
    probesNote:
      "The “Auxiliary request” condition in routing rules only matches when its category is set to “Use routing”.",

    limitsTitle: "Concurrency",
    maxConcurrent: "Global concurrency",
    maxConcurrentWhat: "The most requests handled at once. Requests beyond it wait in the queue.",
    perProvider: "Per upstream",
    perProviderWhat:
      "The most requests one upstream handles at once, so a slow upstream cannot take up all global concurrency.",
    queueDepth: "Queue limit",
    queueDepthWhat: "New requests are rejected once the queue reaches this length.",
    queueTimeout: "Queue timeout",
    queueTimeoutWhat: "Requests that wait longer than this are dropped (seconds).",

    noNic: "No network interface is available to bind to. Check the cable or Wi-Fi connection.",
    listenTitle: "Listening and access",
    exposedTitle: "Gateway exposed to the local network",
    exposedBody:
      "Any device on the same network can connect to the gateway. The source allowlist restricts access by IP address only.",
    enforcedTip:
      "While the gateway is exposed to the local network, key verification is always on and cannot be turned off, so other devices on the subnet cannot use upstream quota.",
    enforced: "Key verification enforced",
    nicMissing: (addr: string) => `${addr} (interface not found)`,
    nicOption: (name: string, addr: string) => `${name} · ${addr}`,
    addressTip:
      "This is the interface's current address. A DHCP renewal, a network switch or a VPN change can alter it, and the gateway cannot start once it changes. To stay available when the address changes, choose “All interfaces” and set up a source allowlist.",
    addressMayChange: "Address may change",
    listening: "Listening on",
    clientKeys: "Client keys",
    keyList: (items: string[]) => items.join(", "),
    allowlist: "Source allowlist",

    autostartTitle: "Launch at login",
    autostartLabel: "Launch automatically at login",
    autostartNote: (tip: Wrap) => <>Off by default. {tip("Effect of turning it on")}</>,
    autostartTip:
      "Turning it on adds an item to System Settings › General › Login Items. At login, the app only shows its icon in the menu bar and opens no window.",

    aboutTitle: "About",
    version: "Version",
    dataDir: "Data directory",
    coreBin: "Core binary",

    diagnosticsTitle: "Diagnostics bundle",
    diagnosticsBody: (tip: Wrap) => (
      <>
        Contains the version, upstreams, circuit breaker states, recent failures and the redacted config file.{" "}
        {tip("No request or response bodies")}.
      </>
    ),
    diagnosticsTip: "Request and response bodies are left out, since they may contain content the user pasted in.",
    generate: "Generate",
    saved: (path: ReactNode) => <>Saved to {path}</>,
    review: (em: Wrap) => <>Keys and addresses in it are redacted; {em("review it before sharing")}.</>,

    uninstalled: "Uninstall complete",
    uninstallTitle: "Full uninstall",
    uninstallIntro: (em: Wrap) => (
      <>
        Restores every connected client and turns off launch at login.{" "}
        {em("Moving the app straight to the Trash does neither")}, leaving connected clients pointed at a port
        where nothing is listening.
      </>
    ),
    uninstall: "Uninstall…",
    willDo: "Uninstalling will:",
    restoreClients: "Restore every connected client to the configuration it had before being connected",
    stopAutostart: "Turn off launch at login",
    dropData: "Also delete the data directory (request history, cost records, config backups)",
    confirmUninstall: "Uninstall",
  },
);
