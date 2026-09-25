import { messages } from "@/i18n";
import { isLinux, isWindows } from "@/platform";

/** 设置 → 通用：语言、外观、菜单栏、开机启动、提醒 */
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

    menubar: "菜单栏",
    menubarWhat: "数值为今日的 token 用量与费用。",
    menubarFull: "标识和数值",
    menubarIcon: "仅标识",
    menubarNumbers: "仅数值",

    autostart: "开机启动",
    autostartWhat: isWindows
      ? "登录后仅在通知区域显示图标，不打开窗口。"
      : isLinux
        ? "登录后仅在系统托盘显示图标，不打开窗口。"
        : "登录后仅在菜单栏显示图标，不打开窗口。",

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

    menubar: "Menu bar",
    menubarWhat: "The numbers are today's token usage and cost.",
    menubarFull: "Icon and numbers",
    menubarIcon: "Icon only",
    menubarNumbers: "Numbers only",

    autostart: "Launch at login",
    autostartWhat: isWindows
      ? "At login, only the icon appears in the notification area; no window opens."
      : isLinux
        ? "At login, only the icon appears in the system tray; no window opens."
        : "At login, only the icon appears in the menu bar; no window opens.",

    notices: "Notices",
    noticeSystem: "System notification",
    noticeApp: "In app only",
    noticeOff: "Off",
  },
);
