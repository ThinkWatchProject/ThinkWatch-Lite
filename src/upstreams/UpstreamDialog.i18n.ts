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
  {
    "zh-Hant": {
      sections: {
        service: "服務型別",
        connection: "連線",
        account: "帳號",
        models: "模型",
        billing: "計費",
      },
      connectionFailed: (error: string) => `連線失敗：${error}`,
      unknownError: "未知錯誤",
      checkFailed: "連線失敗",
      continueAnyway: "仍然繼續",
      titleEdit: "編輯上游",
      pickService: "選擇要接入的服務",
      namedSheet: (name: string) => `價目表「${name}」`,
      defaultSheet: "預設價目表",
      create: "建立",
      cancelSignIn: "取消登入",
      signingIn: "正在讀取上游",
      createdNote: "上游已建立，關閉對話方塊不會撤銷登入",
      name: "名稱",
      nameTaken: "這個名稱已被佔用",
      nameReplaces: "將替換該上游的金鑰",
      importFrom: "來自匯入連結。",
      importSendsTo: "請求和金鑰將發往 ",
      importPlain: "這個地址不加密，金鑰和請求內容以明文傳輸。",
      specsKept: (n: number) => `${n} 個模型的規格來自匯入連結，隨上游一起儲存。`,
      specsSkipped: (models: string[]) => `${modelsZh(models)} 不在模型列表中，其規格不儲存。`,
      specsFailed: (models: string[]) => `${modelsZh(models)} 的規格未能儲存`,
    },
    ko: {
      sections: {
        service: "Service",
        connection: "연결",
        account: "Account",
        models: "모델",
        billing: "Billing",
      },
      name: "이름",
    },
    es: {
      sections: {
        service: "Servicio",
        connection: "Conexión",
        account: "Cuenta",
        models: "Modelos",
        billing: "Facturas",
      },
      connectionFailed: (error: string) => `Falló la conexión: ${error}`,
      unknownError: "Error desconocido",
      checkFailed: "Ha fallado la conexión",
      continueAnyway: "Continúa de todos modos.",
      titleEdit: "Editar en sentido ascendente",
      titleNew: "Nueva fase anterior",
      pickService: "Elija el servicio a conectar",
      namedSheet: (name: string) => `hoja de precios “${name}”`,
      defaultSheet: "la hoja de precios por defecto",
      back: "Atrás",
      next: "Siguiente",
      create: "Crear",
      finish: "Hecho",
      cancelSignIn: "Cancelar el inicio de sesión",
      signingIn: "Leyendo el curso previo",
      createdNote: "Se ha creado el upstream; cerrar este diálogo no deshaga el inicio de sesión",
      name: "Nombre",
      nameTaken: "Este nombre ya está en uso",
      nameReplaces: "Se sustituirá la clave de esa corriente.",
      importFrom: "De un enlace de importación. ",
      importSendsTo: "Solicitudes y claves serán enviadas a ",
      importAnd: " y ",
      importPlain: "Esta dirección no está cifrada; la clave y el contenido de la solicitud viajan en texto plano.",
      specsKept: (n: number) => n === 1
        ? "Las especificaciones de 1 modelo provienen del enlace de importación y se guardan con el upstream."
        : `Las especificaciones de los modelos ${n} provienen del enlace de importación y se guardan con el upstream.`,
      specsSkipped: (models: string[]) => models.length === 1
        ? `${modelsEn(models)} no está en la lista de modelos; sus especificaciones no se guardan.`
        : `${modelsEn(models)} no están en la lista de modelos; sus especificaciones no se guardan.`,
      specsFailed: (models: string[]) => `Las especificaciones de ${modelsEn(models)} no pudieron ser salvadas`,
    },
  },
);
