import { messages } from "@/i18n";

export const pluginFieldsText = messages(
  {
    some: "指定",
    /** 标题下的一句：这一项按什么匹配。客户端不用说 */
    matches: {
      clients: "",
      models: "按发给上游的模型名匹配；路由改写过模型名的，按改写之后的名字。",
      upstreams: "按发往的上游匹配，请求和回答都适用。",
    },
    hint: {
      clients: "客户端的名字，例如 claude-code。可添加多个，支持 * 通配。",
      models: "模型名，例如 deepseek-*。可添加多个，支持 * 通配。",
      upstreams: "上游的名字。可添加多个，支持 * 通配。",
    },
    placeholder: { clients: "添加客户端", models: "添加模型", upstreams: "添加上游" },
    enterToAdd: "回车添加",
    removeShort: "删除",
    remove: (x: string) => `删除 ${x}`,
    needOne: (part: string) => `${part}选了「指定」，至少添加一项。`,
    settings: "设置项",
    numberBad: (label: string) => `「${label}」需要填写数字。`,
  },
  {
    some: "Specific",
    matches: {
      clients: "",
      models: "Matches the model name sent upstream; when routing rewrites it, the rewritten name.",
      upstreams: "Matches the upstream the request goes to, for requests and replies alike.",
    },
    hint: {
      clients: "Client names, such as claude-code. Add as many as needed; * matches anything.",
      models: "Model names, such as deepseek-*. Add as many as needed; * matches anything.",
      upstreams: "Upstream names. Add as many as needed; * matches anything.",
    },
    placeholder: { clients: "Add a client", models: "Add a model", upstreams: "Add an upstream" },
    enterToAdd: "Enter to add",
    removeShort: "Remove",
    remove: (x: string) => `Remove ${x}`,
    needOne: (part: string) => `${part} is set to Specific: add at least one.`,
    settings: "Settings",
    numberBad: (label: string) => `“${label}” needs a number.`,
  },
  {
    "zh-Hant": {
      matches: {
        clients: "",
        models: "按發給上游的模型名匹配；路由改寫過模型名的，按改寫之後的名字。",
        upstreams: "按發往的上游匹配，請求和回答都適用。",
      },
      hint: {
        clients: "用戶端的名字，例如 claude-code。可新增多個，支援 * 通配。",
        models: "模型名，例如 deepseek-*。可新增多個，支援 * 通配。",
        upstreams: "上游的名字。可新增多個，支援 * 通配。",
      },
      placeholder: { clients: "新增用戶端", models: "新增模型", upstreams: "新增上游" },
      enterToAdd: "回車新增",
      removeShort: "刪除",
      remove: (x: string) => `刪除 ${x}`,
      needOne: (part: string) => `${part}選了「指定」，至少新增一項。`,
      settings: "設定項",
      numberBad: (label: string) => `「${label}」需要填寫數字。`,
    },
    ko: {
      removeShort: "제거",
      settings: "설정",
    },
    es: {
      some: "Específico",
      matches: {
        clients: "",
        models: "Coincide con el nombre del modelo enviado en sentido ascendente; cuando el enrutamiento lo reescriba, el nombre reescrito.",
        upstreams: "Coincide con el curso anterior a la solicitud va a, para solicitudes y respuestas por igual.",
      },
      hint: {
        clients: "Nombres de clientes, como claude-code. Añadir tantos como sea necesario; * coincide con cualquier cosa.",
        models: "Nombres de modelos, como deepseek-*. Agregue tantos como sea necesario; * coincide con cualquier cosa.",
        upstreams: "Nombres ascendentes. Agrega tantos como sea necesario; * coincide con cualquier cosa.",
      },
      placeholder: { clients: "Añadir un cliente", models: "Añadir un modelo", upstreams: "Añadir un curso ascendente" },
      enterToAdd: "Introduzca para añadir",
      removeShort: "Quitar",
      remove: (x: string) => `Eliminar ${x}`,
      needOne: (part: string) => `${part} se establece en Específico: añadir al menos uno.`,
      settings: "Configuración",
      numberBad: (label: string) => `“${label}” necesita un número.`,
    },
  },
);
