import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isWindows } from "@/platform";

/** 句中要套一层组件（悬浮说明、加粗）的那一段 */
type Wrap = (text: string) => ReactNode;

export const configText = messages(
  {
    // 开机启动
    autostartTitle: "开机启动",
    autostartLabel: "开机时自动启动",
    autostartNote: isWindows
      ? "登录后仅在通知区域显示图标，不打开窗口。"
      : "登录后仅在菜单栏显示图标，不打开窗口。",

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
    autostartTitle: "Launch at login",
    autostartLabel: "Launch automatically at login",
    autostartNote: isWindows
      ? "At login, only the icon appears in the notification area; no window opens."
      : "At login, only the icon appears in the menu bar; no window opens.",

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
