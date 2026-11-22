import { messages } from "@/i18n";

/**
 * 引导的文案：概览上的「开始使用」三步，和各页的下一步提示。
 *
 * **只说下一步做什么，不讲道理**：用户要的是往前走一步的那个按钮，不是网关怎么工作。
 */
export const guideText = messages(
  {
    /** 关掉一条提示，以后也不再出现 */
    hide: "不再显示",

    // 概览：开始使用
    setupTitle: "开始使用",
    /** 三步做完了几步 */
    setupProgress: (done: number, total: number) => `${done}/${total}`,
    stepUpstream: "添加上游",
    stepUpstreamTodo: "API 密钥、中转服务、本机模型，或 ChatGPT、Z.ai 账号。",
    stepUpstreamDone: (n: number) => `已添加 ${n} 个上游`,
    newUpstream: "新建上游…",
    stepClient: "接管客户端",
    /** 检测到了、还没接的那几个，用顿号连起来 */
    stepClientFound: (names: string) => `检测到 ${names}。接管前会先列出要改动的配置。`,
    stepClientNone: "未检测到可自动接管的客户端，可按说明手动配置。",
    stepClientDone: (names: string) => `已接管 ${names}`,
    /** 只配了手动的（Cursor 之类），没有接管的 */
    stepClientManual: "已按说明手动配置",
    goClients: "前往客户端",
    stepRequest: "发出第一条请求",
    stepRequestTodo: "在已接管的客户端中发一条消息。",
    waiting: "等待请求",
    /** 客户端的探测由网关直接答了：说明它连上了 */
    probes: (n: number) => `已直接应答 ${n} 次客户端探测，客户端已连接网关。`,
    /** 名字之间的分隔 */
    listSep: "、",

    // 上游页
    nextClientsTitle: "下一步：接管客户端",
    nextClientsBody: "接管后，客户端的请求经网关发往上游。",

    // 客户端页
    nextUpstreamTitle: "尚未添加上游",
    nextUpstreamBody: "接管的客户端发出的请求，需要有上游才能送达。",
    nextRequestTitle: "下一步：发出第一条请求",
    nextRequestBody: (names: string) => `在 ${names} 中发一条消息，流量页即会显示这条请求。`,
    goTraffic: "前往流量",

    // 概览：第一条请求
    firstRequestTitle: "第一条请求已经过网关",
    firstRequestBody: "它的路由、尝试过的上游、用量与费用已记录在流量页。",
    viewRequest: "查看这条请求",

    // 流量页
    openRowTitle: "点开一条请求查看详情",
    openRowBody: "命中的路由规则、尝试过的上游、用量与费用，以及被替换的敏感值，都在详情中。",

    // 安全页
    /** 此刻停在「观察」的有几项 */
    observeTitle: (n: number) => `${n} 项防护处于「监控」`,
    observeBody: "命中时只记录并发出通知。在日志中确认没有误报后，再切换为「开启」。",

    // 设置
    hintsLabel: "引导提示",
    hintsHint: "设为「不再显示」的提示和忽略过的提醒将重新出现。",
    hintsReset: "重新显示",
    hintsResetDone: "提示将重新显示",
  },
  {
    hide: "Don’t show again",

    setupTitle: "Get started",
    setupProgress: (done: number, total: number) => `${done}/${total}`,
    stepUpstream: "Add an upstream",
    stepUpstreamTodo: "An API key, a relay service, a local model, or a ChatGPT or Z.ai account.",
    stepUpstreamDone: (n: number) => (n === 1 ? "1 upstream added" : `${n} upstreams added`),
    newUpstream: "New upstream…",
    stepClient: "Connect a client",
    stepClientFound: (names: string) => `Found ${names}. The configuration changes are listed before anything is written.`,
    stepClientNone: "No client that can be connected automatically was found; manual setup instructions are available.",
    stepClientDone: (names: string) => `Connected: ${names}`,
    stepClientManual: "Set up manually",
    goClients: "Go to Clients",
    stepRequest: "Send a first request",
    stepRequestTodo: "Send a message from a connected client.",
    waiting: "Waiting for a request",
    probes: (n: number) =>
      n === 1
        ? "1 client probe was answered directly; a client is connected to the gateway."
        : `${n} client probes were answered directly; a client is connected to the gateway.`,
    listSep: ", ",

    nextClientsTitle: "Next: connect a client",
    nextClientsBody: "Once connected, a client's requests go through the gateway to the upstreams.",

    nextUpstreamTitle: "No upstream yet",
    nextUpstreamBody: "Requests from connected clients need an upstream to reach a model.",
    nextRequestTitle: "Next: send a first request",
    nextRequestBody: (names: string) => `Send a message from ${names}; the request then appears on the Traffic page.`,
    goTraffic: "Go to Traffic",

    firstRequestTitle: "The first request went through the gateway",
    firstRequestBody: "Its route, the upstreams it tried, its usage and cost are recorded on the Traffic page.",
    viewRequest: "View request",

    openRowTitle: "Open a request for its details",
    openRowBody: "The routing rule it matched, the upstreams it tried, its usage and cost, and any redacted values.",

    observeTitle: (n: number) => (n === 1 ? "1 protection is set to Monitor" : `${n} protections are set to Monitor`),
    observeBody:
      "Matches are only recorded and notified. Once the log shows no false positives, switch to On.",

    hintsLabel: "Guidance",
    hintsHint: "Hints set to “Don’t show again” and ignored warnings reappear.",
    hintsReset: "Show again",
    hintsResetDone: "Hints will show again",
  },
  {
    "zh-Hant": {
      hide: "不再顯示",
      setupTitle: "開始使用",
      stepUpstream: "新增上游",
      stepUpstreamTodo: "API 金鑰、中轉服務、本機模型，或 ChatGPT、Z.ai 帳號。",
      stepUpstreamDone: (n: number) => `已新增 ${n} 個上游`,
      stepClient: "接管用戶端",
      stepClientFound: (names: string) => `檢測到 ${names}。接管前會先列出要改動的配置。`,
      stepClientNone: "未檢測到可自動接管的用戶端，可按說明手動配置。",
      stepClientManual: "已按說明手動配置",
      goClients: "前往用戶端",
      stepRequest: "發出第一條請求",
      stepRequestTodo: "在已接管的用戶端中發一條訊息。",
      waiting: "等待請求",
      probes: (n: number) => `已直接應答 ${n} 次用戶端探測，用戶端已連線閘道器。`,
      nextClientsTitle: "下一步：接管用戶端",
      nextClientsBody: "接管後，用戶端的請求經閘道器發往上游。",
      nextUpstreamTitle: "尚未新增上游",
      nextUpstreamBody: "接管的用戶端發出的請求，需要有上游才能送達。",
      nextRequestTitle: "下一步：發出第一條請求",
      nextRequestBody: (names: string) => `在 ${names} 中發一條訊息，流量頁即會顯示這條請求。`,
      firstRequestTitle: "第一條請求已經過閘道器",
      firstRequestBody: "它的路由、嘗試過的上游、用量與費用已記錄在流量頁。",
      viewRequest: "檢視這條請求",
      openRowTitle: "點開一條請求檢視詳情",
      openRowBody: "命中的路由規則、嘗試過的上游、用量與費用，以及被替換的敏感值，都在詳情中。",
      observeTitle: (n: number) => `${n} 項防護處於「監控」`,
      observeBody: "命中時只記錄併發出通知。在日誌中確認沒有誤報後，再切換為「開啟」。",
      hintsLabel: "引導提示",
      hintsHint: "設為「不再顯示」的提示和忽略過的提醒將重新出現。",
      hintsReset: "重新顯示",
      hintsResetDone: "提示將重新顯示",
    },
    es: {
      hide: "No mostrar de nuevo",
      setupTitle: "Empieza.",
      stepUpstream: "Añadir un curso ascendente",
      stepUpstreamTodo: "Una clave de API, un servicio de relé, un modelo local, o una cuenta de ChatGPT o Z.ai.",
      stepUpstreamDone: (n: number) => (n === 1 ? "1 añadido en la fase anterior" : `${n} del proveedor añadidas`),
      newUpstream: "Nuevo río arriba…",
      stepClient: "Conectar un cliente",
      stepClientFound: (names: string) => `Se encuentra ${names}. Los cambios de configuración se enumeran antes de que se escriba nada.`,
      stepClientNone: "No se encontró ningún cliente que pueda conectarse automáticamente; las instrucciones de configuración manual están disponibles.",
      stepClientDone: (names: string) => `Conectado: ${names}`,
      stepClientManual: "Configurar manualmente",
      goClients: "Ir a los clientes",
      stepRequest: "Enviar una primera solicitud",
      stepRequestTodo: "Enviar un mensaje de un cliente conectado.",
      waiting: "Esperando una solicitud",
      probes: (n: number) => n === 1
        ? "1 sonda cliente fue respondida directamente; un cliente está conectado a la puerta de entrada."
        : `${n} Las sondas del cliente fueron respondidas directamente; un cliente está conectado a la puerta de entrada.`,
      nextClientsTitle: "Siguiente: conectar un cliente",
      nextClientsBody: "Una vez conectadas, las peticiones de un cliente pasan por la puerta de entrada a las del proveedor.",
      nextUpstreamTitle: "No hay del proveedor todavía",
      nextUpstreamBody: "Las solicitudes de los clientes conectados necesitan una corriente hacia arriba para llegar a un modelo.",
      nextRequestTitle: "Siguiente: enviar una primera solicitud",
      nextRequestBody: (names: string) => `Enviar un mensaje de ${names}; la solicitud aparece en la página de Tráfico.`,
      goTraffic: "Ir al tráfico",
      firstRequestTitle: "La primera petición pasó por la puerta de entrada",
      firstRequestBody: "Su ruta, las del proveedor que intentó, su uso y costo se registran en la página de Tráfico.",
      viewRequest: "Ver solicitud",
      openRowTitle: "Abrir una solicitud para sus detalles",
      openRowBody: "La regla de enrutamiento coincide, las del proveedor que intentó, su uso y costo, y cualquier valor redactado.",
      observeTitle: (n: number) => (n === 1 ? "1 protección se establece en Monitor" : `${n} Las protecciones están configuradas en Monitor`),
      observeBody: "Las coincidencias solo se registran y se notifican. Una vez que el registro no muestra falsos positivos, cambie a Activar.",
      hintsLabel: "Orientación",
      hintsHint: "Las sugerencias se fijan en “No mostrar de nuevo” y las advertencias ignoradas reaparecen.",
      hintsReset: "Mostrar de nuevo",
      hintsResetDone: "Las pistas se mostrarán de nuevo",
    },
  },
);
