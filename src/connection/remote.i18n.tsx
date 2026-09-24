import { messages } from "@/i18n";
import { isMac } from "@/platform";

/** 这台机器叫什么。设计稿里写「这台 Mac」，别的平台写「这台电脑」 */
const hereZh = isMac ? "这台 Mac" : "这台电脑";
const hereEn = isMac ? "this Mac" : "this computer";
const HereEn = isMac ? "This Mac" : "This computer";

/**
 * 连着远程 core 时各页多说的那几句（设计稿 ⑧ 和「远程模式的功能差异」）：客户端、
 * MCP 改的是这台机器，设置分成「应用自己的」和「服务器的」，登录和环境变量说清
 * 取的是哪一边。
 *
 * 带 `${变量名}` 的几句是普通字符串，不是模板字符串：那是写给用户看的占位写法。
 */
export const remoteText = messages(
  {
    // 客户端页、MCP 页顶上的说明
    clientsNote: (name: string, gateway: string) =>
      `此处检查和修改的是${hereZh}上的客户端配置，使其指向 ${name} 的网关 ${gateway}；服务器上的客户端不受影响。`,
    mcpNote: (name: string) =>
      `此处检查和修改的是${hereZh}上客户端的 MCP 配置、技能与钩子；${name} 上的不受影响。`,

    // 还指着本机网关的客户端
    localLeft: (n: number, addr: string) =>
      `${n} 个已接管的客户端仍指向本机网关 ${addr}。本机网关已停止，这些客户端的请求会失败。`,
    retargetTo: (name: string) => `改为指向 ${name}`,
    retargeted: (name: string, clients: string[]) => `已改为指向 ${name}：${clients.join("、")}。`,
    retargetFailedTitle: (name: string) => `以下客户端未能改为指向 ${name}`,
    retargetNone: "没有需要修改的客户端。",
    /** 客户端名和原因之间 */
    sep: "：",

    // 设置
    appGroup: `${hereZh}上的应用`,
    serverGroup: (name: string) => `${name} 的配置`,
    controlReadOnly: "远程控制的监听与密钥只能在服务器上修改。",
    connection: "连接",
    serverCore: "服务器 core",
    uninstallServer: (name: string) => `只影响${hereZh}：${name} 上的配置和数据不受影响。`,

    // 账号登录、环境变量、系统代理
    deviceOnly: (name: string) =>
      `浏览器登录完成后会回到运行 core 的那台机器，而当前连接的是 ${name}，因此只能用设备码登录。`,
    signInWithCode: "用设备码登录",
    headersHint: "随每个请求发送。值中的 ${变量名} 读取服务器上 core 进程的环境变量。",
    systemProxy: "服务器的系统代理",
  },
  {
    clientsNote: (name: string, gateway: string) =>
      `This page checks and changes the client configuration on ${hereEn}, pointing it at the gateway of ${name} (${gateway}). Clients on the server are not affected.`,
    mcpNote: (name: string) =>
      `This page checks and changes the MCP configuration, skills and hooks of the clients on ${hereEn}. Those on ${name} are not affected.`,

    localLeft: (n: number, addr: string) =>
      n === 1
        ? `1 connected client still points to the local gateway ${addr}. The local gateway has stopped, so its requests fail.`
        : `${n} connected clients still point to the local gateway ${addr}. The local gateway has stopped, so their requests fail.`,
    retargetTo: (name: string) => `Point at ${name}`,
    retargeted: (name: string, clients: string[]) => `Now pointed at ${name}: ${clients.join(", ")}.`,
    retargetFailedTitle: (name: string) => `These clients could not be pointed at ${name}`,
    retargetNone: "No client needed changing.",
    sep: ": ",

    appGroup: `The app on ${hereEn}`,
    serverGroup: (name: string) => `Configuration on ${name}`,
    controlReadOnly: "The remote control listener and its key can only be changed on the server.",
    connection: "Connection",
    serverCore: "Server core",
    uninstallServer: (name: string) =>
      `${HereEn} only: the configuration and data on ${name} are not affected.`,

    deviceOnly: (name: string) =>
      `A browser sign-in returns to the machine that runs core, and this app is connected to ${name}, so only the device code sign-in is available.`,
    signInWithCode: "Sign in with a device code",
    headersHint: "Sent with every request. ${NAME} in a value reads an environment variable of the core process on the server.",
    systemProxy: "The server's system proxy",
  },
);
