import { messages } from "@/i18n";

export const probesTabText = messages(
  {
    intro:
      "配置客户端辅助请求及联网工具的执行方式。设为转发的请求继续按路由规则选择上游。",
    kind: "请求／工具", mode: "处理方式",
    intercept: "本地应答",
    interceptWhat: "由网关直接应答，不发送到上游，不产生费用。",
    forward: "转发",
    forwardWhat: "和普通请求一样按路由规则转发，按转发到的上游产生费用。",
    ruleHint: "规则可用「辅助请求」条件匹配设为转发的类别，例如分流至费用更低的上游。",
  },
  {
    intro:
      "Choose how client auxiliary requests and web tools are handled. Forwarded requests continue through routing rules.",
    kind: "Request / tool", mode: "Handling",
    intercept: "Answer locally",
    interceptWhat: "The gateway answers directly. Nothing is sent upstream and no cost is incurred.",
    forward: "Forward",
    forwardWhat: "Forwarded by the routing rules like any other request, with costs according to the upstream it goes to.",
    ruleHint:
      "Rules can match the kinds set to “Forward” with the “Auxiliary request” condition, for example to send them to a lower-cost upstream.",
  },
  {
    "zh-Hant": {
      intro: "配置用戶端輔助請求及聯網工具的執行方式。設為轉發的請求繼續按路由規則選擇上游。",
      kind: "請求／工具",
      mode: "處理方式",
      intercept: "本地應答",
      interceptWhat: "由閘道器直接應答，不傳送到上游，不產生費用。",
      forward: "轉發",
      forwardWhat: "和普通請求一樣按路由規則轉發，按轉發到的上游產生費用。",
      ruleHint: "規則可用「輔助請求」條件匹配設為轉發的類別，例如分流至費用更低的上游。",
    },
    es: {
      intro: "Elija cómo se manejan las peticiones auxiliares del cliente y las herramientas web. Las solicitudes reenviadas continúan a través de las reglas de enrutamiento.",
      kind: "Solicitud / herramienta",
      mode: "Manipulación",
      intercept: "Respuesta local",
      interceptWhat: "La puerta de enlace responde directamente. Nada se envía del proveedor y no se incurre en ningún costo.",
      forward: "Adelante",
      forwardWhat: "Reenviado por las reglas de encaminamiento como cualquier otra petición, con los costos de acuerdo con la corriente ascendente a la que va.",
      ruleHint: "Las reglas pueden coincidir con los tipos establecidos en “Avanzar” con la condición “Solicitud auxiliar”, por ejemplo para enviarlos a un costo ascendente más bajo.",
    },
  },
);
