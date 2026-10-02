import { messages } from "@/i18n";

export const settingsDialogText = messages(
  {
    title: "插件设置",
    enabled: "启用",
    enabledHint: "停用后此插件不运行，适用范围内的请求照常转发。",
    id: (id: string) => `ID ${id}`,
    sha: (prefix: string) => `SHA-256 ${prefix}`,
    replace: "更换代码…",
    /** 系统的确认框里点了「取消」：什么都没写 */
    cancelled: "已取消，配置未改动。",
  },
  {
    title: "Plugin settings",
    enabled: "Enabled",
    enabledHint: "When disabled, the plugin does not run and the requests it applies to are forwarded as usual.",
    id: (id: string) => `ID ${id}`,
    sha: (prefix: string) => `SHA-256 ${prefix}`,
    replace: "Replace code…",
    cancelled: "Cancelled. The configuration was not changed.",
  },
);
