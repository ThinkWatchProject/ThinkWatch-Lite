import { messages } from "@/i18n";

/** 英文的并列：a、a and b、a, b and c */
function enList(xs: readonly string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** 上游页「别名」标签：表格、顶部的建议、尚无别名时、同一模型不同名称的对话框、删除 */
export const aliasesText = messages(
  {
    tab: "别名",
    /** 标签名旁的小圆点，读屏用 */
    tabDot: "有可建为别名的模型",
    newAlias: "新建别名",
    loadFailed: "别名读取失败",

    alias: "别名",
    aliasOnly: "客户端仅展示别名",
    models: "上游模型",
    context: "上下文",
    day: "24 小时",
    actionsColumn: "操作",
    actions: (name: string) => `${name} 的操作`,
    requests: (n: number) => `${n.toLocaleString()} 次`,
    /** 「上游模型」一格里没有上游提供的那个名称，悬停时 */
    notOffered: "没有上游提供这个名称",
    unserved: (models: number): string =>
      models === 1
        ? "没有上游提供这个模型，使用这个别名的请求会失败"
        : "没有上游提供列表中的任何一个模型，使用这个别名的请求会失败",
    shadowed: (providers: readonly string[], name: string) =>
      `${providers.join("、")} 也有名为 ${name} 的模型，未列入，不会被使用`,

    copyName: "复制名称",
    traffic: "查看流量",

    /** 顶部只有一条建议时 */
    oneSuggestion: (label: string, providers: readonly string[]) =>
      `${label} 在 ${providers.join("、")} 上的名称各不相同。建为别名后，这几个上游可以互为备用。`,
    /** 顶部有几条建议时 */
    manySuggestions: (n: number) =>
      `${n} 个模型在几个上游的名称各不相同。建为别名后，这些上游可以互为备用。`,
    createFrom: "建为别名…",
    view: "查看…",
    ignore: "忽略",

    empty: "尚无别名",
    emptyDesc:
      "别名是客户端使用的一个名称，指向一个模型。同一个模型在几个上游的名称不同时，把这些名称列在一个别名下，这几个上游就能互为备用。",
    emptySuggestions: "这些模型在几个上游的名称不同",

    suggestTitle: "同一模型的不同名称",
    suggestDesc: "这些模型在几个上游的名称各不相同。建为别名后，这几个上游可以互为备用。",
    suggestScope: "只认 Claude 模型在官方、Bedrock、Vertex、OpenRouter 上的名称，日期版本不同的不算同一个。",

    deleteTitle: (name: string) => `删除别名「${name}」`,
    inUse: "以下地方在用这个名称。删除后，使用它的请求会失败，按它写的规则和可见范围不再起作用。",
    unused: "删除后，此别名将从配置文件中移除。",
    usageFailed: (reason: string) => `使用情况读取失败：${reason}`,
    usedByRequests: (n: number) => `过去 24 小时 ${n.toLocaleString()} 次请求`,
    usedByKey: (key: string) => `密钥「${key}」的可见模型`,
    usedByCondition: (route: string, rule: string) => `路由「${route}」· 规则「${rule}」的条件`,
    usedByRewrite: (route: string, rule: string) => `路由「${route}」· 规则「${rule}」的模型改写`,
    usedByRule: (route: string, rule: string) => `路由「${route}」· 规则「${rule}」`,
    usedByClients: (names: readonly string[]) => `已接管的 ${names.join("、")} 的模型列表`,
    show: "查看",
    kept: (models: readonly string[]) => `上游模型 ${models.join("、")} 照常可用。可从备份中恢复。`,
  },
  {
    tab: "Aliases",
    tabDot: "Some models could become aliases",
    newAlias: "New alias",
    loadFailed: "Could not load the aliases",

    alias: "Alias",
    aliasOnly: "Alias only in client lists",
    models: "Upstream models",
    context: "Context",
    day: "24 hours",
    actionsColumn: "Actions",
    actions: (name: string) => `Actions for ${name}`,
    requests: (n: number) => (n === 1 ? "1 request" : `${n.toLocaleString()} requests`),
    notOffered: "No upstream offers this name",
    unserved: (models: number) =>
      models === 1
        ? "No upstream offers this model; requests for this alias will fail"
        : "No upstream offers any of these models; requests for this alias will fail",
    shadowed: (providers: readonly string[], name: string) =>
      `${enList(providers)} also ${providers.length === 1 ? "has" : "have"} a model named ${name}; it is not listed, so it is not used`,

    copyName: "Copy name",
    traffic: "View traffic",

    oneSuggestion: (label: string, providers: readonly string[]) =>
      `${label} has a different name on each of ${enList(providers)}. As one alias, these upstreams can stand in for each other.`,
    manySuggestions: (n: number) =>
      `${n} models have different names on different upstreams. As aliases, those upstreams can stand in for each other.`,
    createFrom: "Create alias…",
    view: "View…",
    ignore: "Dismiss",

    empty: "No aliases",
    emptyDesc:
      "An alias is a name clients use for a model. When a model has different names on different upstreams, list those names under one alias and the upstreams can stand in for each other.",
    emptySuggestions: "These models have different names on different upstreams",

    suggestTitle: "One model, different names",
    suggestDesc:
      "These models have different names on different upstreams. As aliases, those upstreams can stand in for each other.",
    suggestScope:
      "Only Claude model names on Anthropic, Bedrock, Vertex and OpenRouter are recognised; names with different dates count as different models.",

    deleteTitle: (name: string) => `Delete alias “${name}”`,
    inUse:
      "This name is used in the places below. After deletion, requests using it fail, and rules and visible-model lists that name it no longer apply.",
    unused: "Deleting removes this alias from the config file.",
    usageFailed: (reason: string) => `Could not load where this name is used: ${reason}`,
    usedByRequests: (n: number) =>
      n === 1 ? "1 request in the last 24 hours" : `${n.toLocaleString()} requests in the last 24 hours`,
    usedByKey: (key: string) => `Visible models of key “${key}”`,
    usedByCondition: (route: string, rule: string) => `Route “${route}” · condition of rule “${rule}”`,
    usedByRewrite: (route: string, rule: string) => `Route “${route}” · model rewrite of rule “${rule}”`,
    usedByRule: (route: string, rule: string) => `Route “${route}” · rule “${rule}”`,
    usedByClients: (names: readonly string[]) =>
      `The model ${names.length === 1 ? "list" : "lists"} of ${enList(names)} (connected)`,
    show: "Show",
    kept: (models: readonly string[]) =>
      `The upstream ${models.length === 1 ? "model" : "models"} ${enList(models)} remain${models.length === 1 ? "s" : ""} available. The alias can be restored from the backups.`,
  },
  {
    "zh-Hant": {
      tab: "別名",
      tabDot: "有可建為別名的模型",
      newAlias: "新建別名",
      loadFailed: "別名讀取失敗",
      alias: "別名",
      aliasOnly: "用戶端僅展示別名",
      day: "24 小時",
      notOffered: "沒有上游提供這個名稱",
      unserved: (models: number): string => models === 1
        ? "沒有上游提供這個模型，使用這個別名的請求會失敗"
        : "沒有上游提供列表中的任何一個模型，使用這個別名的請求會失敗",
      shadowed: (providers: readonly string[], name: string) => `${providers.join("、")} 也有名為 ${name} 的模型，未列入，不會被使用`,
      copyName: "複製名稱",
      traffic: "檢視流量",
      oneSuggestion: (label: string, providers: readonly string[]) => `${label} 在 ${providers.join("、")} 上的名稱各不相同。建為別名後，這幾個上游可以互為備用。`,
      manySuggestions: (n: number) => `${n} 個模型在幾個上游的名稱各不相同。建為別名後，這些上游可以互為備用。`,
      createFrom: "建為別名…",
      view: "檢視…",
      empty: "尚無別名",
      emptyDesc: "別名是用戶端使用的一個名稱，指向一個模型。同一個模型在幾個上游的名稱不同時，把這些名稱列在一個別名下，這幾個上游就能互為備用。",
      emptySuggestions: "這些模型在幾個上游的名稱不同",
      suggestTitle: "同一模型的不同名稱",
      suggestDesc: "這些模型在幾個上游的名稱各不相同。建為別名後，這幾個上游可以互為備用。",
      suggestScope: "只認 Claude 模型在官方、Bedrock、Vertex、OpenRouter 上的名稱，日期版本不同的不算同一個。",
      deleteTitle: (name: string) => `刪除別名「${name}」`,
      inUse: "以下地方在用這個名稱。刪除後，使用它的請求會失敗，按它寫的規則和可見範圍不再起作用。",
      unused: "刪除後，此別名將從配置檔案中移除。",
      usageFailed: (reason: string) => `使用情況讀取失敗：${reason}`,
      usedByRequests: (n: number) => `過去 24 小時 ${n.toLocaleString()} 次請求`,
      usedByKey: (key: string) => `金鑰「${key}」的可見模型`,
      usedByCondition: (route: string, rule: string) => `路由「${route}」· 規則「${rule}」的條件`,
      usedByRewrite: (route: string, rule: string) => `路由「${route}」· 規則「${rule}」的模型改寫`,
      usedByRule: (route: string, rule: string) => `路由「${route}」· 規則「${rule}」`,
      show: "檢視",
      kept: (models: readonly string[]) => `上游模型 ${models.join("、")} 照常可用。可從備份中恢復。`,
    },
    ko: {
      actionsColumn: "작업",
    },
    es: {
      tab: "Alias",
      tabDot: "Algunos modelos podrían convertirse en alias",
      newAlias: "Nuevo alias",
      loadFailed: "No se pudieron cargar los alias",
      aliasOnly: "Alias sólo en las listas de clientes",
      models: "Modelos ascendentes",
      context: "Contexto",
      day: "24 horas",
      actionsColumn: "Acciones",
      actions: (name: string) => `Acciones en relación con ${name}`,
      requests: (n: number) => (n === 1 ? "1 solicitud" : `${n.toLocaleString()} solicitudes`),
      notOffered: "Ningún río arriba ofrece este nombre",
      unserved: (models: number) => models === 1
        ? "Ningún modelo anterior ofrece este modelo; las solicitudes para este alias fallarán"
        : "Ningún modelo anterior ofrece ninguno de estos modelos; las solicitudes para este alias fallarán",
      shadowed: (providers: readonly string[], name: string) => `${enList(providers)} también ${providers.length === 1 ? "tiene" : "tener"} un modelo denominado ${name}; no está enumerado, por lo que no se utiliza`,
      copyName: "Copiar nombre",
      traffic: "Ver tráfico",
      oneSuggestion: (label: string, providers: readonly string[]) => `${label} tiene un nombre diferente en cada uno de ${enList(providers)}. Como un alias, estas del proveedor pueden estar el uno para el otro.`,
      manySuggestions: (n: number) => `${n} los modelos tienen nombres diferentes en diferentes del proveedor. Como alias, esas del proveedor pueden apoyarse mutuamente.`,
      createFrom: "Crear alias…",
      view: "Ver…",
      ignore: "Desestimar",
      empty: "Sin alias",
      emptyDesc: "Un alias es un nombre que los clientes usan para un modelo. Cuando un modelo tiene nombres diferentes en diferentes del proveedor, lista esos nombres bajo un alias y los del proveedor pueden estar el uno para el otro.",
      emptySuggestions: "Estos modelos tienen nombres diferentes en diferentes del proveedor",
      suggestTitle: "Un modelo, nombres diferentes",
      suggestDesc: "Estos modelos tienen nombres diferentes en diferentes del proveedor. Como alias, esas del proveedor pueden estar el uno para el otro.",
      suggestScope: "Solo se reconocen los nombres de modelos de Claude en Anthropic, Bedrock, Vertex y OpenRouter; los nombres con fechas diferentes cuentan como modelos diferentes.",
      deleteTitle: (name: string) => `Suprímase el alias “${name}”`,
      inUse: "Este nombre se utiliza en los siguientes lugares. Después de la eliminación, las solicitudes que lo utilizan fallan, y las reglas y listas de modelos visibles que nombre ya no se aplican.",
      unused: "Eliminar elimina este alias del archivo de configuraciónuración.",
      usageFailed: (reason: string) => `No se pudo cargar donde se utiliza este nombre: ${reason}`,
      usedByRequests: (n: number) => n === 1 ? "1 solicitud en las últimas 24 horas" : `${n.toLocaleString()} solicitudes en las últimas 24 horas`,
      usedByKey: (key: string) => `Modelos visibles de clave “${key}”`,
      usedByCondition: (route: string, rule: string) => `Ruta “${route}” · condición de la regla “${rule}”`,
      usedByRewrite: (route: string, rule: string) => `Ruta “${route}” · reescritura del modelo de la regla “${rule}”`,
      usedByRule: (route: string, rule: string) => `Ruta “${route}” · regla “${rule}”`,
      usedByClients: (names: readonly string[]) => `El modelo ${names.length === 1 ? "lista" : "listas"} de ${enList(names)} (conectado)`,
      show: "Mostrar",
      kept: (models: readonly string[]) => `El principio ${models.length === 1 ? "modelo" : "modelos"} ${enList(models)} permanece disponible${models.length === 1 ? "s" : ""}. El alias se puede restaurar de las copias de seguridad.`,
    },
  },
);
