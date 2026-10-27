import { messages } from "@/i18n";
import { isLinux, isWindows } from "@/platform";

/** 设置 → 通用：语言、外观、界面大小、呼出快捷键、菜单栏、开机启动、提醒 */
export const generalText = messages(
  {
    title: "通用",

    language: "语言",
    /** 下拉里「跟随系统」那一项，括号里写出系统现在是哪种 */
    languageSystem: (name: string) => `跟随系统（${name}）`,

    appearance: "外观",
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
    /** 选了跟随系统时，把系统现在是哪一档写出来 */
    systemNow: (name: string) => `系统当前为${name}。`,

    zoom: "界面大小",
    /** 三个快捷键，按平台写好的键名（⌘= / Ctrl+=） */
    zoomKeys: (bigger: string, smaller: string, reset: string) =>
      `按 ${bigger} 放大、${smaller} 缩小，${reset} 恢复为 100%。`,

    hotkey: "呼出快捷键",
    hotkeyWhat: "在任意程序中按下即可打开主界面，主界面在最前时再按一次收起。",
    hotkeyUnsupported: "当前桌面环境不支持全局快捷键。",
    /** 设置里有、却没注册上 */
    hotkeyTaken: "该组合键已被其他程序占用，请换一个。",
    hotkeyNone: "未设置",
    hotkeyPress: "请按下组合键",
    hotkeyOff: "关闭",
    hotkeyRestore: "恢复缺省",
    hotkeyNeedModifier: `须包含 Ctrl、Alt 或 ${isWindows ? "Win" : isLinux ? "Super" : "⌘"} 中的至少一个。`,
    /** 和界面里已有的快捷键相同 */
    hotkeyInApp: (combo: string) => `${combo} 已用于界面内的操作，请换一个。`,

    menubar: "菜单栏",
    menubarWhat: "数值为今日的 token 用量与费用。",
    menubarFull: "标识和数值",
    menubarIcon: "仅标识",
    menubarNumbers: "仅数值",
    menubarHidden: "不显示",
    /** 选了不显示时替换上面那句：窗口关着时怎么回来 */
    menubarHiddenWhat: "从访达或聚焦搜索再次打开 ThinkWatch Lite，即可显示主窗口。",
    /** 同上，设了呼出快捷键时 */
    menubarHiddenWhatHotkey: (combo: string) =>
      `按 ${combo}，或从访达、聚焦搜索再次打开 ThinkWatch Lite，即可显示主窗口。`,

    autostart: "开机启动",
    autostartWhat: isWindows
      ? "登录后仅在通知区域显示图标，不打开窗口。"
      : isLinux
        ? "登录后仅在系统托盘显示图标，不打开窗口。"
        : "登录后仅在菜单栏显示图标，不打开窗口。",
    /** 菜单栏设成不显示时（只有 macOS）：登录后什么都不出现 */
    autostartHiddenWhat: "登录后在后台运行，不打开窗口。",

    notices: "提醒",
    noticeSystem: "系统通知",
    noticeApp: "仅在应用内",
    noticeOff: "关闭",
  },
  {
    title: "General",

    language: "Language",
    languageSystem: (name: string) => `System default (${name})`,

    appearance: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
    systemNow: (name: string) => `The system is currently set to ${name.toLowerCase()}.`,

    zoom: "Interface size",
    zoomKeys: (bigger: string, smaller: string, reset: string) =>
      `Press ${bigger} to enlarge, ${smaller} to reduce, or ${reset} to reset to 100%.`,

    hotkey: "Global shortcut",
    hotkeyWhat: "Opens the main window from any app. Press it again while the window is in front to close it.",
    hotkeyUnsupported: "Global shortcuts are not supported on this desktop.",
    hotkeyTaken: "This shortcut is already used by another app. Choose another one.",
    hotkeyNone: "Not set",
    hotkeyPress: "Press a shortcut",
    hotkeyOff: "Turn Off",
    hotkeyRestore: "Restore Default",
    hotkeyNeedModifier: `The shortcut must include Ctrl, Alt or ${isWindows ? "Win" : isLinux ? "Super" : "⌘"}.`,
    hotkeyInApp: (combo: string) => `${combo} is already used in the app. Choose another one.`,

    menubar: "Menu bar",
    menubarWhat: "The numbers are today's token usage and cost.",
    menubarFull: "Icon and numbers",
    menubarIcon: "Icon only",
    menubarNumbers: "Numbers only",
    menubarHidden: "Hidden",
    menubarHiddenWhat: "To show the main window, open ThinkWatch Lite again from Finder or Spotlight.",
    menubarHiddenWhatHotkey: (combo: string) =>
      `To show the main window, press ${combo} or open ThinkWatch Lite again from Finder or Spotlight.`,

    autostart: "Launch at login",
    autostartWhat: isWindows
      ? "At login, only the icon appears in the notification area; no window opens."
      : isLinux
        ? "At login, only the icon appears in the system tray; no window opens."
        : "At login, only the icon appears in the menu bar; no window opens.",
    autostartHiddenWhat: "At login, it runs in the background; no window opens.",

    notices: "Notices",
    noticeSystem: "System notification",
    noticeApp: "In app only",
    noticeOff: "Off",
  },
);
