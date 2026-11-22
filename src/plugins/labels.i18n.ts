import { messages } from "@/i18n";

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * 插件的名词：权限、状态、运行结果、出错时的处置、适用范围。插件页、安装与审核的
 * 对话框、请求详情都用这一份。
 *
 * **权限按它允许做的事说**，不按清单里的写法（`reply.tool_calls`）说：用户决定装不装，
 * 看的是「它能改什么」。`note` 是会让人做错决定的那一句后果。
 */
export const pluginLabelsText = messages(
  {
    permissions: {
      system: { short: "系统提示词", what: "读取和修改系统提示词", note: "" },
      messages: {
        short: "对话消息",
        what: "读取和修改对话消息中的文字和工具结果",
        note: "可以向对话中加入指令",
      },
      tools: { short: "工具定义", what: "读取和修改工具定义", note: "会改变模型可用的工具" },
      params: {
        short: "请求参数",
        what: "读取和修改模型名、max_tokens、温度等参数",
        note: "可能改变发给上游的模型和产生的费用",
      },
      reply_text: { short: "回答文字", what: "读取和修改回答中的文字", note: "" },
      reply_tool_calls: {
        short: "回答中的工具调用",
        what: "修改、删除和新增回答中的工具调用",
        note: "高风险：可以改写客户端将要执行的命令和文件路径",
      },
    } as Record<string, { short: string; what: string; note: string }>,
    highRisk: "高风险",
    chipTip: (what: string, note: string) => (note ? `${what}。${note}。` : `${what}。`),
    added: "新增",
    /** 改回答文字的插件，整段模式下文字到齐才交给客户端 */
    blockMode: "回答文字整段到齐后才显示",

    /** 插件处理的请求种类。只处理对话的（出厂就是这样）不写 */
    kinds: { conversation: "对话", embeddings: "向量化", completions: "补全" } as Record<string, string>,
    alsoHandles: (list: string) => `也处理：${list}`,
    onlyHandles: (list: string) => `仅处理：${list}`,

    status: {
      ok: "生效中",
      disabled: "已停用",
      changed: "文件已更改",
      error: "加载失败",
    } as Record<string, string>,

    outcomes: {
      unchanged: "未改动",
      changed: "已改写",
      rejected: "已拒绝",
      error: "出错",
      skipped: "已跳过",
    } as Record<string, string>,
    hooks: { request: "请求", reply: "回答" } as Record<string, string>,

    onError: "出错时",
    onErrorOptions: { reject: "拒绝这次请求", skip: "跳过此插件" },

    scope: "适用范围",
    scopeParts: { clients: "客户端", models: "模型", upstreams: "上游" },
    all: "全部",
    allRequests: "全部请求",
    scopeLine: (part: string, value: string) => `${part}：${value}`,
    allOf: { clients: "全部客户端", models: "全部模型", upstreams: "全部上游" },
    listSep: "、",

    /** 平均 CPU 时间 */
    cpu: (ms: string) => `${ms} 毫秒`,
    lessThanMs: "不到 0.1 毫秒",
  },
  {
    permissions: {
      system: { short: "System prompt", what: "Read and change the system prompt", note: "" },
      messages: {
        short: "Messages",
        what: "Read and change the text and tool results in conversation messages",
        note: "Can add instructions to the conversation",
      },
      tools: { short: "Tool definitions", what: "Read and change tool definitions", note: "Changes which tools the model can use" },
      params: {
        short: "Parameters",
        what: "Read and change the model, max_tokens, temperature and other parameters",
        note: "May change the model sent upstream and what it costs",
      },
      reply_text: { short: "Reply text", what: "Read and change the text of replies", note: "" },
      reply_tool_calls: {
        short: "Tool calls in replies",
        what: "Change, remove and add tool calls in replies",
        note: "High risk: can rewrite the commands and file paths a client is about to run",
      },
    } as Record<string, { short: string; what: string; note: string }>,
    highRisk: "High risk",
    chipTip: (what: string, note: string) => (note ? `${what}. ${note}.` : `${what}.`),
    added: "New",
    blockMode: "Reply text appears once each block is complete",

    kinds: { conversation: "conversations", embeddings: "embeddings", completions: "completions" } as Record<string, string>,
    alsoHandles: (list: string) => `Also handles: ${list}`,
    onlyHandles: (list: string) => `Handles only: ${list}`,

    status: {
      ok: "Active",
      disabled: "Disabled",
      changed: "File changed",
      error: "Failed to load",
    } as Record<string, string>,

    outcomes: {
      unchanged: "Unchanged",
      changed: "Changed",
      rejected: "Rejected",
      error: "Error",
      skipped: "Skipped",
    } as Record<string, string>,
    hooks: { request: "Request", reply: "Reply" } as Record<string, string>,

    onError: "On error",
    onErrorOptions: { reject: "Reject the request", skip: "Skip this plugin" },

    scope: "Applies to",
    scopeParts: { clients: "Clients", models: "Models", upstreams: "Upstreams" },
    all: "All",
    allRequests: "All requests",
    scopeLine: (part: string, value: string) => `${part}: ${value}`,
    allOf: { clients: "All clients", models: "All models", upstreams: "All upstreams" },
    listSep: ", ",

    cpu: (ms: string) => `${ms} ms`,
    lessThanMs: "under 0.1 ms",
  },
  {
    "zh-Hant": {
      permissions: {
        system: { short: "系統提示詞", what: "讀取和修改系統提示詞", note: "" },
        messages: {
          short: "對話訊息",
          what: "讀取和修改對話訊息中的文字和工具結果",
          note: "可以向對話中加入指令",
        },
        tools: { short: "工具定義", what: "讀取和修改工具定義", note: "會改變模型可用的工具" },
        params: {
          short: "請求引數",
          what: "讀取和修改模型名、max_tokens、溫度等引數",
          note: "可能改變發給上游的模型和產生的費用",
        },
        reply_text: { short: "回答文字", what: "讀取和修改回答中的文字", note: "" },
        reply_tool_calls: {
          short: "回答中的工具呼叫",
          what: "修改、刪除和新增回答中的工具呼叫",
          note: "高風險：可以改寫用戶端將要執行的命令和檔案路徑",
        },
      } as Record<string, {
        short: string;
        what: string;
        note: string;
      }>,
      highRisk: "高風險",
      blockMode: "回答文字整段到齊後才顯示",
      kinds: { conversation: "對話", embeddings: "向量化", completions: "補全" } as Record<string, string>,
      alsoHandles: (list: string) => `也處理：${list}`,
      onlyHandles: (list: string) => `僅處理：${list}`,
      status: {
        ok: "生效中",
        disabled: "已停用",
        changed: "檔案已更改",
        error: "載入失敗",
      } as Record<string, string>,
      outcomes: {
        unchanged: "未改動",
        changed: "已改寫",
        rejected: "已拒絕",
        error: "出錯",
        skipped: "已跳過",
      } as Record<string, string>,
      hooks: { request: "請求", reply: "回答" } as Record<string, string>,
      onError: "出錯時",
      onErrorOptions: { reject: "拒絕這次請求", skip: "跳過此外掛" },
      scope: "適用範圍",
      scopeParts: { clients: "用戶端", models: "模型", upstreams: "上游" },
      allRequests: "全部請求",
      allOf: { clients: "全部用戶端", models: "全部模型", upstreams: "全部上游" },
    },
    ko: {
      status: {
        ok: "Active",
        disabled: "비활성화됨",
        changed: "File changed",
        error: "Failed to load",
      } as Record<string, string>,
      hooks: { request: "요청", reply: "Reply" } as Record<string, string>,
      scopeParts: { clients: "클라이언트", models: "모델", upstreams: "업스트림" },
      allOf: { clients: "All clients", models: "All models", upstreams: "모든 업스트림" },
    },
    es: {
      permissions: {
        system: { short: "Indicación del sistema", what: "Lea y cambie el prompt del sistema", note: "" },
        messages: {
          short: "Mensajes",
          what: "Leer y cambiar el texto y la herramienta resulta en mensajes de conversación",
          note: "Puede añadir instrucciones a la conversación",
        },
        tools: { short: "Definiciones de las herramientas", what: "Lea y cambie las definiciones de la herramienta", note: "Cambios en las herramientas que el modelo puede utilizar" },
        params: {
          short: "Parámetros",
          what: "Leer y cambiar el modelo, max_tokens, temperatura y otros parámetros",
          note: "Puede cambiar el modelo enviado arriba y lo que cuesta",
        },
        reply_text: { short: "Responder texto", what: "Leer y cambiar el texto de las respuestas", note: "" },
        reply_tool_calls: {
          short: "Llamadas de herramientas en las respuestas",
          what: "Cambiar, eliminar y añadir llamadas de herramientas en las respuestas",
          note: "Alto riesgo: puede reescribir los comandos y las rutas de archivo que un cliente está a punto de ejecutar",
        },
      } as Record<string, {
        short: string;
        what: string;
        note: string;
      }>,
      highRisk: "Alto riesgo",
      added: "Nuevo",
      blockMode: "Responder texto aparece una vez que cada bloque está completo",
      kinds: { conversation: "conversaciones", embeddings: "incrustaciones", completions: "finalizaciones" } as Record<string, string>,
      alsoHandles: (list: string) => `También manijas: ${list}`,
      onlyHandles: (list: string) => `Solo manijas: ${list}`,
      status: {
        ok: "Activo",
        disabled: "Desactivado",
        changed: "Archivo cambiado",
        error: "Fallo al cargar",
      } as Record<string, string>,
      outcomes: {
        unchanged: "Sin cambios",
        changed: "Cambiado",
        rejected: "Rechazada",
        error: "Error",
        skipped: "Omitir",
      } as Record<string, string>,
      hooks: { request: "Solicitud", reply: "Respuesta" } as Record<string, string>,
      onError: "Error",
      onErrorOptions: { reject: "Rechazar la solicitud", skip: "Omitir este complemento" },
      scope: "Se aplica a",
      scopeParts: { clients: "Clientes", models: "Modelos", upstreams: "Proveedores" },
      all: "Todos",
      allRequests: "Todas las solicitudes",
      allOf: { clients: "Todos los clientes", models: "Todos los modelos", upstreams: "Todos los proveedores" },
      lessThanMs: "menos de 0,1 ms",
    },
  },
);

/** 统计：运行几次、改写几次。插件页的那一格和它的悬停 */
export const pluginStatsText = messages(
  {
    runs: (n: number) => `${n.toLocaleString()} 次运行`,
    changedShort: (n: number) => `改写 ${n.toLocaleString()}`,
    errorsShort: (n: number) => `出错 ${n.toLocaleString()}`,
    noRuns: "尚未运行",
    since: "网关启动以来",
    lines: {
      calls: "运行",
      changed: "改写",
      rejected: "拒绝",
      errors: "出错",
      cpu: "平均 CPU 时间",
      lastError: "最近一次出错",
    },
  },
  {
    runs: (n: number) => plural(n, "run", "runs"),
    changedShort: (n: number) => `${n.toLocaleString()} changed`,
    errorsShort: (n: number) => plural(n, "error", "errors"),
    noRuns: "Not run yet",
    since: "Since the gateway started",
    lines: {
      calls: "Runs",
      changed: "Changed",
      rejected: "Rejected",
      errors: "Errors",
      cpu: "Average CPU time",
      lastError: "Last error",
    },
  },
  {
    "zh-Hant": {
      runs: (n: number) => `${n.toLocaleString()} 次執行`,
      changedShort: (n: number) => `改寫 ${n.toLocaleString()}`,
      errorsShort: (n: number) => `出錯 ${n.toLocaleString()}`,
      noRuns: "尚未執行",
      since: "閘道器啟動以來",
      lines: {
        calls: "執行",
        changed: "改寫",
        rejected: "拒絕",
        errors: "出錯",
        cpu: "平均 CPU 時間",
        lastError: "最近一次出錯",
      },
    },
    es: {
      runs: (n: number) => plural(n, "ejecutar", "corre"),
      changedShort: (n: number) => `${n.toLocaleString()} cambiado`,
      errorsShort: (n: number) => plural(n, "error", "errores"),
      noRuns: "Todavía no corre.",
      since: "Desde que comenzó el portal",
      lines: {
        calls: "Corre",
        changed: "Cambiado",
        rejected: "Rechazada",
        errors: "Errores",
        cpu: "Tiempo medio de la CPU",
        lastError: "Último error",
      },
    },
  },
);
