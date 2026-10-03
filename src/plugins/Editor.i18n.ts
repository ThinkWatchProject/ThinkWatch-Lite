import { messages } from "@/i18n";

/**
 * 添加插件时编辑器里的那一段模板：**装得上**（manifest 是纯数据，写成 core 改写它时的样子，
 * 权限和钩子对得上），附加内容为空时什么都不改。注释写在 manifest 外面：core 改写 manifest
 * 时不保留它里面的注释。
 */
const template = (lines: string[]) => `${lines.join("\n")}\n`;

export const editorText = messages(
  {
    tabSettings: "设置",
    tabCode: "代码",
    /** 「代码」标签上的红点：代码无法加载 */
    codeHasError: "代码无法加载",

    id: (id: string) => `ID ${id}`,
    sha: (prefix: string) => `SHA-256 ${prefix}`,

    /** 添加插件：代码里的名字还没读出来时的标题 */
    newTitle: "添加插件",
    install: "安装",
    idLabel: "插件 ID",
    idHint: "小写字母、数字和连字符，最多 40 个；安装后不可修改。",
    idProblems: {
      bad: "只能使用小写字母、数字和连字符，最多 40 个。",
      reserved: "此 ID 为保留词，不能使用。",
      taken: "已有插件使用此 ID。",
    },
    templateFailed: "无法打开插件模板",
    template: template([
      "// 插件在请求发往上游之前改写请求，也可以在回答交给客户端之前改写回答。",
      "// manifest 须为纯数据；「设置」页中的修改写回 manifest。",
      "",
      "export const manifest = {",
      '  name: "新插件",',
      "  api: 1,",
      '  description: "在系统提示词末尾附加「附加内容」中的文字。",',
      '  permissions: ["system"],',
      '  on_error: "reject",',
      '  settings: { note: { type: "string", label: "附加内容", value: "" } },',
      "};",
      "",
      "// 请求发往上游之前调用：req.system 为系统提示词，ctx.settings 为设置项的值。",
      "// 返回修改后的 req；返回 undefined 表示不修改。",
      "export function onRequest(req, ctx) {",
      '  const note = String(ctx.settings.note ?? "").trim();',
      '  if (note === "" || req.system.includes(note)) return undefined;',
      '  req.system = req.system ? req.system + "\\n\\n" + note : note;',
      "  return req;",
      "}",
    ]),

    enabled: "启用",
    enabledHint: "停用后此插件不运行，适用范围内的请求照常转发。",

    // 代码读不了时，设置页上的一条
    codeError: "代码无法加载",
    codeErrorHint: "修复代码之后才能修改以下设置。",
    codeErrorNoForm: "修复代码之后才能修改此插件的设置。",
    viewCode: "查看代码",

    // 打开时磁盘上的文件和确认过的不一样（状态「文件已更改」）
    diskChanged: "磁盘上的文件已更改",
    diskChangedHint: "此处是已确认的代码。保存时将以此处的代码覆盖磁盘上的文件。",
    reviewChanges: "审核更改",

    importFile: "从文件导入…",
    tooLarge: (size: string) => `文件为 ${size}，超过 1 MB 的上限。`,
    readFailed: "无法读取此文件。",
    checking: "正在检查代码",
    cannotLoad: "代码无法加载",

    loadFailed: "插件代码读取失败",
    noCode: "插件文件和已确认的代码均无法读取。",

    unsaved: "有未保存的更改",
    /** 系统的确认框里点了「取消」：什么都没写 */
    cancelled: "已取消，配置未改动。",

    discardTitle: "放弃未保存的更改",
    discardDescription: "关闭之后，对设置和代码的更改都不会保存。",
    /** 添加插件时关掉 */
    discardNewDescription: "关闭之后，此插件不会安装，代码和设置都不会保留。",
    keepEditing: "继续编辑",
    discard: "放弃更改",
  },
  {
    tabSettings: "Settings",
    tabCode: "Code",
    codeHasError: "The code cannot be loaded",

    id: (id: string) => `ID ${id}`,
    sha: (prefix: string) => `SHA-256 ${prefix}`,

    newTitle: "Add plugin",
    install: "Install",
    idLabel: "Plugin ID",
    idHint: "Lowercase letters, digits and hyphens, up to 40. It cannot be changed after installing.",
    idProblems: {
      bad: "Use only lowercase letters, digits and hyphens, up to 40.",
      reserved: "This ID is reserved and cannot be used.",
      taken: "Another plugin already uses this ID.",
    },
    templateFailed: "The plugin template could not be opened",
    template: template([
      "// A plugin changes requests before they reach an upstream, and can change answers before",
      "// they reach the client. The manifest must be plain data: the Settings tab writes its",
      "// changes into it.",
      "",
      "export const manifest = {",
      '  name: "New plugin",',
      "  api: 1,",
      '  description: "Adds the text of the Note setting to the end of the system prompt.",',
      '  permissions: ["system"],',
      '  on_error: "reject",',
      '  settings: { note: { type: "string", label: "Note", value: "" } },',
      "};",
      "",
      "// Runs before a request goes to the upstream: req.system is the system prompt, and",
      "// ctx.settings holds the values of the settings. Return the changed req, or undefined",
      "// to leave the request unchanged.",
      "export function onRequest(req, ctx) {",
      '  const note = String(ctx.settings.note ?? "").trim();',
      '  if (note === "" || req.system.includes(note)) return undefined;',
      '  req.system = req.system ? req.system + "\\n\\n" + note : note;',
      "  return req;",
      "}",
    ]),

    enabled: "Enabled",
    enabledHint: "When disabled, the plugin does not run and the requests it applies to are forwarded as usual.",

    codeError: "The code cannot be loaded",
    codeErrorHint: "Fix the code to change the settings below.",
    codeErrorNoForm: "Fix the code to change the settings of this plugin.",
    viewCode: "View code",

    diskChanged: "The file on disk changed",
    diskChangedHint: "This is the approved code. Saving overwrites the file on disk with it.",
    reviewChanges: "Review changes",

    importFile: "Import from file…",
    tooLarge: (size: string) => `The file is ${size}, over the 1 MB limit.`,
    readFailed: "The file could not be read.",
    checking: "Checking the code",
    cannotLoad: "The code cannot be loaded",

    loadFailed: "The plugin code could not be read",
    noCode: "Neither the plugin file nor the approved code can be read.",

    unsaved: "Unsaved changes",
    cancelled: "Cancelled. The configuration was not changed.",

    discardTitle: "Discard unsaved changes",
    discardDescription: "Once the editor closes, the changes to the settings and the code are not saved.",
    discardNewDescription: "Once the editor closes, the plugin is not installed and the code and settings are not kept.",
    keepEditing: "Keep editing",
    discard: "Discard changes",
  },
);
