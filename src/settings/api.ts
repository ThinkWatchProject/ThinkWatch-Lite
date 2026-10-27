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
import type { UninstallStep } from "@/types";

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

/** 界面大小的几档，百分比（和 `src-tauri/src/zoom.rs` 的 `STEPS` 一致） */
export const ZOOM_STEPS = [90, 100, 110, 125, 150] as const;
export type UiZoom = (typeof ZOOM_STEPS)[number];
/** 快捷键：放大一档、缩小一档、回到 100% */
export type ZoomStep = "in" | "out" | "reset";

/**
 * 呼出快捷键的一个组合（`src-tauri/src/hotkey.rs` 的 `Combo`）。`code` 是物理键位
 * （`KeyboardEvent.code`：`KeyH`、`Digit1`、`F5`）；`meta` 是 macOS 的 ⌘、别处的 Win / Super 键
 */
export interface HotkeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  code: string;
}

/** 设置里的（`null` 是关掉了）、出厂的、注册上了没有、这个桌面支不支持 */
export interface HotkeyView {
  combo: HotkeyCombo | null;
  default: HotkeyCombo;
  /** 设置里有、却是 false：被别的程序占着 */
  active: boolean;
  /** Linux 的 Wayland 会话是 false */
  supported: boolean;
}

/** 菜单栏：标识和数值 / 仅标识 / 仅数值 / 不显示（只有 macOS 有） */
export type MenubarStyle = "full" | "icon" | "numbers" | "hidden";

/** 提醒：系统通知 / 仅在应用内 / 关闭 */
export type NoticeMode = "system" | "app" | "off";

/** `app_info`：排查时最先要问的几样 */
export interface AppInfo {
  version: string;
  identifier: string;
  data_dir: string;
  /** core 二进制的位置；找不到时是那条错误（里面列着找过的位置） */
  core_bin: string;
  /** Windows 的绿色版（解压即用的那一份，数据在 exe 旁边的 `data\`）。别的都是 false */
  portable: boolean;
}

export const settingsApi = {
  theme: () => invoke<ThemeView>("app_theme"),
  setTheme: (setting: Theme | null) => invoke<ThemeView>("set_theme", { setting }),
  zoom: () => invoke<UiZoom>("ui_zoom"),
  setZoom: (zoom: UiZoom) => invoke<UiZoom>("set_ui_zoom", { zoom }),
  /** 新的一档由 Rust 那边算（按住快捷键时一连串的按键不会读到同一档） */
  stepZoom: (step: ZoomStep) => invoke<UiZoom>("step_ui_zoom", { step }),
  hotkey: () => invoke<HotkeyView>("hotkey_state"),
  /** 先注册、注册上了才存；被占着时报错，原来那一个照旧 */
  setHotkey: (combo: HotkeyCombo | null) => invoke<HotkeyView>("set_hotkey", { combo }),
  /** 录入期间放掉现在的那一个，不然按下它窗口就收起了、录不进来 */
  setHotkeyRecording: (on: boolean) => invoke<void>("set_hotkey_recording", { on }),
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
  /** 还原接管、取消开机启动、按需删数据目录。交回的是每一步的结果：做成了没有，和一句话 */
  uninstall: (dropData: boolean) => invoke<UninstallStep[]>("uninstall", { dropData }),
};

/**
 * 这几份数据在 `useResource` 里的键。**都以 `app:` 开头**：它们属于这个应用，
 * 不属于连着的那个 core。
 */
export const APP_KEYS = {
  theme: "app:theme",
  zoom: "app:zoom",
  hotkey: "app:hotkey",
  language: "app:language",
  menubar: "app:menubar",
  noticeMode: "app:notice-mode",
  autostart: "app:autostart",
  update: "app:update",
  info: "app:info",
} as const;
