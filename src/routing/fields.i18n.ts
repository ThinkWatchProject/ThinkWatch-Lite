import { messages } from "@/i18n";

export const fieldsText = messages(
  {
    modelName: "模型名",
    noMatch: "无匹配项，可直接输入完整模型名",
    alias: "别名",
    hiddenFromClients: "客户端列表已隐藏",
    providers: (ps: readonly string[]) => ps.join("、"),
  },
  {
    modelName: "Model name",
    noMatch: "No matching model; any full model name can be entered",
    alias: "alias",
    hiddenFromClients: "hidden from client lists",
    providers: (ps: readonly string[]) => ps.join(", "),
  },
  {
    "zh-Hant": {
      noMatch: "無匹配項，可直接輸入完整模型名",
      alias: "別名",
      hiddenFromClients: "用戶端列表已隱藏",
    },
    es: {
      modelName: "Nombre del modelo",
      noMatch: "No hay modelo de coincidencia; cualquier nombre de modelo completo puede ser introducido",
      hiddenFromClients: "ocultado de las listas de clientes",
    },
  },
);
