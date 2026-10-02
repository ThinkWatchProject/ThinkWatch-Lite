import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const pluginsPageText = messages(
  {
    pluginsUnit: (_n: number) => "个插件",
    active: "生效中",
    disabled: "已停用",
    changed: "文件已更改",
    failed: "加载失败",

    reorder: "调整顺序",
    add: "添加插件",

    emptyTitle: "尚无插件",
    emptyDescription:
      "插件是一段 JavaScript，在请求发往上游之前改写请求，在回答交给客户端之前改写回答。插件在沙箱中运行，无法联网、读写文件，也看不到密钥。",
    loadFailed: "插件列表读取失败",

    order: (n: number) => `第 ${n} 个运行`,
    appliesTo: "适用于",

    // 行上的操作：写成字
    settings: "设置",
    trial: "试运行",
    logs: "日志",
    remove: "删除",
    review: "审核更改",
    replace: "更换代码",
    // 同一份操作在右键菜单里：打开对话框的带「…」
    menu: {
      settings: "设置…",
      trial: "试运行…",
      logs: "日志…",
      review: "审核更改…",
      replace: "更换代码…",
      remove: "删除…",
    },
    actionsFor: (name: string) => `「${name}」的操作`,
    toggleFor: (name: string) => `启用「${name}」`,
    turnedOn: (name: ReactNode) => <>已启用插件「{name}」</>,
    turnedOff: (name: ReactNode) => <>已停用插件「{name}」</>,

    // 不在运行、又会拒绝请求的插件：一直挂着的横幅
    changedTitle: (name: ReactNode) => <>插件「{name}」的文件已更改</>,
    failedTitle: (name: ReactNode) => <>插件「{name}」加载失败</>,
    changedRejecting: "确认更改之前，适用范围内的请求将被拒绝。",
    changedSkipping: "确认更改之前，此插件不运行。",
    failedRejecting: "修复之前，适用范围内的请求将被拒绝。",
    failedSkipping: "修复之前，此插件不运行。",

    deleteTitle: (name: ReactNode) => <>删除插件「{name}」</>,
    deleteDescription: "插件和它的设置将从配置中删除，此后不再运行。",

    reorderTitle: "调整顺序",
    reorderDescription: "插件按此顺序依次运行，后一个插件处理的是前一个改写后的内容。",
    moveUp: (name: string) => `上移「${name}」`,
    moveDown: (name: string) => `下移「${name}」`,
  },
  {
    pluginsUnit: (n: number) => (n === 1 ? "plugin" : "plugins"),
    active: "active",
    disabled: "disabled",
    changed: "with a changed file",
    failed: "failed to load",

    reorder: "Reorder",
    add: "Add plugin",

    emptyTitle: "No plugins yet",
    emptyDescription:
      "A plugin is a piece of JavaScript that rewrites requests before they go upstream and replies before they reach the client. Plugins run in a sandbox with no network, no file access and no view of secrets.",
    loadFailed: "The plugin list could not be loaded",

    order: (n: number) => `Runs ${ordinal(n)}`,
    appliesTo: "Applies to",

    settings: "Settings",
    trial: "Trial run",
    logs: "Logs",
    remove: "Delete",
    review: "Review changes",
    replace: "Replace code",
    menu: {
      settings: "Settings…",
      trial: "Trial run…",
      logs: "Logs…",
      review: "Review changes…",
      replace: "Replace code…",
      remove: "Delete…",
    },
    actionsFor: (name: string) => `Actions for “${name}”`,
    toggleFor: (name: string) => `Enable “${name}”`,
    turnedOn: (name: ReactNode) => <>Plugin “{name}” enabled</>,
    turnedOff: (name: ReactNode) => <>Plugin “{name}” disabled</>,

    changedTitle: (name: ReactNode) => <>The file of plugin “{name}” changed</>,
    failedTitle: (name: ReactNode) => <>Plugin “{name}” failed to load</>,
    changedRejecting: "Until the change is approved, requests it applies to are rejected.",
    changedSkipping: "Until the change is approved, the plugin does not run.",
    failedRejecting: "Until it is fixed, requests it applies to are rejected.",
    failedSkipping: "Until it is fixed, the plugin does not run.",

    deleteTitle: (name: ReactNode) => <>Delete plugin “{name}”</>,
    deleteDescription: "The plugin and its settings are removed from the configuration and it no longer runs.",

    reorderTitle: "Reorder",
    reorderDescription: "Plugins run in this order. Each plugin works on what the one before it produced.",
    moveUp: (name: string) => `Move “${name}” up`,
    moveDown: (name: string) => `Move “${name}” down`,
  },
);

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${n % 10 > 3 ? "th" : s}`;
}
