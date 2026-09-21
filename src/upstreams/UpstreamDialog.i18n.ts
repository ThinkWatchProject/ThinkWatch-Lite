import { messages } from "@/i18n";

export const upstreamDialogText = messages(
  {
    sections: {
      connection: "连接",
      account: "账号",
      models: "模型",
      billing: "计费",
    },
    connectionFailed: (error: string) => `连接失败：${error}`,
    unknownError: "未知错误",
    titleEdit: "编辑上游",
    titleNew: "新建上游",
    desc: "填写连接信息，选择模型范围与计费方式。",
    /** 这两条嵌在模型一节「N 个已启用的模型在…中未定价」的句子里：英文小写、带冠词 */
    namedSheet: (name: string) => `价目表「${name}」`,
    defaultSheet: "默认价目表",
    back: "上一步",
    next: "下一步",
    create: "创建",
  },
  {
    sections: {
      connection: "Connection",
      account: "Account",
      models: "Models",
      billing: "Billing",
    },
    connectionFailed: (error: string) => `Connection failed: ${error}`,
    unknownError: "Unknown error",
    titleEdit: "Edit upstream",
    titleNew: "New upstream",
    desc: "Enter the connection details, then choose the enabled models and billing.",
    namedSheet: (name: string) => `price sheet “${name}”`,
    defaultSheet: "the default price sheet",
    back: "Back",
    next: "Next",
    create: "Create",
  },
);
