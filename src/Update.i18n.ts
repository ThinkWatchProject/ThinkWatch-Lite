import { messages } from "@/i18n";

/**
 * 更新窗口（`UpdateWindow.tsx`）和安装进行到哪一步（`updateFlow.ts`）。设置里
 * 「关于」那一节的几句在 `settings/SettingsPage.i18n.tsx`。
 */
export const updateText = messages(
  {
    // 更新窗口
    current: (version: string) => `当前版本 ${version}`,
    available: (version: string) => `ThinkWatch Lite ${version} 可用`,
    whatsNew: "本次更新",
    closeWhileWaiting: "关闭此窗口不影响更新，更新完成后将发送通知。",
    /** 能在窗口里直接装的那几档（网页下载的、Windows 的绿色版）都是这一句 */
    standalone: "下载完成后自动安装并重新启动，进行中的请求不会中断。",
    later: "稍后",
    install: "下载并安装",
    /** 下载或安装中途失败时那条提示的标题，正文是原因 */
    failed: "未能完成更新",
    homebrew: "此应用由 Homebrew 管理，请在终端中执行以下命令完成更新：",
    command: "更新命令",
    copyFailed: "未能写入剪贴板。命令已选中，请按 ⌘C 复制。",
    copyCommand: "复制命令",
    dev: "当前运行的是开发构建，不执行自动更新。",

    // 安装进行到哪一步
    downloadingOf: (done: string, total: string) => `正在下载 ${done} / ${total} MB`,
    downloading: (done: string) => `正在下载 ${done} MB`,
    waiting: (n: number) => `等待 ${n} 个进行中的请求结束`,
    installing: "正在安装",
    restarting: "正在重新启动",
  },
  {
    current: (version: string) => `Current version: ${version}`,
    available: (version: string) => `ThinkWatch Lite ${version} is available`,
    whatsNew: "What's new",
    closeWhileWaiting: "Closing this window does not stop the update. A notification is sent when it is complete.",
    standalone:
      "Installs and restarts automatically after downloading. Requests in progress are not interrupted.",
    later: "Later",
    install: "Download and install",
    failed: "The update did not finish",
    homebrew: "This app is managed by Homebrew. To update, run this command in Terminal:",
    command: "Update command",
    copyFailed: "The clipboard could not be written to. The command is selected; press ⌘C to copy it.",
    copyCommand: "Copy command",
    dev: "This is a development build; it does not update automatically.",

    downloadingOf: (done: string, total: string) => `Downloading ${done} / ${total} MB`,
    downloading: (done: string) => `Downloading ${done} MB`,
    waiting: (n: number) =>
      n === 1
        ? "Waiting for 1 request in progress to finish"
        : `Waiting for ${n} requests in progress to finish`,
    installing: "Installing",
    restarting: "Restarting",
  },
  {
    "zh-Hant": {
      current: (version: string) => `當前版本 ${version}`,
      closeWhileWaiting: "關閉此視窗不影響更新，更新完成後將傳送通知。",
      standalone: "下載完成後自動安裝並重新啟動，進行中的請求不會中斷。",
      later: "稍後",
      install: "下載並安裝",
      homebrew: "此應用由 Homebrew 管理，請在終端中執行以下命令完成更新：",
      copyFailed: "未能寫入剪貼簿。命令已選中，請按 ⌘C 複製。",
      copyCommand: "複製命令",
      dev: "當前執行的是開發構建，不執行自動更新。",
      downloadingOf: (done: string, total: string) => `正在下載 ${done} / ${total} MB`,
      downloading: (done: string) => `正在下載 ${done} MB`,
      waiting: (n: number) => `等待 ${n} 個進行中的請求結束`,
      installing: "正在安裝",
      restarting: "正在重新啟動",
    },
    ja: {
      current: (version: string) => `現在のバージョン：${version}`,
      available: (version: string) => `ThinkWatch Lite ${version} を利用できます`,
      whatsNew: "更新内容",
      closeWhileWaiting: "このウィンドウを閉じても更新は続行されます。完了すると通知が届きます。",
      standalone: "ダウンロード後に自動でインストールして再起動します。処理中のリクエストは中断されません。",
      later: "あとで",
      install: "ダウンロードしてインストール",
      failed: "更新を完了できませんでした",
      homebrew: "このアプリは Homebrew で管理されています。ターミナルで次のコマンドを実行して更新してください。",
      command: "更新コマンド",
      copyFailed: "クリップボードにコピーできませんでした。選択されたコマンドを ⌘C でコピーしてください。",
      copyCommand: "コマンドをコピー",
      dev: "開発ビルドでは自動更新を利用できません。",
      downloadingOf: (done: string, total: string) => `ダウンロード中 ${done} / ${total} MB`,
      downloading: (done: string) => `ダウンロード中 ${done} MB`,
      waiting: (n: number) => `処理中のリクエスト ${n} 件の完了を待っています`,
      installing: "インストール中",
      restarting: "再起動中",
    },
    ko: {
      current: (version: string) => `현재 버전: ${version}`,
      available: (version: string) => `ThinkWatch Lite ${version}을(를) 사용할 수 있습니다`,
      whatsNew: "업데이트 내용",
      closeWhileWaiting: "이 창을 닫아도 업데이트는 계속됩니다. 완료되면 알림을 보냅니다.",
      standalone: "다운로드 후 자동으로 설치하고 다시 시작합니다. 진행 중인 요청은 계속 처리됩니다.",
      later: "나중에",
      install: "다운로드 및 설치",
      failed: "업데이트를 완료하지 못했습니다.",
      homebrew: "이 앱은 Homebrew에서 관리합니다. 업데이트하려면 터미널에서 다음 명령을 실행하세요.",
      command: "업데이트 명령",
      copyFailed: "클립보드에 복사할 수 없습니다. 명령이 선택되어 있으니 ⌘C를 눌러 복사하세요.",
      copyCommand: "명령 복사",
      dev: "개발 빌드는 자동으로 업데이트되지 않습니다.",
      downloadingOf: (done: string, total: string) => `다운로드 중 ${done} / ${total} MB`,
      downloading: (done: string) => `다운로드 중 ${done} MB`,
      waiting: (n: number) => n === 1
        ? "진행 중인 요청 1건의 완료를 기다리는 중"
        : `진행 중인 요청 ${n}건의 완료를 기다리는 중`,
      installing: "설치 중",
      restarting: "다시 시작 중",
    },
    es: {
      current: (version: string) => `Versión actual: ${version}`,
      available: (version: string) => `ThinkWatch Lite ${version} está disponible`,
      whatsNew: "Novedades",
      closeWhileWaiting: "La actualización continúa si cierras esta ventana. Recibirás un aviso al terminar.",
      standalone: "Tras la descarga, la aplicación se instala y reinicia automáticamente. Las solicitudes en curso continúan.",
      later: "Más tarde",
      install: "Descargar e instalar",
      failed: "No se completó la actualización.",
      homebrew: "Homebrew gestiona esta aplicación. Para actualizarla, ejecuta este comando en Terminal:",
      command: "Comando de actualización",
      copyFailed: "No se pudo copiar al portapapeles. Pulsa ⌘C para copiar el comando seleccionado.",
      copyCommand: "Copiar comando",
      dev: "Las compilaciones de desarrollo no se actualizan automáticamente.",
      downloadingOf: (done: string, total: string) => `Descargando ${done} / ${total} MB`,
      downloading: (done: string) => `Descargando ${done} MB`,
      waiting: (n: number) => n === 1
        ? "Esperando a que termine 1 solicitud en curso"
        : `Esperando a que terminen ${n} solicitudes en curso`,
      installing: "Instalando",
      restarting: "Reiniciando",
    },
  },
);
