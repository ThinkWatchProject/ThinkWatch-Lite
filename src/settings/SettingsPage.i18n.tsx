import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isMac, isWindows } from "@/platform";

/** 句中要套一层组件（悬浮说明、加粗）的那一段 */
type Wrap = (text: string) => ReactNode;

/** 这台机器叫什么。和远程模式那几句（`remote.i18n.tsx`）同一个说法 */
const hereZh = isMac ? "这台 Mac" : "这台电脑";
const hereEn = isMac ? "This Mac" : "This computer";

/**
 * 卸载做完之后用户还要做的那一步，按平台说。`portable`：Windows 的绿色版，数据也在那个
 * 文件夹里，删掉整个文件夹就行
 */
const afterZh = (portable: boolean) =>
  isMac
    ? "完成后即可将应用移到废纸篓。"
    : portable
      ? "完成后即可删除整个文件夹。"
      : isWindows
        ? "完成后即可卸载或删除应用。"
        : "完成后即可删除应用。";
const afterEn = (portable: boolean) =>
  isMac
    ? "Once it finishes, the app can be moved to the Trash."
    : portable
      ? "Once it finishes, the whole folder can be deleted."
      : isWindows
        ? "Once it finishes, the app can be uninstalled or deleted."
        : "Once it finishes, the app can be deleted.";

/**
 * 「完全卸载」那一行的说明里，哪种删法**不会**还原客户端。Windows 的安装版不在里面：
 * 系统卸载程序会先做同样的几步（`src-tauri/windows/hooks.nsh`）
 */
const skippedByZh = (portable: boolean) =>
  isMac
    ? "直接将应用移到废纸篓不会执行这些操作"
    : portable
      ? "直接删除文件夹不会执行这些操作"
      : isWindows
        ? null
        : "直接删除应用不会执行这些操作";
const skippedByEn = (portable: boolean) =>
  isMac
    ? "Moving the app straight to the Trash does neither"
    : portable
      ? "Deleting the folder directly does neither"
      : isWindows
        ? null
        : "Deleting the app directly does neither";

/**
 * 设置页：页头、目录、「关于」和「卸载」两节。其余各节的文案在各自的词表里
 * （`GeneralSection.i18n.ts`、`ListenSection.i18n.ts`、`FailoverSection.i18n.ts`、`RetentionSection.i18n.ts`、
 * `connection/connection.i18n.tsx`）。
 */
export const settingsText = messages(
  {

    // 页头的摘要
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
    uninstallIntro: (em: Wrap, portable: boolean) => {
      const skipped = skippedByZh(portable);
      return skipped ? (
        <>
          还原所有已接管的客户端，并取消开机启动。
          {em(skipped)}，已接管的客户端将指向一个无人监听的端口。
        </>
      ) : (
        <>还原所有已接管的客户端，并取消开机启动。通过系统卸载 ThinkWatch Lite 时也会执行这些操作。</>
      );
    },
    uninstallAction: "卸载…",
    willDo: (portable: boolean) => `将执行以下操作。${afterZh(portable)}`,
    restoreClients: "还原已接管的客户端",
    restoreNone: "当前无已接管的客户端",
    /** 列名字时的分隔 */
    sep: "、",
    /** WSL 里的那个客户端。和卸载结果里那一行（Rust 侧 `wsl::display_name`）同一个写法 */
    wslClient: (client: string, distro: string) => `${client} (WSL · ${distro})`,
    stopAutostart: "取消开机启动",
    /** `.wslconfig` 是在客户端页改成 mirrored 的：卸载不改回它 */
    wslconfigKept: "WSL 的网络模式不会改回",
    wslconfigCreated: (path: string) => `${path} 是改为 mirrored 网络模式时新建的，卸载后保留。`,
    wslconfigBackup: (path: string, backup: string) =>
      `${path} 保持 mirrored 网络模式；修改前的备份保留在 ${backup}。`,
    wslconfigBackupDropped: (path: string) =>
      `${path} 保持 mirrored 网络模式；修改前的备份随数据目录一并删除。`,
    dropData: "同时删除数据目录",
    dropDataWhat: "包括请求历史、费用记录与配置备份，删除后无法恢复。",
    confirmUninstall: "卸载",
    uninstalled: "卸载完成",
    uninstalledWithFailures: (n: number) => `卸载已结束，${n} 项未成功`,
    stepFailed: "未成功",
    uninstallFailed: "未能完成卸载",
    uninstalledRow: "已完成卸载。",
  },
  {

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
    uninstallIntro: (em: Wrap, portable: boolean) => {
      const skipped = skippedByEn(portable);
      return skipped ? (
        <>
          Restores every connected client and turns off launch at login. {em(skipped)}, leaving connected clients
          pointed at a port where nothing is listening.
        </>
      ) : (
        <>
          Restores every connected client and turns off launch at login. Uninstalling ThinkWatch Lite through the system
          does the same.
        </>
      );
    },
    uninstallAction: "Uninstall…",
    willDo: (portable: boolean) => `The following is done. ${afterEn(portable)}`,
    restoreClients: "Restore connected clients",
    restoreNone: "No client is connected at the moment",
    sep: ", ",
    wslClient: (client: string, distro: string) => `${client} (WSL · ${distro})`,
    stopAutostart: "Turn off launch at login",
    wslconfigKept: "WSL networking is not changed back",
    wslconfigCreated: (path: string) => `${path} was created when switching to mirrored networking and is kept.`,
    wslconfigBackup: (path: string, backup: string) =>
      `${path} stays on mirrored networking; the backup from before the change is kept at ${backup}.`,
    wslconfigBackupDropped: (path: string) =>
      `${path} stays on mirrored networking; the backup from before the change is deleted with the data directory.`,
    dropData: "Also delete the data directory",
    dropDataWhat: "The request history, cost records and config backups. This cannot be undone.",
    confirmUninstall: "Uninstall",
    uninstalled: "Uninstall complete",
    uninstalledWithFailures: (n: number) => (n === 1 ? "Uninstall finished; 1 step failed" : `Uninstall finished; ${n} steps failed`),
    stepFailed: "Failed",
    uninstallFailed: "The uninstall did not finish",
    uninstalledRow: "The uninstall is complete.",
  },
  {
    "zh-Hant": {
      notListening: "未在監聽",
      scopeLocal: "僅本機",
      scopeLan: "區域網",
      scopeAll: "所有網絡卡",
      here: (isMac ? "這臺 Mac" : "這臺電腦"),
      about: "關於",
      checking: "正在檢查更新",
      checkFailed: "檢查更新失敗",
      checkNow: "檢查更新",
      devBuild: "開發構建",
      autoCheck: "自動檢查新版本",
      dataDir: "資料目錄",
      coreBin: "core 二進位制",
      diagnostics: "診斷包",
      diagnosticsBody: (tip: Wrap) => (<>
        包含版本、上游、熔斷狀態、近期失敗記錄與脫敏後的配置檔案。{tip("不含請求與回應正文")}。
       </>),
      diagnosticsTip: "不包含請求本文與回應本文，其中可能含有使用者貼上的內容。",
      diagnosticsOffline: "連線到 core 後可生成診斷包。",
      review: (em: Wrap) => <>其中的金鑰與地址已脫敏，{em("提交前請自行核對")}。</>,
      uninstall: "解除安裝",
      uninstallTitle: "完全解除安裝",
      uninstallIntro: (em: Wrap, portable: boolean) => {
        const skipped = ((portable: boolean) => isMac
          ? "直接將應用移到廢紙簍不會執行這些操作"
          : portable
            ? "直接刪除資料夾不會執行這些操作"
            : isWindows
              ? null
              : "直接刪除應用不會執行這些操作")(portable);
        return skipped ? (<>
         還原所有已接管的用戶端，並取消開機啟動。
         {em(skipped)}，已接管的用戶端將指向一個無人監聽的埠。
        </>) : (<>還原所有已接管的用戶端，並取消開機啟動。透過系統解除安裝 ThinkWatch Lite 時也會執行這些操作。</>);
      },
      uninstallAction: "解除安裝…",
      willDo: (portable: boolean) => `將執行以下操作。${((portable: boolean) => isMac
        ? "完成後即可將應用移到廢紙簍。"
        : portable
          ? "完成後即可刪除整個資料夾。"
          : isWindows
            ? "完成後即可解除安裝或刪除應用。"
            : "完成後即可刪除應用。")(portable)}`,
      restoreClients: "還原已接管的用戶端",
      restoreNone: "當前無已接管的用戶端",
      stopAutostart: "取消開機啟動",
      wslconfigKept: "WSL 的網路模式不會改回",
      wslconfigCreated: (path: string) => `${path} 是改為 mirrored 網路模式時新建的，解除安裝後保留。`,
      wslconfigBackup: (path: string, backup: string) => `${path} 保持 mirrored 網路模式；修改前的備份保留在 ${backup}。`,
      wslconfigBackupDropped: (path: string) => `${path} 保持 mirrored 網路模式；修改前的備份隨資料目錄一併刪除。`,
      dropData: "同時刪除資料目錄",
      dropDataWhat: "包括請求歷史、費用記錄與配置備份，刪除後無法恢復。",
      confirmUninstall: "解除安裝",
      uninstalled: "解除安裝完成",
      uninstalledWithFailures: (n: number) => `解除安裝已結束，${n} 項未成功`,
      uninstallFailed: "未能完成解除安裝",
      uninstalledRow: "已完成解除安裝。",
    },
    ja: {
      notListening: "リッスンしていません",
      scopeLocal: "この端末のみ",
      scopeLan: "ローカルネットワーク",
      scopeAll: "すべてのインターフェイス",
      versionIs: (v: string) => `バージョン ${v}`,
      available: "利用可能",
      here: isMac ? "この Mac" : "この端末",
      about: "アプリについて",
      updates: "更新",
      appName: "ThinkWatch Lite",
      latest: "最新バージョンです",
      newer: (v: string) => `バージョン ${v} を利用できます`,
      checking: "更新を確認しています",
      checkFailed: "更新の確認に失敗しました",
      checkNow: "更新を確認",
      updateTo: (v: string) => `${v} に更新…`,
      homebrew: "Homebrew",
      devBuild: "開発ビルド",
      autoCheck: "更新を自動で確認",
      dataDir: "データディレクトリ",
      coreBin: "core バイナリ",
      diagnostics: "診断情報",
      diagnosticsBody: (tip: Wrap) => <>
       バージョン、アップストリーム、サーキットブレーカーの状態、最近の失敗、機密情報を伏せた設定ファイルを含みます。{tip("リクエストとレスポンスの本文は含みません")}。
      </>,
      diagnosticsTip: "リクエストとレスポンスの本文には、ユーザーが貼り付けた内容が含まれる可能性があるため、収集対象から除外しています。",
      generate: "作成",
      generated: "作成しました",
      diagnosticsOffline: "core に接続すると診断情報を作成できます。",
      review: (em: Wrap) => <>キーとアドレスは伏せています。{em("共有前に内容を確認してください")}。</>,
      uninstall: "アンインストール",
      uninstallTitle: "完全にアンインストール",
      uninstallIntro: (em: Wrap, portable: boolean) => {
        const skipped = isMac ? "アプリを直接ゴミ箱に移動する" : portable ? "フォルダーを直接削除する" : !isWindows ? "アプリを直接削除する" : null;
        return skipped ? <>
        接続済みクライアントの設定を復元し、ログイン時の起動を無効にします。
        {em(skipped)}だけではクライアントの設定が復元されず、接続できなくなります。
       </> : <>接続済みクライアントの設定を復元し、ログイン時の起動を無効にします。システムから ThinkWatch Lite をアンインストールしても同じ処理が行われます。</>;
      },
      uninstallAction: "アンインストール…",
      willDo: (portable: boolean) => `以下の操作を行います。完了後は${isMac ? "アプリをゴミ箱に移動" : portable ? "フォルダーごと削除" : isWindows ? "アプリをアンインストールまたは削除" : "アプリを削除"}できます。`,
      restoreClients: "接続済みクライアントの設定を復元",
      restoreNone: "接続済みのクライアントはありません",
      sep: "、",
      wslClient: (client: string, distro: string) => `${client} (WSL · ${distro})`,
      stopAutostart: "ログイン時の起動を無効にする",
      wslconfigKept: "WSL のネットワークモードを維持",
      wslconfigCreated: (path: string) => `ミラーモードへの切り替え時に作成した ${path} は保持されます。`,
      wslconfigBackup: (path: string, backup: string) => `${path} はミラーモードのままです。変更前のバックアップは ${backup} に保存されます。`,
      wslconfigBackupDropped: (path: string) => `${path} はミラーモードのままです。変更前のバックアップはデータディレクトリとともに削除されます。`,
      dropData: "データディレクトリも削除",
      dropDataWhat: "リクエスト履歴、費用の記録、設定のバックアップが削除されます。この操作は元に戻せません。",
      confirmUninstall: "アンインストール",
      uninstalled: "アンインストール完了",
      uninstalledWithFailures: (n: number) => `アンインストール処理が終了しました（失敗 ${n} 件）`,
      stepFailed: "失敗",
      uninstallFailed: "アンインストールを完了できませんでした",
      uninstalledRow: "アンインストールが完了しました。",
    },
    ko: {
      notListening: "수신 대기 중 아님",
      scopeLocal: "이 컴퓨터만",
      scopeLan: "로컬 네트워크",
      scopeAll: "모든 네트워크 인터페이스",
      versionIs: (v: string) => `버전 ${v}`,
      here: (isMac ? "이 Mac" : "이 컴퓨터"),
      about: "정보",
      updates: "업데이트",
      latest: "최신 버전",
      newer: (v: string) => `버전 ${v}을(를) 사용할 수 있습니다`,
      checking: "업데이트 확인 중",
      checkFailed: "업데이트 확인 실패",
      checkNow: "업데이트 확인",
      updateTo: (v: string) => `${v}(으)로 업데이트…`,
      devBuild: "개발 빌드",
      autoCheck: "업데이트 자동 확인",
      dataDir: "데이터 디렉터리",
      coreBin: "core 실행 파일",
      diagnostics: "진단 패키지",
      diagnosticsBody: (tip: Wrap) => (<>
        Contains the version, upstreams, circuit breaker states, recent failures and the redacted config file.{" "}
        {tip("요청 및 응답 본문 제외")}.
       </>),
      diagnosticsTip: "사용자가 붙여넣은 내용이 들어 있을 수 있어 요청 및 응답 본문은 포함되지 않습니다.",
      generate: "생성",
      generated: "생성됨",
      diagnosticsOffline: "core에 연결하면 진단 패키지를 만들 수 있습니다.",
      review: (em: Wrap) => <>Keys and addresses in it are redacted; {em("공유하기 전에 내용을 확인하세요")}.</>,
      uninstall: "제거",
      uninstallTitle: "완전히 제거",
      uninstallAction: "제거…",
      restoreClients: "연결된 클라이언트 복원",
      restoreNone: "현재 연결된 클라이언트가 없습니다.",
      stopAutostart: "로그인 시 실행 끄기",
      dropData: "데이터 디렉터리도 삭제",
      dropDataWhat: "요청 기록, 비용 기록, 설정 백업을 삭제합니다. 이 작업은 되돌릴 수 없습니다.",
      confirmUninstall: "제거",
      uninstalled: "제거 완료",
      stepFailed: "실패",
      uninstallFailed: "제거를 완료하지 못했습니다.",
      uninstalledRow: "제거가 완료되었습니다.",
    },
    es: {
      notListening: "Sin escucha",
      scopeLocal: "Solo este equipo",
      scopeLan: "Red local",
      scopeAll: "Todas las interfaces",
      versionIs: (v: string) => `Versión ${v}`,
      available: "disponible",
      here: (isMac ? "Este Mac" : "Este equipo"),
      about: "Acerca de",
      updates: "Actualizaciones",
      latest: "Al día",
      newer: (v: string) => `Hay una nueva versión disponible (${v})`,
      checking: "Buscando actualizaciones",
      checkFailed: "Error al buscar actualizaciones",
      checkNow: "Buscar actualizaciones",
      updateTo: (v: string) => `Actualizar a ${v}…`,
      devBuild: "Compilación de desarrollo",
      autoCheck: "Buscar actualizaciones automáticamente",
      dataDir: "Directorio de datos",
      coreBin: "Ejecutable de core",
      diagnostics: "Paquete de diagnóstico",
      diagnosticsBody: (tip: Wrap) => (<>
        Contiene la versión, del proveedor, estados de disyuntor, fallos recientes y el archivo de configuraciónuración redactado.{" "}
        {tip("Sin cuerpos de solicitudes ni respuestas")}.
       </>),
      diagnosticsTip: "Se excluyen los cuerpos de las solicitudes y respuestas porque pueden incluir contenido pegado por el usuario.",
      generate: "Generar",
      generated: "Generado",
      diagnosticsOffline: "Conéctate a un core para generar un paquete de diagnóstico.",
      review: (em: Wrap) => <>Se redactan las claves y direcciones; {em("revísalo antes de compartirlo")}.</>,
      uninstall: "Desinstalar",
      uninstallTitle: "Desinstalación completa",
      uninstallIntro: (em: Wrap, portable: boolean) => {
        const skipped = ((portable: boolean) => isMac
          ? "Mover la aplicación directamente a la papelera no hace ninguna de las dos cosas"
          : portable
            ? "Eliminar la carpeta directamente no hace ninguna de las dos cosas"
            : isWindows
              ? null
              : "Eliminar la aplicación directamente no hace ninguno de los dos")(portable);
        return skipped ? (<>
         Restaura cada cliente conectado y desactiva el lanzamiento en el inicio de sesión. {em(skipped)}, leaving connected clients
         pointed at a port where nothing is listening.
        </>) : (<>
         Restores every connected client and turns off launch at login. Uninstalling ThinkWatch Lite through the system
         does the same.
        </>);
      },
      uninstallAction: "Desinstalar…",
      willDo: (portable: boolean) => `Lo siguiente está hecho. ${((portable: boolean) => isMac
        ? "Una vez que termina, la aplicación se puede mover a la Papelera."
        : portable
          ? "Una vez que termina, se puede eliminar toda la carpeta."
          : isWindows
            ? "Una vez que termina, la aplicación puede ser desinstalada o eliminada."
            : "Una vez que termina, la aplicación se puede eliminar.")(portable)}`,
      restoreClients: "Restaurar los clientes conectados",
      restoreNone: "No hay clientes conectados.",
      stopAutostart: "Desactivar la apertura al iniciar sesión",
      wslconfigKept: "La red WSL no se cambia de nuevo",
      wslconfigCreated: (path: string) => `${path} fue creado al cambiar a redes reflejadas y se mantiene.`,
      wslconfigBackup: (path: string, backup: string) => `${path} se mantiene en red reflejada; la copia de seguridad de antes de que el cambio se mantenga en ${backup}.`,
      wslconfigBackupDropped: (path: string) => `${path} se mantiene en la red reflejada; la copia de seguridad de antes de que el cambio se elimina con el directorio de datos.`,
      dropData: "Eliminar también el directorio de datos",
      dropDataWhat: "Se eliminarán el historial de solicitudes, los registros de costes y las copias de configuración. Esta acción es irreversible.",
      confirmUninstall: "Desinstalar",
      uninstalled: "Desinstalación completa",
      uninstalledWithFailures: (n: number) => (n === 1 ? "Desinstalar terminado; 1 paso ha fallado" : `Desinstalar terminado; ${n} los pasos fallaron`),
      stepFailed: "Error",
      uninstallFailed: "No se completó la desinstalación.",
      uninstalledRow: "La desinstalación ha terminado.",
    },
  },
);

