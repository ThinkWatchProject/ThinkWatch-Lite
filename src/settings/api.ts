/**
 * 设置页里「这个应用自己的」那几项：类型化的 invoke 和它们的类型。
 *
 * **都不经 core。**语言、外观、菜单栏、提醒、开机启动、更新、关于和卸载都是 Rust
 * 这一侧的事（`src-tauri/src/settings.rs`、`updater.rs`、`uninstall.rs`），远程
 * core 连不上时照样能读能改。改配置文件的两节（监听、日志保留）走 core，不在这里。
 */
import { invoke } from "@tauri-apps/api/core";
import type { Lang } from "@/i18n";
import type { Found, UpdateView } from "@/updateFlow";

export type Theme = "light" | "dark";
/** 设置里的三档：`system` 是跟随系统 */
export type ThemeChoice = "system" | Theme;

/** 现在用的、设置里选的（`null` 是跟随系统）、系统的 */
export interface ThemeView {
  current: Theme;
  setting: Theme | null;
  system: Theme;
}

/** 现在用的、设置里选的（`null` 是跟随系统）、系统的 */
export interface LanguageView {
  current: Lang;
  setting: Lang | null;
  system: Lang;
}

/** 菜单栏：标识和数值 / 仅标识 / 仅数值（只有 macOS 有） */
export type MenubarStyle = "full" | "icon" | "numbers";

/** 提醒：系统通知 / 仅在应用内 / 关闭 */
export type NoticeMode = "system" | "app" | "off";

/** `app_info`：排查时最先要问的几样 */
export interface AppInfo {
  version: string;
  identifier: string;
  data_dir: string;
  /** core 二进制的位置；找不到时是那条错误（里面列着找过的位置） */
  core_bin: string;
}

export const settingsApi = {
  theme: () => invoke<ThemeView>("app_theme"),
  setTheme: (setting: Theme | null) => invoke<ThemeView>("set_theme", { setting }),
  language: () => invoke<LanguageView>("app_language"),
  setLanguage: (setting: Lang | null) => invoke<LanguageView>("set_language", { setting }),
  menubar: () => invoke<MenubarStyle>("menubar_style"),
  setMenubar: (style: MenubarStyle) => invoke<MenubarStyle>("set_menubar_style", { style }),
  noticeMode: () => invoke<NoticeMode>("notice_mode"),
  setNoticeMode: (mode: NoticeMode) => invoke<NoticeMode>("set_notice_mode", { mode }),
  autostart: () => invoke<boolean>("autostart_enabled"),
  /** 交回的是**实际**的状态：注册可能失败（只读的 LaunchAgents 目录、权限） */
  setAutostart: (on: boolean) => invoke<boolean>("set_autostart", { on }),
  update: () => invoke<UpdateView>("update_state"),
  setUpdateCheck: (on: boolean) => invoke<UpdateView>("set_update_check", { on }),
  /** 查到了的话 Rust 那边会把更新窗口拉起来 */
  checkUpdate: () => invoke<Found | null>("update_check"),
  /** 已经查到了一版：直接把更新窗口拉起来，不再联网问一遍 */
  showUpdate: () => invoke<void>("update_show"),
  info: () => invoke<AppInfo>("app_info"),
  /** 诊断包写在数据目录里，交回路径 */
  saveDiagnostics: () => invoke<string>("save_diagnostics"),
  /** 还原接管、取消开机启动、按需删数据目录。交回的是每一步的结果，一步一句 */
  uninstall: (dropData: boolean) => invoke<string[]>("uninstall", { dropData }),
};

/**
 * 这几份数据在 `useResource` 里的键。**都以 `app:` 开头**：它们属于这个应用，
 * 不属于连着的那个 core。
 */
export const APP_KEYS = {
  theme: "app:theme",
  language: "app:language",
  menubar: "app:menubar",
  noticeMode: "app:notice-mode",
  autostart: "app:autostart",
  update: "app:update",
  info: "app:info",
} as const;
