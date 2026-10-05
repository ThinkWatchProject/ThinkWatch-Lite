import { messages } from "@/i18n";

export const aliasDialogText = messages(
  {
    createTitle: "新建别名",
    editTitle: (name: string) => `编辑别名 ${name}`,
    desc: "给模型起一个客户端用的名称。原来的名称照常可用。",
    loading: "正在读取别名",
    notFound: (name: string) => `别名 ${name} 已不在配置里。`,

    name: "名称",
    nameHint: "客户端用这个名称请求。",
    namePlaceholder: "例如 claude-sonnet-5",
    /** 名称恰好是某个上游的模型名，自动列成了第一个上游模型 */
    prefilled: (providers: string, name: string) => `${providers} 也有名为 ${name} 的模型，已列为第一个上游模型。`,
    /** 名称恰好是没列进来的那些上游的真模型：别名优先，它们不再收到这个名称 */
    shadows: (providers: string, name: string, models: string, creating: boolean) =>
      `${providers} 有名为 ${name} 的模型。${creating ? "建这个别名后" : "保存后"}，所有客户端用 ${name} 请求都会改发给 ${models}，不再发给 ${providers}。只想让某个客户端这样用，请在路由里给它的密钥写一条规则，转发至选「指定模型」。`,
    writeRule: "改为写路由规则…",
    claudeCodeReserved: (name: string) =>
      `Claude Code 把 ${name} 当作自己的档位名，请求前换成完整的模型名，它的请求用不到这个别名。`,
    familyMismatch: (family: string, model: string, clients: string) =>
      `名称像 ${family} 模型，上游模型却是 ${model}：${clients} 会按 ${family} 模型的上下文长度和参数发请求。`,
    desktopHidden: (name: string) => `Claude Desktop 只列出名称像 Claude 的模型，不会显示 ${name}。`,
    desktopShown: (name: string) => `Claude Desktop 会在模型列表里显示 ${name}。`,
    /** 改名前：哪些引用会一起改 */
    renameRefs: (old: string, refs: string) => `改名后，${refs}里的 ${old} 一起改为新名称。`,
    keysRef: (keys: string) => `密钥 ${keys} 的可见范围`,
    rulesRef: (rules: string) => `规则 ${rules}`,
    refsJoin: "和",

    models: "上游模型",
    modelsPlaceholder: "从上游的模型里选，或直接输入",
    enterToAdd: "回车添加",
    removeShort: "删除",
    remove: (m: string) => `删除 ${m}`,
    unserved: "没有上游提供",
    modelsWhat: "同一模型在各上游的名称。上游有其中任一名称，就由它提供；可添加多个。",
    modelsUnserved: (n: number) =>
      n === 1 ? "标黄的模型没有上游提供，请求不会发往它。" : `标黄的 ${n} 个模型没有上游提供，请求不会发往它们。`,

    sameModel: "其他上游的同一模型",
    sameModelWhat: "按名称认出的，确认是同一个模型再勾选。",

    sentTo: "发往各上游",
    sentHead: (name: string) => `客户端请求 ${name} 时`,
    sentHeadUnnamed: "客户端请求这个别名时",
    notServing: "（不提供，勾选上面一项后提供）",
    noLongerReceives: (name: string) => `（不再收到 ${name} 的请求）`,
    sentNone: "列出的模型没有上游提供。",
    sentEmpty: "添加上游模型后，这里列出各上游收到的模型名。",
    sentWhat: "请求发往哪个上游由路由决定。",
    previewFailed: (reason: string) => `无法预览：${reason}`,

    modelListsUpdate: (clients: string, creating: boolean) =>
      `${creating ? "创建后" : "保存后"}，已接管的 ${clients} 会提示更新模型列表`,
    needName: "填写名称",
    needModels: "添加上游模型",
    needOtherName: "添加这个模型在其他上游的名称",
    create: "创建",

    renamed: (old: string, name: string) => `已将别名 ${old} 改名为 ${name}`,
    renamedIn: (refs: string) => `${refs}里的名称已一起更新。`,

    sep: "、",
  },
  {
    createTitle: "New alias",
    editTitle: (name: string) => `Edit alias ${name}`,
    desc: "Give a model a name for clients to use. The original names keep working.",
    loading: "Loading the alias",
    notFound: (name: string) => `Alias ${name} is no longer in the config.`,

    name: "Name",
    nameHint: "Clients request this name.",
    namePlaceholder: "e.g. claude-sonnet-5",
    prefilled: (providers: string, name: string) =>
      `${providers} also has a model named ${name}; it is listed as the first upstream model.`,
    shadows: (providers: string, name: string, models: string, creating: boolean) =>
      `${providers} has a model named ${name}. ${creating ? "Once this alias exists" : "Once saved"}, every client requesting ${name} goes to ${models} instead, and ${providers} no longer receives it. To do this for one client only, write a rule for its key in Routing and forward to “Specific models”.`,
    writeRule: "Write a routing rule instead…",
    claudeCodeReserved: (name: string) =>
      `Claude Code treats ${name} as its own tier name and swaps in the full model name before requesting, so its requests never use this alias.`,
    familyMismatch: (family: string, model: string, clients: string) =>
      `The name looks like a ${family} model but the upstream model is ${model}: ${clients} will send requests with ${family} context lengths and parameters.`,
    desktopHidden: (name: string) => `Claude Desktop lists only models whose names look like Claude, so it will not show ${name}.`,
    desktopShown: (name: string) => `Claude Desktop will show ${name} in its model list.`,
    renameRefs: (old: string, refs: string) => `Renaming also changes ${old} to the new name in ${refs}.`,
    keysRef: (keys: string) => `the visible models of key ${keys}`,
    rulesRef: (rules: string) => `rule ${rules}`,
    refsJoin: " and ",

    models: "Upstream models",
    modelsPlaceholder: "Pick from upstream models, or type a name",
    enterToAdd: "Enter to add",
    removeShort: "Remove",
    remove: (m: string) => `Remove ${m}`,
    unserved: "No upstream serves it",
    modelsWhat:
      "The names of the same model on different upstreams. An upstream that has any of them serves the alias; add as many as needed.",
    modelsUnserved: (n: number) =>
      n === 1
        ? "No upstream serves the model marked in yellow; no request goes to it."
        : `No upstream serves the ${n} models marked in yellow; no request goes to them.`,

    sameModel: "The same model on other upstreams",
    sameModelWhat: "Recognised by name. Check one after confirming it is the same model.",

    sentTo: "Sent to each upstream",
    sentHead: (name: string) => `When a client requests ${name}`,
    sentHeadUnnamed: "When a client requests this alias",
    notServing: "(not served; check the entry above to serve it)",
    noLongerReceives: (name: string) => `(no longer receives requests for ${name})`,
    sentNone: "No upstream serves the listed models.",
    sentEmpty: "Once upstream models are added, the name each upstream receives is listed here.",
    sentWhat: "Routing decides which upstream a request goes to.",
    previewFailed: (reason: string) => `Preview unavailable: ${reason}`,

    modelListsUpdate: (clients: string, creating: boolean) =>
      `${creating ? "Once created" : "Once saved"}, the connected ${clients} will be offered a model list update`,
    needName: "Enter a name",
    needModels: "Add an upstream model",
    needOtherName: "Add this model's name on other upstreams",
    create: "Create",

    renamed: (old: string, name: string) => `Alias ${old} renamed to ${name}`,
    renamedIn: (refs: string) => `Updated in ${refs} as well.`,

    sep: ", ",
  },
);
