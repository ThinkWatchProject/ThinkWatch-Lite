import { messages } from "@/i18n";

export const labelsText = messages(
  {
    takeover: (client: string) => `接管 · ${client}`,
    takeoverOn: (client: string) => `接管 ${client} 时生成。接管期间不能删除。`,
    takeoverOff: (client: string) =>
      `接管 ${client} 时生成。${client} 已还原，这把密钥保留，再次接管时直接使用。`,
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
      `Generated when ${client} was connected. ${client} has been restored; the key is kept and used again on the next connection.`,
    allModels: "All",
    noModels: "None",
    models: (n: number) => (n === 1 ? "1 model" : `${n} models`),
    rules: (n: number) => (n === 1 ? "1 pattern" : `${n} patterns`),
    defaultRoute: "Default",
    defaultNamed: (route: string) => `Default (${route})`,
  },
);
