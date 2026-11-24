import { messages } from "@/i18n";

export const pinnedModelsText = messages(
  {
    addModel: "添加模型",
    addBackup: "添加备用",
    note: "按顺序发送，前一个失败换下一个。模型名原样发出，不经过别名表。",
    provider: (n: number) => `第 ${n} 个指定模型的上游`,
    chooseProvider: "选择上游",
    missing: (name: string) => `${name}（不存在）`,
    disabled: (name: string) => `${name}（已停用）`,
    model: "上游模型 ID",
    remove: (n: number) => `删除第 ${n} 个指定模型`,
  },
  {
    addModel: "Add model",
    addBackup: "Add backup",
    note: "Sent in order; when one fails, the next is used. Model names are sent as written, without going through the alias table.",
    provider: (n: number) => `Upstream of specified model ${n}`,
    chooseProvider: "Select an upstream",
    missing: (name: string) => `${name} (not found)`,
    disabled: (name: string) => `${name} (disabled)`,
    model: "Upstream model ID",
    remove: (n: number) => `Remove specified model ${n}`,
  },
  {
    "zh-Hant": {
      addModel: "新增模型",
      addBackup: "新增備用",
      note: "按順序傳送，前一個失敗換下一個。模型名原樣發出，不經過別名表。",
      provider: (n: number) => `第 ${n} 個指定模型的上游`,
      chooseProvider: "選擇上游",
      model: "上游模型 ID",
      remove: (n: number) => `刪除第 ${n} 個指定模型`,
    },
    ko: {
      model: "업스트림 모델 ID",
    },
    es: {
      addModel: "Añadir modelo",
      addBackup: "Añadir copia de seguridad",
      note: "Enviado en orden; cuando uno falla, se usa el siguiente. Los nombres de los modelos se envían como escritos, sin pasar por la tabla de alias.",
      provider: (n: number) => `Corriente ascendente del modelo especificado ${n}`,
      chooseProvider: "Seleccione un cursor",
      missing: (name: string) => `${name} (no encontrado)`,
      disabled: (name: string) => `${name} (inhabilitado)`,
      model: "ID del modelo del proveedor",
      remove: (n: number) => `Eliminar el modelo especificado ${n}`,
    },
  },
);
