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
    model: "模型名",
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
    model: "Model name",
    remove: (n: number) => `Remove specified model ${n}`,
  },
);
