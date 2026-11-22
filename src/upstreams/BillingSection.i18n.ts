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
    /** 导入链接带来的新价目表，在下拉里 */
    linkSheet: (name: string) => `新价目表「${name}」`,
    unnamed: "未命名",
    linkSheetDetail: (multiplier: number, overrides: number) =>
      `随上游一起创建 · 倍率 ×${multiplier} · ${overrides} 个模型单独定价`,
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
    linkSheet: (name: string) => `New price sheet “${name}”`,
    unnamed: "untitled",
    linkSheetDetail: (multiplier: number, overrides: number) =>
      `Created with the upstream · multiplier ×${multiplier} · ${overrides === 1 ? "1 model" : `${overrides} models`} priced separately`,
  },
  {
    "zh-Hant": {
      billing: "計費方式",
      sheet: "價目表",
      defaultSheet: "預設價目表",
      newSheet: "新建價目表…",
      usedBy: "使用此價目表的上游",
      editSheet: "編輯價目表",
      effective: "生效價格",
      unit: "美元 / 百萬 tokens",
      empty: "模型列表為空。獲取模型列表後顯示各模型的生效價格。",
      source: "來源",
      unpriced: (n: number) => `${n} 個模型無法計價，這些模型的請求無法計算費用。`,
      setPrices: "設定價格…",
      linkSheet: (name: string) => `新價目表「${name}」`,
      linkSheetDetail: (multiplier: number, overrides: number) => `隨上游一起建立 · 倍率 ×${multiplier} · ${overrides} 個模型單獨定價`,
    },
    ko: {
      model: "모델",
      source: "출처",
    },
    es: {
      newUpstream: "(nuevas del proveedor)",
      billing: "Facturas",
      sheet: "Ficha de precios",
      defaultSheet: "Ficha de precios por defecto",
      newSheet: "Nueva hoja de precios…",
      usedBy: "Upstreams usando esta hoja de precios",
      editSheet: "Editar hoja de precios",
      effective: "Precios efectivos",
      unit: "USD / millones de fichas",
      empty: "La lista de modelos está vacía. Los precios efectivos aparecen una vez que se obtiene la lista de modelo.",
      model: "Modelo",
      source: "Origen",
      estimated: " (estimado)",
      unpriced: (n: number) => n === 1
        ? "1 modelo no tiene precio; el costo de sus solicitudes no puede calcularse."
        : `${n} los modelos no tienen precio; el costo de sus solicitudes no puede calcularse.`,
      setPrices: "Fijar precios…",
      linkSheet: (name: string) => `Nueva hoja de precios “${name}”`,
      unnamed: "sin título",
      linkSheetDetail: (multiplier: number, overrides: number) => `Creado con el multiplicador · del proveedor ×${multiplier} · ${overrides === 1 ? "1 modelo" : `${overrides} modelos`} precio por separado`,
    },
  },
);
