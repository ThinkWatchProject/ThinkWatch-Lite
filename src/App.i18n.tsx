import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子中间要加重的那几个字。怎么画由组件决定，这里只管是哪几个字、在句子的哪儿 */
type Em = (text: string) => ReactNode;

/** 英文的单复数：`count(3, "request", "requests")` 是 `3 requests` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 主窗口外壳的文案：源列表、工具栏、状态带、退出确认。流量页的在 `traffic/Traffic.i18n.tsx`。
 *
 * `.tsx`：有几句话中间嵌着地址（`<code>`）、上游名或加粗的片段，而它们在
 * 中英文句子里的位置不同 —— 片段由组件画好传进来，放在哪儿由句子自己决定。
 */
export const appText = messages(
  {
    /** 源列表的各项，也是工具栏上「当前在哪一页」 */
    surfaces: {
      dashboard: "概览",
      requests: "流量",
      security: "安全",
      upstreams: "上游",
      routing: "路由",
      clients: "客户端",
      keys: "密钥",
      mcp: "MCP",
      plugins: "插件",
      settings: "设置",
    },
    newFindings: (label: string, n: number) => `${label} · ${n} 项新发现`,
    listenStale: (why: string) => `监听设置未生效：${why}`,

    // core 的状态。`…Short` 给收起的源列表用，那里只有 80px
    running: "运行中",
    starting: "启动中",
    restarting: (attempt: string) => `重启中（第 ${attempt} 次）`,
    restartingShort: "重启中",
    safeMode: "安全模式 · 网关未运行",
    safeModeShort: "安全模式",
    stopped: "已停止",
    cannotStart: "无法启动",

    // 工具栏
    collapseRail: "收起源列表",
    expandRail: "展开源列表",
    configFile: "配置文件",
    /** 原来的「版本历史」：备份取代了修改记录（`src/backup/BackupsDialog.tsx`） */
    versionHistory: "备份",

    // 配置没通过校验。`rejectedAt` 后面直接接 core 给的那句错误
    rejectedTitle: "配置校验未通过，仍在使用上一版本",
    rejectedAt: (stage: string, line: number | null) =>
      `${stage}错误${line != null ? `（第 ${line} 行）` : ""}：`,

    // token 端点换发了新凭据但没写回
    rotatedUnsaved: (provider: string) => `${provider} 已换发新凭据，但未能写回 config.yaml。当前转发正常。`,
    oldRevoked: (em: Em) => <>原凭据已在服务端失效。{em("重启前如未处理，该上游的请求将持续返回 401")}。</>,

    // 断线重连
    staleData: (what: string) => `${what} · 以下数据截至连接断开时`,
    restart: "重新启动",
  },
  {
    surfaces: {
      dashboard: "Overview",
      requests: "Traffic",
      security: "Security",
      upstreams: "Upstreams",
      routing: "Routing",
      clients: "Clients",
      keys: "Keys",
      mcp: "MCP",
      plugins: "Plugins",
      settings: "Settings",
    },
    newFindings: (label: string, n: number) => `${label} · ${count(n, "new finding", "new findings")}`,
    listenStale: (why: string) => `The listen settings did not take effect: ${why}`,

    // 展开的源列表里这一行约 167px，收起时约 51px：「Gateway stopped」比
    // 「Gateway not running」短一截才放得下；「Safe mode」中间是不换行空格，
    // 收起时不会折成两行
    running: "Running",
    starting: "Starting",
    restarting: (attempt: string) => `Restarting (attempt ${attempt})`,
    restartingShort: "Restarting",
    safeMode: "Safe mode · Gateway stopped",
    safeModeShort: "Safe\u00a0mode",
    stopped: "Stopped",
    cannotStart: "Cannot start",

    collapseRail: "Collapse sidebar",
    expandRail: "Expand sidebar",
    configFile: "Config file",
    versionHistory: "Backups",

    rejectedTitle: "Config validation failed; the previous version is still in use",
    rejectedAt: (stage: string, line: number | null) => `${stage} error${line != null ? ` (line ${line})` : ""}: `,

    rotatedUnsaved: (provider: string) =>
      `${provider} issued new credentials, but they could not be written back to config.yaml. Forwarding currently works normally.`,
    oldRevoked: (em: Em) => (
      <>
        The previous credentials are no longer valid on the server.{" "}
        {em("Unless this is resolved before the next restart, requests to this upstream will keep returning 401")}.
      </>
    ),

    staleData: (what: string) => `${what} · Data below is as of the disconnect`,
    restart: "Restart",
  },
  {
    "zh-Hant": {
      surfaces: {
        dashboard: "概覽",
        requests: "流量",
        security: "安全",
        upstreams: "上游",
        routing: "路由",
        clients: "用戶端",
        keys: "金鑰",
        mcp: "MCP",
        plugins: "外掛",
        settings: "設定",
      },
      newFindings: (label: string, n: number) => `${label} · ${n} 項新發現`,
      listenStale: (why: string) => `監聽設定未生效：${why}`,
      running: "執行中",
      starting: "啟動中",
      restarting: (attempt: string) => `重啟中（第 ${attempt} 次）`,
      restartingShort: "重啟中",
      safeMode: "安全模式 · 閘道器未執行",
      cannotStart: "無法啟動",
      expandRail: "展開源列表",
      configFile: "配置檔案",
      versionHistory: "備份",
      rejectedTitle: "配置校驗未透過，仍在使用上一版本",
      rejectedAt: (stage: string, line: number | null) => `${stage}錯誤${line != null ? `（第 ${line} 行）` : ""}：`,
      rotatedUnsaved: (provider: string) => `${provider} 已換髮新憑據，但未能寫回 config.yaml。當前轉發正常。`,
      oldRevoked: (em: Em) => <>原憑據已在伺服器端失效。{em("重啟前如未處理，該上游的請求將持續返回 401")}。</>,
      staleData: (what: string) => `${what} · 以下資料截至連線斷開時`,
      restart: "重新啟動",
    },
    ja: {
      surfaces: {
        dashboard: "概要",
        requests: "トラフィック",
        security: "セキュリティ",
        upstreams: "アップストリーム",
        routing: "ルーティング",
        clients: "クライアント",
        keys: "キー",
        mcp: "MCP",
        plugins: "プラグイン",
        settings: "設定",
      },
      newFindings: (label: string, n: number) => `${label} · 新規検出 ${n} 件`,
      listenStale: (why: string) => `リッスン設定を適用できませんでした：${why}`,
      running: "実行中",
      starting: "起動中",
      restarting: (attempt: string) => `再起動中（${attempt} 回目）`,
      restartingShort: "再起動中",
      safeMode: "セーフモード · ゲートウェイ停止中",
      safeModeShort: "セーフモード",
      stopped: "停止中",
      cannotStart: "起動できません",
      collapseRail: "サイドバーを折りたたむ",
      expandRail: "サイドバーを展開",
      configFile: "設定ファイル",
      versionHistory: "バックアップ",
      rejectedTitle: "設定の検証に失敗したため、以前の設定を使用しています",
      rejectedAt: (stage: string, line: number | null) => `${stage}エラー${line != null ? `（${line} 行目）` : ""}：`,
      rotatedUnsaved: (provider: string) => `${provider} が新しい認証情報を発行しましたが、config.yaml に保存できませんでした。現在、転送は正常に動作しています。`,
      oldRevoked: (em: Em) => <>以前の認証情報はサーバーで無効になりました。{em("再起動前に解決しないと、このアップストリームへのリクエストは 401 を返し続けます")}。</>,
      staleData: (what: string) => `${what} · 切断時点のデータを表示しています`,
      restart: "再起動",
    },
    ko: {
      surfaces: {
        dashboard: "개요",
        requests: "트래픽",
        security: "보안",
        upstreams: "업스트림",
        routing: "라우팅",
        clients: "클라이언트",
        keys: "키",
        mcp: "MCP",
        plugins: "플러그인",
        settings: "설정",
      },
      listenStale: (why: string) => `수신 설정이 적용되지 않았습니다: ${why}`,
      running: "실행 중",
      starting: "시작 중",
      restarting: (attempt: string) => `다시 시작 중(${attempt}번째 시도)`,
      restartingShort: "다시 시작 중",
      safeMode: "안전 모드 · 게이트웨이 중지됨",
      safeModeShort: "안전 모드",
      stopped: "중지됨",
      cannotStart: "시작할 수 없음",
      collapseRail: "사이드바 접기",
      expandRail: "사이드바 펼치기",
      configFile: "설정 파일",
      versionHistory: "백업",
      rejectedTitle: "설정 검사에 실패했습니다. 이전 설정을 계속 사용합니다.",
      restart: "다시 시작",
      newFindings: (label: string, n: number) => `${label} · 새로 발견된 항목 ${n}건`,
      rejectedAt: (stage: string, line: number | null) => `${stage} 오류${line != null ? `(${line}번째 줄)` : ""}: `,
      rotatedUnsaved: (provider: string) => `${provider}에서 새 인증 정보를 발급했으나 config.yaml에 저장하지 못했습니다. 요청은 정상적으로 전달 중입니다.`,
      oldRevoked: (em: Em) => <>이전 인증 정보는 서버에서 이미 만료되었습니다. {em("재시작 전에 문제를 해결하지 않으면 이 업스트림의 요청이 계속 401 오류를 반환합니다")}.</>,
      staleData: (what: string) => `${what} · 연결이 끊기기 직전의 데이터입니다`,
    },
    es: {
      surfaces: {
        dashboard: "Resumen",
        requests: "Tráfico",
        security: "Seguridad",
        upstreams: "Proveedores",
        routing: "Enrutamiento",
        clients: "Clientes",
        keys: "Claves",
        mcp: "MCP",
        plugins: "Complementos",
        settings: "Configuración",
      },
      newFindings: (label: string, n: number) => `${label} · ${count(n, "Nueva conclusión", "nuevas conclusiones")}`,
      listenStale: (why: string) => `No se aplicó la configuración de escucha: ${why}`,
      running: "En ejecución",
      starting: "Iniciando",
      restarting: (attempt: string) => `Reiniciando (intento ${attempt})`,
      restartingShort: "Reiniciando",
      safeMode: "Modo seguro · Puerta de enlace detenida",
      safeModeShort: "Modo seguro",
      stopped: "Detenido",
      cannotStart: "No se pudo iniciar",
      collapseRail: "Contraer la barra lateral",
      expandRail: "Expandir la barra lateral",
      configFile: "Archivo de configuración",
      versionHistory: "Copias de seguridad",
      rejectedTitle: "La configuración no es válida. Se sigue usando la configuración anterior.",
      rejectedAt: (stage: string, line: number | null) => `${stage} error${line != null ? ` (línea ${line})` : ""}: `,
      rotatedUnsaved: (provider: string) => `${provider} emitió nuevas credenciales, pero no pudieron ser escritas de nuevo a config.yaml. La reenvío actualmente funciona normalmente.`,
      oldRevoked: (em: Em) => (<>
        Las credenciales anteriores ya no son válidas en el servidor.{" "}
        {em("A menos que esto se resuelva antes del siguiente reinicio, las solicitudes a este curso anterior seguirán devolviendo 401")}.
       </>),
      staleData: (what: string) => `${what} · Los datos de abajo son de la desconexión`,
      restart: "Reiniciar",
    },
  },
);
