import { messages } from "@/i18n";

/** 英文的单复数 */
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/**
 * 请求详情「内容」那一页的文案：解析、原始报文两种看法，客户端、上游两边，在跑时实时追加。
 * 角色、系统提示、思考这些和会话的「对话」同一套说法（`Conversation.i18n`）。
 */
export const contentText = messages(
  {
    /** 看法：按对话读出来，或者查看已脱敏的报文记录 */
    views: { parsed: "解析", raw: "报文记录" },
    viewsLabel: "内容的显示方式",
    redactedRecord:
      "请求头和正文在记录时会再次脱敏，此处的占位符不一定发给了上游。发送前实际替换的位置见安全记录。",
    copyRecord: "复制记录",
    /** 原始报文看哪一边：客户端收发的，或者网关和上游之间的 */
    sides: { client: "客户端一侧", upstream: "上游一侧" },
    sidesLabel: "报文的一侧",
    /** 上游一侧试过不止一跳时，看哪一跳 */
    attemptsLabel: "尝试",
    follow: "跟随最新",
    /** 请求还在跑，内容在实时追加 */
    live: "实时",

    request: "请求",
    response: "回答",
    /** 回答正在一段一段到 */
    receiving: "接收中",
    /** 还没有上游的回答 */
    waiting: "等待上游响应",
    messages: (n: number) => `${n.toLocaleString()} 条消息`,
    tools: (n: number) => `${n.toLocaleString()} 个工具`,
    /** 解析里声明的工具那一行，左边那一列 */
    toolsLabel: "工具",
    outputTokens: (n: number) => `${n.toLocaleString()} token`,
    events: (n: number) => `${n.toLocaleString()} 个事件`,
    /** 原始报文里收起的前面那些事件，点开显示 */
    earlierEvents: (n: number) => `前 ${n.toLocaleString()} 个事件`,
    showEarlierEvents: "显示全部事件",

    // 解析不出来的时候
    unknownFormat: "无法识别此请求的格式，内容见「报文记录」",
    requestCut: "请求过大，仅保存了开头部分，无法解析，内容见「报文记录」",
    requestUnreadable: "请求正文无法解析，内容见「报文记录」",
    responseUnreadable: "回答的格式无法识别，内容见「报文记录」",
    /** 认得出格式，但里面没有文字、思考或工具调用 */
    noAnswer: "回答中没有可显示的内容",

    // 上游一侧的正文没有另存的几种
    sameAsClient: "正文与客户端一侧相同",
    afterPluginsLater: "正文为插件改写后的版本，请求结束后可查看",
    attemptNotKept: "失败的尝试不保留正文",
    /** 这一段还没有报文头 */
    noHead: "尚未发出",
    /** 在跑的请求订阅不上实时内容（不是因为它已经结束）：后面跟着原因 */
    liveFailed: (why: string) => `无法显示实时内容：${why}`,
  },
  {
    views: { parsed: "Parsed", raw: "Recorded HTTP" },
    viewsLabel: "How the content is shown",
    redactedRecord:
      "Headers and bodies are redacted again for the record. A placeholder here may not have been sent upstream. See the security records for what was replaced before sending.",
    copyRecord: "Copy record",
    sides: { client: "Client side", upstream: "Upstream side" },
    sidesLabel: "Side of the exchange",
    attemptsLabel: "Attempt",
    follow: "Follow latest",
    live: "Live",

    request: "Request",
    response: "Response",
    receiving: "Receiving",
    waiting: "Waiting for the upstream",
    messages: (n: number) => count(n, "message", "messages"),
    tools: (n: number) => count(n, "tool", "tools"),
    toolsLabel: "Tools",
    outputTokens: (n: number) => count(n, "token", "tokens"),
    events: (n: number) => count(n, "event", "events"),
    earlierEvents: (n: number) => (n === 1 ? "1 earlier event" : `${n.toLocaleString()} earlier events`),
    showEarlierEvents: "Show all events",

    unknownFormat: "The format of this request is not recognized; see Recorded HTTP",
    requestCut: "The request was too large to save in full and cannot be parsed; see Recorded HTTP for the beginning",
    requestUnreadable: "The request body cannot be parsed; see Recorded HTTP",
    responseUnreadable: "The response format is not recognized; see Recorded HTTP",
    noAnswer: "The response has nothing to show",

    sameAsClient: "The body is the same as on the client side",
    afterPluginsLater: "The body is the version rewritten by plugins; it can be viewed when the request ends",
    attemptNotKept: "Bodies of failed attempts are not kept",
    noHead: "Not sent yet",
    liveFailed: (why: string) => `Live content is unavailable: ${why}`,
  },
  {
    "zh-Hant": {
      views: { parsed: "解析", raw: "封包記錄" },
      viewsLabel: "內容的顯示方式",
      redactedRecord: "請求頭和正文在記錄時會再次脫敏，此處的佔位符不一定發給了上游。傳送前實際替換的位置見安全記錄。",
      copyRecord: "複製記錄",
      sides: { client: "用戶端一側", upstream: "上游一側" },
      sidesLabel: "封包的一側",
      attemptsLabel: "嘗試",
      follow: "跟隨最新",
      live: "實時",
      request: "請求",
      waiting: "等待上游回應",
      messages: (n: number) => `${n.toLocaleString()} 條訊息`,
      tools: (n: number) => `${n.toLocaleString()} 個工具`,
      events: (n: number) => `${n.toLocaleString()} 個事件`,
      earlierEvents: (n: number) => `前 ${n.toLocaleString()} 個事件`,
      showEarlierEvents: "顯示全部事件",
      unknownFormat: "無法識別此請求的格式，內容見「封包記錄」",
      requestCut: "請求過大，僅儲存了開頭部分，無法解析，內容見「封包記錄」",
      requestUnreadable: "請求正文無法解析，內容見「封包記錄」",
      responseUnreadable: "回答的格式無法識別，內容見「封包記錄」",
      noAnswer: "回答中沒有可顯示的內容",
      sameAsClient: "正文與用戶端一側相同",
      afterPluginsLater: "正文為外掛改寫後的版本，請求結束後可檢視",
      attemptNotKept: "失敗的嘗試不保留正文",
      noHead: "尚未發出",
      liveFailed: (why: string) => `無法顯示實時內容：${why}`,
    },
    ko: {
      request: "요청",
    },
    es: {
      views: { parsed: "Analizado", raw: "Grabado HTTP" },
      viewsLabel: "Cómo se muestra el contenido",
      redactedRecord: "Los encabezados y los cuerpos se redactan de nuevo para que conste. Es posible que no se haya enviado un marcador de posición. Vea los registros de seguridad de lo que fue reemplazado antes de enviar.",
      copyRecord: "Copiar registro",
      sides: { client: "Lado cliente", upstream: "Lado ascendente" },
      sidesLabel: "Lado del intercambio",
      attemptsLabel: "Intento",
      follow: "Seguir la última",
      live: "Vivo",
      request: "Solicitud",
      response: "Respuesta",
      receiving: "Recepción",
      waiting: "Esperando por el río arriba",
      messages: (n: number) => count(n, "mensaje", "mensajes"),
      tools: (n: number) => count(n, "herramienta", "herramientas"),
      toolsLabel: "Herramientas",
      events: (n: number) => count(n, "evento", "eventos"),
      earlierEvents: (n: number) => (n === 1 ? "1 evento anterior" : `${n.toLocaleString()} Hechos anteriores`),
      showEarlierEvents: "Mostrar todos los eventos",
      unknownFormat: "No se reconoce el formato de esta solicitud; véase HTTP grabado",
      requestCut: "La solicitud era demasiado grande para guardarla en su totalidad y no puede ser analizada; vea HTTP grabado para el comienzo",
      requestUnreadable: "El cuerpo de solicitud no puede ser analizado; vea el HTTP grabado",
      responseUnreadable: "No se reconoce el formato de respuesta; ver HTTP grabado",
      noAnswer: "La respuesta no tiene nada que mostrar",
      sameAsClient: "El cuerpo es el mismo que en el lado del cliente",
      afterPluginsLater: "El cuerpo es la versión reescrita por plugins; se puede ver cuando termina la solicitud",
      attemptNotKept: "No se conservan los cuerpos de intentos fallidos",
      noHead: "No se ha enviado aún",
      liveFailed: (why: string) => `El contenido en vivo no está disponible: ${why}`,
    },
  },
);
