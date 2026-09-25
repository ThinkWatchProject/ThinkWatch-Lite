// 应用的 Rust 侧自己管的东西：提醒、外观、语言、菜单栏、开机启动、更新、连接。
import type { Notice } from "@/Notices";
import type { LanguageView, MenubarStyle, NoticeMode, Theme, ThemeView } from "@/settings/api";
import type { UpdateView } from "@/updateFlow";
import type { ConnView, LinkState, Profile, Tested } from "@/connection/api";
import { P } from "./params";
import { DAY, HOUR, MIN, NOW, L, clone } from "./util";

// ───────────────────────────────────────── 提醒（句子照 src-tauri/src/notices/rules.rs）

/**
 * **都已读**：铃铛上不挂红点。每一张图的右上角都顶着一个角标的话，看图的人先看见的是它
 */
export const NOTICES: Notice[] = [
  {
    key: "toolwall:anthropic",
    level: "warning",
    title: L("已拦截 anthropic 返回的 Bash 调用", "Blocked Bash Call from “anthropic”"),
    body: L("命中规则「下载即执行」，响应已切断。", "It matched the rule “Download and run”, so the response was cut off."),
    view: "security",
    first_at_ms: NOW - 19 * MIN - 40_000,
    at_ms: NOW - 19 * MIN - 40_000,
    count: 1,
    notified: true,
    read: true,
  },
  {
    key: "scan",
    level: "warning",
    title: L("客户端配置中出现可疑内容", "Suspicious Content in Client Configuration"),
    body: L("新增 1 项，详见 MCP 页。", "1 new item. Details are on the MCP page."),
    view: "mcp",
    first_at_ms: NOW - 5 * HOUR - 12 * MIN,
    at_ms: NOW - 5 * HOUR - 12 * MIN,
    count: 1,
    notified: true,
    read: true,
  },
];

export const noticeMode: NoticeMode = "system";

// ───────────────────────────────────────── 外观、语言、菜单栏、开机启动

/** 跟随系统。系统是深是浅由截图程序给 WKWebView 设的外观决定 */
const sysTheme: Theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
export const themeView = (): ThemeView => ({ current: sysTheme, setting: null, system: sysTheme });
export const langView = (): LanguageView => ({ current: P.lang, setting: null, system: P.lang });
export const menubar: MenubarStyle = "full";
export const autostart = true;

// ───────────────────────────────────────── 更新

/** 这一版应用。**截图拍的就是它**：和 package.json 一致 */
export const APP_VERSION = "2026.9.16";
export const updateView = (): UpdateView => ({ version: APP_VERSION, install: "standalone", check_updates: true, offer: null });

// ───────────────────────────────────────── 连接

/** 这一版应用配的 core */
export const CORE_VERSION = "0.48.0";

const PROFILES: Profile[] = [
  { id: "local", name: "", local: true, host: null, port: null, addr: null, last_connected_at: NOW - 2 * HOUR },
  // 家里那台跑着 core 的服务器（`twcore remote enable` 写的随机端口）
  { id: "p-homelab", name: "homelab", local: false, host: "192.168.1.40", port: 24817, addr: "192.168.1.40:24817", last_connected_at: NOW - 2 * HOUR },
  { id: "p-build", name: "build-server", local: false, host: "build.internal", port: 27403, addr: "build.internal:27403", last_connected_at: NOW - 3 * DAY },
];

/** 服务器上的 core 答的：版本，和它的网关在哪儿听（绑所有网卡） */
export const SERVER = { core_version: CORE_VERSION, gateway_addr: "0.0.0.0:8788" };

function link(): LinkState {
  return P.remote ? { kind: "connected", info: clone(SERVER) } : { kind: "local" };
}

export function connView(): ConnView {
  const current = P.remote ? "p-homelab" : "local";
  return {
    profiles: clone(PROFILES).filter((p) => !(P.adding && p.id === "p-homelab")),
    current,
    last_used: current,
    startup: "last",
    link: link(),
    required_core: CORE_VERSION,
    data_dir: "~/.thinkwatch",
  };
}

/** 「测试连接」：握手通过，读回服务器 core 的版本和网关地址 */
export const tested = (): Tested => ({ result: "ok", info: clone(SERVER) });
