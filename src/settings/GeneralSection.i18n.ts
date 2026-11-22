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
  {
    "zh-Hant": {
      language: "語言",
      languageSystem: (name: string) => `依照系統（${name}）`,
      appearance: "外觀",
      system: "跟隨系統",
      light: "淺色",
      systemNow: (name: string) => `系統當前為${name}。`,
      zoom: "介面大小",
      zoomKeys: (bigger: string, smaller: string, reset: string) => `按 ${bigger} 放大、${smaller} 縮小，${reset} 恢復為 100%。`,
      hotkey: "全域快捷鍵",
      hotkeyWhat: "在任意程式中按下即可開啟主介面，主介面在最前時再按一次收起。",
      hotkeyUnsupported: "當前桌面環境不支援全域性快捷鍵。",
      hotkeyTaken: "該組合鍵已被其他程式佔用，請換一個。",
      hotkeyNone: "未設定",
      hotkeyPress: "請按下組合鍵",
      hotkeyOff: "關閉",
      hotkeyRestore: "恢復預設",
      hotkeyNeedModifier: `須包含 Ctrl、Alt 或 ${isWindows ? "Win" : isLinux ? "Super" : "⌘"} 中的至少一個。`,
      hotkeyInApp: (combo: string) => `${combo} 已用於介面內的操作，請換一個。`,
      menubar: "選單列",
      menubarWhat: "數值為今日的 token 用量與費用。",
      menubarFull: "圖示和數值",
      menubarIcon: "僅圖示",
      menubarNumbers: "僅數值",
      menubarHidden: "不顯示",
      menubarHiddenWhat: "從 Finder 或 Spotlight 再次開啟 ThinkWatch Lite，即可顯示主視窗。",
      menubarHiddenWhatHotkey: (combo: string) => `按 ${combo}，或從 Finder 或 Spotlight 再次開啟 ThinkWatch Lite，即可顯示主視窗。`,
      autostart: "登入時啟動",
      autostartWhat: isWindows
        ? "登入後僅在通知區域顯示圖示，不開啟視窗。"
        : isLinux
          ? "登入後僅在系統匣顯示圖示，不開啟視窗。"
          : "登入後僅在選單列顯示圖示，不開啟視窗。",
      autostartHiddenWhat: "登入後在後臺執行，不開啟視窗。",
      noticeSystem: "系統通知",
      noticeApp: "僅在應用內",
      noticeOff: "關閉",
    },
    ja: {
      title: "一般",
      language: "言語",
      languageSystem: (name: string) => `システムに従う（${name}）`,
      appearance: "外観",
      system: "システムに従う",
      light: "ライト",
      dark: "ダーク",
      systemNow: (name: string) => `現在のシステム設定は「${name}」です。`,
      zoom: "表示サイズ",
      zoomKeys: (bigger: string, smaller: string, reset: string) => `${bigger} で拡大、${smaller} で縮小、${reset} で 100% に戻します。`,
      hotkey: "グローバルショートカット",
      hotkeyWhat: "どのアプリからでもメインウィンドウを開けます。最前面でもう一度押すと閉じます。",
      hotkeyUnsupported: "このデスクトップ環境はグローバルショートカットに対応していません。",
      hotkeyTaken: "このショートカットは別のアプリで使用されています。別の組み合わせを選んでください。",
      hotkeyNone: "未設定",
      hotkeyPress: "キーの組み合わせを入力",
      hotkeyOff: "オフにする",
      hotkeyRestore: "初期設定に戻す",
      hotkeyNeedModifier: `Ctrl、Alt、${isWindows ? "Win" : isLinux ? "Super" : "⌘"} のいずれかを含めてください。`,
      hotkeyInApp: (combo: string) => `${combo} はアプリ内で使用されています。別の組み合わせを選んでください。`,
      menubar: "メニューバー",
      menubarWhat: "今日のトークン使用量と費用を表示します。",
      menubarFull: "アイコンと数値",
      menubarIcon: "アイコンのみ",
      menubarNumbers: "数値のみ",
      menubarHidden: "非表示",
      menubarHiddenWhat: "Finder または Spotlight から ThinkWatch Lite を開くと、メインウィンドウを表示できます。",
      menubarHiddenWhatHotkey: (combo: string) => `${combo} を押すか、Finder または Spotlight から ThinkWatch Lite を開くと、メインウィンドウを表示できます。`,
      autostart: "ログイン時に起動",
      autostartWhat: isWindows
        ? "ログイン時に通知領域にアイコンを表示します。ウィンドウは開きません。"
        : isLinux
          ? "ログイン時にシステムトレイにアイコンを表示します。ウィンドウは開きません。"
          : "ログイン時にメニューバーにアイコンを表示します。ウィンドウは開きません。",
      autostartHiddenWhat: "ログイン時にバックグラウンドで起動します。",
      notices: "通知",
      noticeSystem: "システム通知",
      noticeApp: "アプリ内のみ",
      noticeOff: "オフ",
    },
    ko: {
      title: "일반",
      language: "언어",
      languageSystem: (name: string) => `시스템 설정 따르기(${name})`,
      appearance: "모양",
      system: "시스템 설정",
      light: "라이트",
      dark: "다크",
      systemNow: (name: string) => `현재 시스템 설정: ${name.toLowerCase()}.`,
      zoom: "화면 크기",
      zoomKeys: (bigger: string, smaller: string, reset: string) => `${bigger}으로 확대하고 ${smaller}으로 축소합니다. ${reset}을(를) 누르면 100%로 돌아갑니다.`,
      hotkey: "전역 단축키",
      hotkeyWhat: "어느 앱에서든 기본 창을 엽니다. 창이 앞에 있을 때 한 번 더 누르면 닫힙니다.",
      hotkeyUnsupported: "이 데스크톱 환경에서는 전역 단축키를 지원하지 않습니다.",
      hotkeyTaken: "다른 앱에서 이 단축키를 사용 중입니다. 다른 조합을 선택하세요.",
      hotkeyNone: "설정되지 않음",
      hotkeyPress: "단축키를 누르세요",
      hotkeyOff: "끄기",
      hotkeyRestore: "기본값 복원",
      hotkeyNeedModifier: `Ctrl, Alt, ${isWindows ? "Win" : isLinux ? "Super" : "⌘"} 중 하나 이상을 포함해야 합니다.`,
      hotkeyInApp: (combo: string) => `앱에서 이미 ${combo}을(를) 사용 중입니다. 다른 조합을 선택하세요.`,
      menubar: "메뉴 막대",
      menubarWhat: "오늘의 토큰 사용량과 비용을 표시합니다.",
      menubarFull: "아이콘 및 숫자",
      menubarIcon: "아이콘만",
      menubarNumbers: "숫자만",
      menubarHidden: "숨김",
      menubarHiddenWhat: "Finder 또는 Spotlight에서 ThinkWatch Lite를 다시 열면 기본 창을 표시합니다.",
      menubarHiddenWhatHotkey: (combo: string) => `${combo}을(를) 누르거나 Finder 또는 Spotlight에서 ThinkWatch Lite를 다시 열면 기본 창을 표시합니다.`,
      autostart: "로그인 시 실행",
      autostartWhat: isWindows
        ? "로그인하면 알림 영역에 아이콘만 표시합니다. 창은 열리지 않습니다."
        : isLinux
          ? "로그인하면 시스템 트레이에 아이콘만 표시합니다. 창은 열리지 않습니다."
          : "로그인하면 메뉴 막대에 아이콘만 표시합니다. 창은 열리지 않습니다.",
      autostartHiddenWhat: "로그인하면 백그라운드에서 실행됩니다.",
      notices: "알림",
      noticeSystem: "시스템 알림",
      noticeApp: "앱 내에서만",
      noticeOff: "끄기",
    },
    es: {
      language: "Idioma",
      languageSystem: (name: string) => `Seguir al sistema (${name})`,
      appearance: "Apariencia",
      system: "Sistema",
      light: "Claro",
      dark: "Oscuro",
      systemNow: (name: string) => `El sistema está en modo ${name.toLowerCase()}.`,
      zoom: "Tamaño de la interfaz",
      zoomKeys: (bigger: string, smaller: string, reset: string) => `Pulsa ${bigger} para ampliar, ${smaller} para reducir o ${reset} para volver al 100%.`,
      hotkey: "Atajo global",
      hotkeyWhat: "Abre la ventana principal desde cualquier aplicación. Púlsalo de nuevo cuando la ventana esté al frente para cerrarla.",
      hotkeyUnsupported: "Este entorno de escritorio no admite atajos globales.",
      hotkeyTaken: "Otra aplicación ya usa este atajo. Elige otro.",
      hotkeyNone: "Sin configurar",
      hotkeyPress: "Pulsa un atajo",
      hotkeyOff: "Desactivar",
      hotkeyRestore: "Restaurar valor predeterminado",
      hotkeyNeedModifier: `El atajo debe incluir Ctrl, Alt o ${isWindows ? "Ganar" : isLinux ? "Super" : "⌘"}.`,
      hotkeyInApp: (combo: string) => `La aplicación ya usa ${combo}. Elige otro atajo.`,
      menubar: "Barra de menús",
      menubarWhat: "Muestra el uso de tokens y el coste de hoy.",
      menubarFull: "Icono y cifras",
      menubarIcon: "Solo icono",
      menubarNumbers: "Solo cifras",
      menubarHidden: "Oculto",
      menubarHiddenWhat: "Para mostrar la ventana principal, vuelve a abrir ThinkWatch Lite desde Finder o Spotlight.",
      menubarHiddenWhatHotkey: (combo: string) => `Para mostrar la ventana principal, pulsa ${combo} o vuelve a abrir ThinkWatch Lite desde Finder o Spotlight.`,
      autostart: "Abrir al iniciar sesión",
      autostartWhat: isWindows
        ? "Al iniciar sesión, solo aparece el icono en el área de notificación."
        : isLinux
          ? "Al iniciar sesión, solo aparece el icono en la bandeja del sistema."
          : "Al iniciar sesión, solo aparece el icono en la barra de menús.",
      autostartHiddenWhat: "La aplicación se ejecuta en segundo plano al iniciar sesión.",
      notices: "Avisos",
      noticeSystem: "Notificaciones del sistema",
      noticeApp: "Solo en la aplicación",
      noticeOff: "Desactivado",
    },
  },
);
