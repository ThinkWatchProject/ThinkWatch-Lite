import { messages } from "@/i18n";

export const importDialogText = messages(
  {
    title: "导入上游",
    desc: "以下设置来自一条导入链接，确认后创建为新的上游。",
    sendsTo: "请求内容与 API 密钥将发送至",
    trust: "仅在信任此服务时创建。",
    name: "名称",
    baseUrl: "接口地址",
    protocol: "接口协议",
    auto: "自动识别",
    key: "API 密钥",
    noKey: "未提供",
    models: "手动模型清单",
    create: "创建",
    created: (name: string) => `已创建上游「${name}」`,
  },
  {
    title: "Import upstream",
    desc: "The settings below come from an import link and are created as a new upstream once confirmed.",
    sendsTo: "Request content and the API key will be sent to",
    trust: "Create it only if this service is trusted.",
    name: "Name",
    baseUrl: "Base URL",
    protocol: "Protocol",
    auto: "Auto-detect",
    key: "API key",
    noKey: "Not provided",
    models: "Manual model list",
    create: "Create",
    created: (name: string) => `Upstream “${name}” created`,
  },
);
