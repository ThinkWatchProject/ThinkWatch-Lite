import { messages } from "@/i18n";

export const labelsText = messages(
  {
    manual: "手动配置的客户端",
    connected: "已接管",
    notConnected: "未接管",
    allModels: "全部",
    noModels: "无",
    models: (n: number) => `${n} 个模型`,
    rules: (n: number) => `${n} 条规则`,
    defaultRoute: "默认",
    defaultNamed: (route: string) => `默认（${route}）`,
  },
  {
    manual: "Manually configured clients",
    connected: "Connected",
    notConnected: "Not connected",
    allModels: "All",
    noModels: "None",
    models: (n: number) => (n === 1 ? "1 model" : `${n} models`),
    rules: (n: number) => (n === 1 ? "1 pattern" : `${n} patterns`),
    defaultRoute: "Default",
    defaultNamed: (route: string) => `Default (${route})`,
  },
);
