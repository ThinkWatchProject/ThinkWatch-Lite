import { messages } from "@/i18n";

/** 至多列出这么多个模型名，多出来的说一共几个 */
const LISTED = 3;

function modelsZh(models: string[]): string {
  const head = models.slice(0, LISTED).join("、");
  return models.length > LISTED ? `${head} 等 ${models.length} 个模型` : head;
}

function modelsEn(models: string[]): string {
  const head = models.slice(0, LISTED).join(", ");
  return models.length > LISTED ? `${head} and ${models.length - LISTED} more` : head;
}

export const upstreamDialogText = messages(
  {
    sections: {
      service: "服务类型",
      connection: "连接",
      account: "账号",
      models: "模型",
      billing: "计费",
    },
    connectionFailed: (error: string) => `连接失败：${error}`,
    unknownError: "未知错误",
    /** 点「下一步」检测没通过时底部那一条 */
    checkFailed: "连接失败",
    continueAnyway: "仍然继续",
    titleEdit: "编辑上游",
    titleNew: "新建上游",
    pickService: "选择要接入的服务",
    /** 这两条嵌在模型一节「N 个已启用的模型在…中未定价」的句子里：英文小写、带冠词 */
    namedSheet: (name: string) => `价目表「${name}」`,
    defaultSheet: "默认价目表",
    back: "上一步",
    next: "下一步",
    create: "创建",
    finish: "完成",
    cancelSignIn: "取消登录",
    /** 登录成功、概览还没读到这个上游的那一下 */
    signingIn: "正在读取上游",
    createdNote: "上游已创建，关闭对话框不会撤销登录",
    name: "名称",
    nameTaken: "这个名称已被占用",
    nameReplaces: "将替换该上游的密钥",
    /** 导入链接打开的对话框，每一步顶上那一句：「来自导入链接。请求和密钥将发往 a 和 b。」 */
    importFrom: "来自导入链接。",
    importSendsTo: "请求和密钥将发往 ",
    importAnd: " 和 ",
    importEnd: "。",
    importPlain: "这个地址不加密，密钥和请求内容以明文传输。",
    specsKept: (n: number) => `${n} 个模型的规格来自导入链接，随上游一起保存。`,
    specsSkipped: (models: string[]) => `${modelsZh(models)} 不在模型列表中，其规格不保存。`,
    specsFailed: (models: string[]) => `${modelsZh(models)} 的规格未能保存`,
  },
  {
    sections: {
      service: "Service",
      connection: "Connection",
      account: "Account",
      models: "Models",
      billing: "Billing",
    },
    connectionFailed: (error: string) => `Connection failed: ${error}`,
    unknownError: "Unknown error",
    checkFailed: "Connection failed",
    continueAnyway: "Continue anyway",
    titleEdit: "Edit upstream",
    titleNew: "New upstream",
    pickService: "Choose the service to connect",
    namedSheet: (name: string) => `price sheet “${name}”`,
    defaultSheet: "the default price sheet",
    back: "Back",
    next: "Next",
    create: "Create",
    finish: "Done",
    cancelSignIn: "Cancel sign-in",
    signingIn: "Reading the upstream",
    createdNote: "The upstream has been created; closing this dialog does not undo the sign-in",
    name: "Name",
    nameTaken: "This name is already in use",
    nameReplaces: "The key of that upstream will be replaced",
    importFrom: "From an import link. ",
    importSendsTo: "Requests and keys will be sent to ",
    importAnd: " and ",
    importEnd: ".",
    importPlain: "This address is not encrypted; the key and request content travel in plain text.",
    specsKept: (n: number) =>
      n === 1
        ? "The specs of 1 model come from the import link and are saved with the upstream."
        : `The specs of ${n} models come from the import link and are saved with the upstream.`,
    specsSkipped: (models: string[]) =>
      models.length === 1
        ? `${modelsEn(models)} is not on the model list; its specs are not saved.`
        : `${modelsEn(models)} are not on the model list; their specs are not saved.`,
    specsFailed: (models: string[]) => `The specs of ${modelsEn(models)} could not be saved`,
  },
);
