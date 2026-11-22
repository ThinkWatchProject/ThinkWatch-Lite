import { messages } from "@/i18n";

/** 名单式输入本身的那些字（提示、回车添加、毛病）在 `ManualModelInput.i18n` */
export const manualModelsDialogText = messages(
  {
    title: "添加模型",
    remove: (id: string) => `移除 ${id}`,
    removeShort: "移除",
    outOfScope: "不在启用范围内",
  },
  {
    title: "Add models",
    remove: (id: string) => `Remove ${id}`,
    removeShort: "Remove",
    outOfScope: "Not enabled",
  },
  {
    "zh-Hant": {
      title: "新增模型",
      outOfScope: "不在啟用範圍內",
    },
    ko: {
      removeShort: "제거",
    },
    es: {
      title: "Añadir modelos",
      remove: (id: string) => `Eliminar ${id}`,
      removeShort: "Quitar",
      outOfScope: "No activado",
    },
  },
);
