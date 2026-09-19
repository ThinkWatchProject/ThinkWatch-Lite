import { messages } from "@/i18n";

export const labelsText = messages(
  {
    manual: "手动配置的客户端",
    connected: "已接管",
    notConnected: "未接管",
    allModels: "不限",
    noModels: "一个都不给",
    models: (n: number) => `${n} 个模型`,
    defaultRoute: "默认",
    defaultNamed: (route: string) => `默认（${route}）`,
  },
  {
    manual: "Manually configured clients",
    connected: "Connected",
    notConnected: "Not connected",
    allModels: "All models",
    noModels: "No models",
    models: (n: number) => (n === 1 ? "1 model" : `${n} models`),
    defaultRoute: "Default",
    defaultNamed: (route: string) => `Default (${route})`,
  },
);
