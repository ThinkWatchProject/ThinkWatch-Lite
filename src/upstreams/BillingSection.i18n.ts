import { messages } from "@/i18n";

export const billingSectionText = messages(
  {
    newUpstream: "（新建的上游）",
    billing: "计费方式",
    sheet: "价目表",
    defaultSheet: "默认价目表",
    newSheet: "新建价目表…",
    usedBy: "使用此价目表的上游",
    editSheet: "编辑价目表",
    effective: "生效价格",
    unit: "美元 / 百万 tokens",
    empty: "模型列表为空。获取模型列表后显示各模型的生效价格。",
    model: "模型",
    source: "来源",
    estimated: "（估算）",
    unpriced: (n: number) => `${n} 个模型无法计价，这些模型的请求无法计算费用。`,
    setPrices: "设置价格…",
  },
  {
    newUpstream: "(new upstream)",
    billing: "Billing",
    sheet: "Price sheet",
    defaultSheet: "Default price sheet",
    newSheet: "New price sheet…",
    usedBy: "Upstreams using this price sheet",
    editSheet: "Edit price sheet",
    effective: "Effective prices",
    unit: "USD / million tokens",
    empty: "The model list is empty. Effective prices appear once the model list is fetched.",
    model: "Model",
    source: "Source",
    estimated: " (estimated)",
    unpriced: (n: number) =>
      n === 1
        ? "1 model is unpriced; the cost of its requests cannot be calculated."
        : `${n} models are unpriced; the cost of their requests cannot be calculated.`,
    setPrices: "Set prices…",
  },
);
