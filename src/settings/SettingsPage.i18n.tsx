import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isMac, isWindows } from "@/platform";

/** 句中要套一层组件（悬浮说明、加粗）的那一段 */
type Wrap = (text: string) => ReactNode;

/** 这台机器叫什么。和远程模式那几句（`remote.i18n.tsx`）同一个说法 */
const hereZh = isMac ? "这台 Mac" : "这台电脑";
const hereEn = isMac ? "This Mac" : "This computer";

/** 卸载做完之后用户还要做的那一步，按平台说 */
const afterZh = isMac ? "完成后即可将应用移到废纸篓。" : isWindows ? "完成后即可卸载或删除应用。" : "完成后即可删除应用。";
const afterEn = isMac
  ? "Once it finishes, the app can be moved to the Trash."
  : isWindows
    ? "Once it finishes, the app can be uninstalled or deleted."
    : "Once it finishes, the app can be deleted.";

/**
 * 设置页：页头、目录、「关于」和「卸载」两节。其余各节的文案在各自的词表里
 * （`GeneralSection.i18n.ts`、`ListenSection.i18n.ts`、`RetentionSection.i18n.ts`、
 * `connection/connection.i18n.tsx`）。
 */
export const settingsText = messages(
  {
    title: "设置",

    // 页头的摘要
    running: "运行中",
    gateway: "网关",
    notListening: "未在监听",
    scopeLocal: "仅本机",
    scopeLan: "局域网",
    scopeAll: "所有网卡",
    versionIs: (v: string) => `版本 ${v}`,
    /** 页头摘要里新版本号后面那两个字 */
    available: "可用",

    // 目录里的小标题（连着远程时）
    here: hereZh,

    // 关于
    about: "关于",
    /** 「关于」里版本和检查更新那一块；命令面板里搜得到的那一项 */
    updates: "更新",
    appName: "ThinkWatch Lite",
    latest: "已是最新版本",
    newer: (v: string) => `新版本 ${v} 可用`,
    checking: "正在检查更新",
    checkFailed: "检查更新失败",
    checkNow: "检查更新",
    updateTo: (v: string) => `更新到 ${v}…`,
    homebrew: "Homebrew",
    devBuild: "开发构建",
    autoCheck: "自动检查新版本",
    dataDir: "数据目录",
    coreBin: "core 二进制",

    // 诊断包
    diagnostics: "诊断包",
    diagnosticsBody: (tip: Wrap) => (
      <>
        包含版本、上游、熔断状态、近期失败记录与脱敏后的配置文件。{tip("不含请求与响应正文")}。
      </>
    ),
    diagnosticsTip: "不包含请求体与响应体，其中可能含有用户粘贴的内容。",
    generate: "生成",
    generated: "已生成",
    /** 诊断包由 core 生成：没连上时那一行说明白 */
    diagnosticsOffline: "连接到 core 后可生成诊断包。",
    review: (em: Wrap) => <>其中的密钥与地址已脱敏，{em("提交前请自行核对")}。</>,

    // 卸载
    uninstall: "卸载",
    uninstallTitle: "完全卸载",
    uninstallIntro: (em: Wrap) => (
      <>
        还原所有已接管的客户端，并取消开机启动。
        {em(isMac ? "直接将应用移到废纸篓不会执行这些操作" : "通过系统卸载或直接删除应用不会执行这些操作")}，已接管的客户端将指向一个无人监听的端口。
      </>
    ),
    uninstallAction: "卸载…",
    willDo: `将执行以下操作。${afterZh}`,
    restoreClients: "还原已接管的客户端",
    restoreNone: "当前无已接管的客户端",
    /** 列名字时的分隔 */
    sep: "、",
    stopAutostart: "取消开机启动",
    dropData: "同时删除数据目录",
    dropDataWhat: "包括请求历史、费用记录与配置备份，删除后无法恢复。",
    confirmUninstall: "卸载",
    uninstalled: "卸载完成",
    uninstallFailed: "未能完成卸载",
    uninstalledRow: "已完成卸载。",
  },
  {
    title: "Settings",

    running: "Running",
    gateway: "Gateway",
    notListening: "Not listening",
    scopeLocal: "This machine only",
    scopeLan: "Local network",
    scopeAll: "Every interface",
    versionIs: (v: string) => `Version ${v}`,
    available: "available",

    here: hereEn,

    about: "About",
    updates: "Updates",
    appName: "ThinkWatch Lite",
    latest: "Up to date",
    newer: (v: string) => `Version ${v} is available`,
    checking: "Checking for updates",
    checkFailed: "Update check failed",
    checkNow: "Check for updates",
    updateTo: (v: string) => `Update to ${v}…`,
    homebrew: "Homebrew",
    devBuild: "Development build",
    autoCheck: "Check for updates automatically",
    dataDir: "Data directory",
    coreBin: "Core binary",

    diagnostics: "Diagnostics bundle",
    diagnosticsBody: (tip: Wrap) => (
      <>
        Contains the version, upstreams, circuit breaker states, recent failures and the redacted config file.{" "}
        {tip("No request or response bodies")}.
      </>
    ),
    diagnosticsTip: "Request and response bodies are left out, since they may contain content the user pasted in.",
    generate: "Generate",
    generated: "Generated",
    diagnosticsOffline: "A bundle can be generated once connected to a core.",
    review: (em: Wrap) => <>Keys and addresses in it are redacted; {em("review it before sharing")}.</>,

    uninstall: "Uninstall",
    uninstallTitle: "Full uninstall",
    uninstallIntro: (em: Wrap) => (
      <>
        Restores every connected client and turns off launch at login.{" "}
        {em(isMac ? "Moving the app straight to the Trash does neither" : "Uninstalling or deleting the app through the system does neither")}, leaving connected clients pointed at a port
        where nothing is listening.
      </>
    ),
    uninstallAction: "Uninstall…",
    willDo: `The following is done. ${afterEn}`,
    restoreClients: "Restore connected clients",
    restoreNone: "No client is connected at the moment",
    sep: ", ",
    stopAutostart: "Turn off launch at login",
    dropData: "Also delete the data directory",
    dropDataWhat: "The request history, cost records and config backups. This cannot be undone.",
    confirmUninstall: "Uninstall",
    uninstalled: "Uninstall complete",
    uninstallFailed: "The uninstall did not finish",
    uninstalledRow: "The uninstall is complete.",
  },
);

