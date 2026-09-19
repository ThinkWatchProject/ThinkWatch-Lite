import { messages } from "@/i18n";

export const modelsSectionText = messages(
  {
    title: "模型列表",
    count: (n: number) => `${n} 个`,
    fetchedAt: (time: string) => `获取于 ${time}`,
    refresh: "刷新模型列表",
    fetching: "正在获取模型列表",
    notFetched: "尚未获取模型列表。",
    manual: "手动清单",
    manualDesc: (error?: string | null) =>
      `${error ? `${error}。` : "未获取到模型列表。"}每行填写一个模型 ID，这些模型会出现在客户端的模型列表中。`,
    scope: "启用范围",
    all: "全部模型",
    some: "指定模型",
    patterns: (patterns: string[]) =>
      `启用范围包含通配规则 ${patterns.join("、")}。勾选或取消勾选后，范围改为所勾选的模型。`,
    filter: "筛选模型",
    enabled: (on: number, total: number) => `已启用 ${on} / ${total}`,
    selectAll: "全选",
    modelId: "模型 ID",
    context: "上下文窗口",
    pricing: "定价",
    priced: "已定价",
    pricedEstimated: "已定价（估算）",
    unpriced: "未定价",
    unpricedNote: (n: number, sheet: string) =>
      `${n} 个已启用的模型在${sheet}中未定价，这些模型的请求无法计算费用。可在「计费」中为其设置价格。`,
  },
  {
    title: "Model list",
    count: (n: number) => (n === 1 ? "1 model" : `${n} models`),
    fetchedAt: (time: string) => `fetched at ${time}`,
    refresh: "Refresh model list",
    fetching: "Fetching the model list",
    notFetched: "The model list has not been fetched.",
    manual: "Manual list",
    manualDesc: (error?: string | null) =>
      `${error ? `${error}.` : "No model list was fetched."} One model ID per line; these models appear in the model lists clients see.`,
    scope: "Enabled models",
    all: "All models",
    some: "Selected models",
    patterns: (patterns: string[]) =>
      `The enabled models include wildcard patterns ${patterns.join(", ")}. Checking or unchecking a model replaces them with the checked models.`,
    filter: "Filter models",
    enabled: (on: number, total: number) => `${on} / ${total} enabled`,
    selectAll: "Select all",
    modelId: "Model ID",
    context: "Context window",
    pricing: "Price",
    priced: "Priced",
    pricedEstimated: "Priced (estimated)",
    unpriced: "Unpriced",
    unpricedNote: (n: number, sheet: string) =>
      n === 1
        ? `1 enabled model is unpriced in ${sheet}, so the cost of its requests cannot be calculated. Prices can be set in Billing.`
        : `${n} enabled models are unpriced in ${sheet}, so the cost of their requests cannot be calculated. Prices can be set in Billing.`,
  },
);
