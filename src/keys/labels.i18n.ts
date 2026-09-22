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
);
