import { messages } from "@/i18n";

export const pluginFieldsText = messages(
  {
    all: "全部",
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
    defaultIs: (v: string) => `默认值：${v}`,
    emptyDefault: "默认值为空",
  },
  {
    all: "All",
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
    defaultIs: (v: string) => `Default: ${v}`,
    emptyDefault: "Empty by default",
  },
);
