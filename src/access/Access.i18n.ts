import { messages } from "@/i18n";

export const accessText = messages(
  {
    title: "谁能连到这个网关",
    /**
     * 三档回答的是同一个问题。
     *
     * **「局域网」绑的是一张具体的网卡，不是 0.0.0.0 加一层过滤。**绑那张
     * 网卡，别的网卡上这个端口根本不存在；绑 0.0.0.0 再按来源筛，是端口
     * 到处开着、由我们的代码拒人。前者的边界在内核。
     */
    local: "仅本机",
    localWhat: "绑定 127.0.0.1。只有这台电脑上的程序能连接。",
    lan: "局域网",
    lanWhat:
      "只在选中的这张网卡上监听。同一网络中的设备可以连接，其余网卡上没有这个端口。",
    all: "所有网卡",
    allWhat:
      "在每一张网卡上监听，包括连接公网和 VPN 的那些。下方的放行网段决定实际放进来的来源。",
    nic: "网卡",
    nicOption: (name: string, addr: string) => `${name}　${addr}`,
    /** 配置里写着一张当前枚举不到的网卡：网线拔了、Wi-Fi 断了 */
    nicMissing: (name: string) => `${name}（当前未找到）`,
    noNic: "未找到可绑定的网卡，请检查网线或 Wi-Fi 连接。",
    /** 存的是名字不是地址，所以换网络之后仍然有效 —— 这一点值得说 */
    nicStable: "按网卡名保存，更换网络后仍然有效。",
    port: "端口",
    keyEnforced: "密钥强制校验",
    keyEnforcedTip:
      "监听范围超出本机时，密钥校验强制开启且无法关闭，以防同一网段的其他设备使用上游额度。",
    allowlist: "放行网段",
    allowlistWhat: "只有这些网段的来源能连接。留空即按私网段放行。",
    allowlistEmpty: "未设置，按私网段放行：10/8、172.16/12、192.168/16。",
    addSource: "添加网段",
    removeSource: (cidr: string) => `删除 ${cidr}`,
    cidrPlaceholder: "例如 192.168.1.0/24",
    listening: "正在监听",

    keysTitle: "密钥",
    keysIntro: "客户端拿密钥连接网关。谁能连是两道：地址一道，密钥一道。",

    limitsTitle: "并发",
    limitsIntro: "同时在处理的请求超过上限就排队，队列满了才拒绝。",
    maxConcurrent: "全局",
    maxConcurrentWhat: "同时处理的请求数上限，超出后进入队列。",
    perProvider: "单个上游",
    perProviderWhat:
      "单个上游同时处理的请求数上限，避免个别上游变慢时占满全局并发。",
    queueDepth: "队列上限",
    queueDepthWhat: "队列达到此长度后拒绝新请求。",
    queueTimeout: "排队超时",
    queueTimeoutWhat: "排队超过此时长后放弃（秒）。",
    perKeyNote: "上方表格里的「并发」一列是每把密钥自己的上限。",

    versionNotLoaded: "配置版本尚未读取，请稍后重试",
    notANumber: "这一项要填一个整数",
  },
  {
    title: "Who can reach this gateway",
    local: "This machine",
    localWhat: "Binds 127.0.0.1. Only programs on this computer can connect.",
    lan: "Local network",
    lanWhat:
      "Listens on the selected interface alone. Devices on that network can connect; the port does not exist on the others.",
    all: "Every interface",
    allWhat:
      "Listens on every interface, including any facing the internet or a VPN. The ranges below decide which sources are let through.",
    nic: "Interface",
    nicOption: (name: string, addr: string) => `${name}　${addr}`,
    nicMissing: (name: string) => `${name} (not found right now)`,
    noNic:
      "No interface is available to bind to. Check the cable or the Wi-Fi connection.",
    nicStable: "Stored by interface name, so it survives a change of network.",
    port: "Port",
    keyEnforced: "Key checking enforced",
    keyEnforcedTip:
      "Once the gateway listens beyond this machine, key checking is on and cannot be turned off, so that other devices on the network cannot spend the upstream quota.",
    allowlist: "Allowed ranges",
    allowlistWhat:
      "Only these ranges may connect. Leave it empty for the private ranges.",
    allowlistEmpty:
      "Not set; the private ranges are allowed: 10/8, 172.16/12, 192.168/16.",
    addSource: "Add a range",
    removeSource: (cidr: string) => `Remove ${cidr}`,
    cidrPlaceholder: "e.g. 192.168.1.0/24",
    listening: "Listening on",

    keysTitle: "Keys",
    keysIntro:
      "Clients connect with a key. Two things decide who gets in: the address, and the key.",

    limitsTitle: "Concurrency",
    limitsIntro:
      "Requests beyond the limit wait in the queue; only a full queue is refused.",
    maxConcurrent: "Global",
    maxConcurrentWhat:
      "The most requests handled at once. Requests beyond it wait in the queue.",
    perProvider: "Per upstream",
    perProviderWhat:
      "The most requests one upstream handles at once, so a slow upstream cannot take the whole global limit.",
    queueDepth: "Queue limit",
    queueDepthWhat:
      "New requests are refused once the queue reaches this length.",
    queueTimeout: "Queue timeout",
    queueTimeoutWhat: "Requests give up after waiting this long, in seconds.",
    perKeyNote:
      "The Concurrency column in the table above is each key's own limit.",

    versionNotLoaded:
      "The config version has not been loaded yet. Try again in a moment.",
    notANumber: "This one takes a whole number",
  },
);
