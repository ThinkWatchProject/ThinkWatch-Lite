import { messages } from "@/i18n";

export const listenText = messages(
  {
    title: "网关监听",
    current: "当前地址",
    notListening: "未在监听",
    scope: "访问范围",
    /**
     * 三档回答的是同一个问题。
     *
     * **「局域网」绑的是一张具体的网卡，不是 0.0.0.0 加一层过滤。**绑那张
     * 网卡，别的网卡上这个端口根本不存在；本机回环一并监听，接管过的客户端
     * 照常能连。
     */
    local: "仅本机",
    localWhat: "只有本机上的程序可以连接。",
    lan: "局域网",
    lanWhat: "本机和所选网卡所在网络中的设备可以连接。",
    all: "所有网卡",
    allWhat: "所有网卡所在网络中的设备均可连接，包括公网和 VPN。",
    nic: "网卡",
    nicOption: (name: string, addr: string) => `${name}　${addr}`,
    /** 配置里写着一张当前枚举不到的网卡：网线拔了、Wi-Fi 断了 */
    nicMissing: (name: string) => `${name}（当前未找到）`,
    noNic: "未找到可用的网卡，请检查网线或 Wi-Fi 连接。",
    port: "端口",
    badPort: "端口须为 1 到 65535 之间的整数。",
    allowlist: "放行网段",
    allowlistWhat: "只允许这些网段的设备连接，未填写时放行私有网段。本机始终可以连接。",
    rangePlaceholder: "例如 192.168.1.0/24",
    removeRange: (cidr: string) => `删除 ${cidr}`,
    badRange: (v: string) => `「${v}」不是有效的地址或网段，写法如 192.168.1.0/24。`,
    saved: "监听设置已保存",
    saveFailed: "未能保存",
    staleTitle: "监听设置未生效",
    staleBody: (why: string, addr: string) => `${why}网关仍在 ${addr} 上监听。`,
  },
  {
    title: "Listening",
    current: "Address",
    notListening: "Not listening",
    scope: "Reachable from",
    local: "This machine",
    localWhat: "Only programs on this computer can connect.",
    lan: "Local network",
    lanWhat: "This computer and devices on the selected interface's network can connect.",
    all: "Every interface",
    allWhat: "Devices on the network of any interface can connect, including the internet and a VPN.",
    nic: "Interface",
    nicOption: (name: string, addr: string) => `${name}　${addr}`,
    nicMissing: (name: string) => `${name} (not found right now)`,
    noNic: "No interface is available. Check the cable or the Wi-Fi connection.",
    port: "Port",
    badPort: "The port is a whole number from 1 to 65535.",
    allowlist: "Allowed ranges",
    allowlistWhat:
      "Only devices in these ranges may connect; with none listed, the private ranges are allowed. This computer can always connect.",
    rangePlaceholder: "e.g. 192.168.1.0/24",
    removeRange: (cidr: string) => `Remove ${cidr}`,
    badRange: (v: string) => `“${v}” is not an address or a range; it is written as 192.168.1.0/24.`,
    saved: "Listen settings saved",
    saveFailed: "Not saved",
    staleTitle: "The listen settings have not taken effect",
    staleBody: (why: string, addr: string) => `${why} The gateway is still listening on ${addr}.`,
  },
);
