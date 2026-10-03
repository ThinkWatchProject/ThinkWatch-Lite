import { messages } from "@/i18n";

export const editorText = messages(
  {
    tabSettings: "设置",
    tabCode: "代码",
    /** 「代码」标签上的红点：代码无法加载 */
    codeHasError: "代码无法加载",

    id: (id: string) => `ID ${id}`,
    sha: (prefix: string) => `SHA-256 ${prefix}`,

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
    keepEditing: "继续编辑",
    discard: "放弃更改",
  },
  {
    tabSettings: "Settings",
    tabCode: "Code",
    codeHasError: "The code cannot be loaded",

    id: (id: string) => `ID ${id}`,
    sha: (prefix: string) => `SHA-256 ${prefix}`,

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
    keepEditing: "Keep editing",
    discard: "Discard changes",
  },
);
