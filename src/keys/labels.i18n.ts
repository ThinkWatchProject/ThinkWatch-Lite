import { messages } from "@/i18n";

export const labelsText = messages(
  {
    takeover: (client: string) => `接管 · ${client}`,
    takeoverOn: (client: string) => `接管 ${client} 时生成。接管期间不能删除。`,
    takeoverOff: (client: string) =>
      `为 ${client} 生成。${client} 当前未接管，这把密钥保留，接管时直接使用。`,
    manualFor: (client: string) => `手动配置 · ${client}`,
    manualTip: (client: string) => `为 ${client} 生成，按手动配置的步骤填入 ${client}。`,
    allModels: "全部",
    noModels: "无",
    models: (n: number) => `${n} 个模型`,
    rules: (n: number) => `${n} 条规则`,
    defaultRoute: "默认",
    defaultNamed: (route: string) => `默认（${route}）`,
  },
  {
    takeover: (client: string) => `Connected · ${client}`,
    takeoverOn: (client: string) =>
      `Generated when ${client} was connected. It cannot be deleted while the connection lasts.`,
    takeoverOff: (client: string) =>
      `Generated for ${client}. ${client} is not connected right now; the key is kept and used when it is.`,
    manualFor: (client: string) => `Set up by hand · ${client}`,
    manualTip: (client: string) => `Generated for ${client}, to be entered in ${client} following the setup steps.`,
    allModels: "All",
    noModels: "None",
    models: (n: number) => (n === 1 ? "1 model" : `${n} models`),
    rules: (n: number) => (n === 1 ? "1 pattern" : `${n} patterns`),
    defaultRoute: "Default",
    defaultNamed: (route: string) => `Default (${route})`,
  },
  {
    "zh-Hant": {
      takeoverOn: (client: string) => `接管 ${client} 時生成。接管期間不能刪除。`,
      takeoverOff: (client: string) => `為 ${client} 生成。${client} 當前未接管，這把金鑰保留，接管時直接使用。`,
      manualFor: (client: string) => `手動配置 · ${client}`,
      manualTip: (client: string) => `為 ${client} 生成，按手動配置的步驟填入 ${client}。`,
      noModels: "無",
      models: (n: number) => `${n} 個模型`,
      rules: (n: number) => `${n} 條規則`,
      defaultRoute: "預設",
      defaultNamed: (route: string) => `預設（${route}）`,
    },
    ko: {
      noModels: "없음",
      defaultRoute: "기본값",
    },
    es: {
      takeover: (client: string) => `Conectado · ${client}`,
      takeoverOn: (client: string) => `Generado cuando ${client} estaba conectado. No se puede eliminar mientras dure la conexión.`,
      takeoverOff: (client: string) => `Generado para ${client}. ${client} no está conectado en este momento; la clave se mantiene y se utiliza cuando está.`,
      manualFor: (client: string) => `Montado a mano · ${client}`,
      manualTip: (client: string) => `Generado para ${client}, que debe introducirse en ${client} siguiendo los pasos de configuración.`,
      allModels: "Todos",
      noModels: "Ninguno",
      models: (n: number) => (n === 1 ? "1 modelo" : `${n} modelos`),
      rules: (n: number) => (n === 1 ? "1 patrón" : `${n} patrones`),
      defaultRoute: "Predeterminado",
      defaultNamed: (route: string) => `Predeterminado ${route}`,
    },
  },
);
