import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const changedDialogText = messages(
  {
    title: "审核文件更改",
    lead: (name: ReactNode) => <>插件「{name}」的文件在确认之后被改动过。确认之前，此插件不运行。</>,
    rejecting: "出错时设为拒绝这次请求：在此期间，适用范围内的请求将被拒绝。",
    hashes: (from: string, to: string) => `SHA-256 ${from} → ${to}`,
    changes: "更改",
    fullCode: "完整代码",
    code: "代码",
    cannotLoad: "更改后的代码无法加载",
    at: (where: string) => `位置：${where}`,
    missing: "插件文件已不存在或无法读取。",
    missingHint: "可以更换为新的代码，或删除此插件。",
    loadFailed: "文件内容读取失败",
    approve: "确认更改",
    replace: "更换代码…",
    cancelled: "已取消，配置未改动。",
  },
  {
    title: "Review file changes",
    lead: (name: ReactNode) => <>The file of plugin “{name}” was changed after it was approved. Until the change is approved, the plugin does not run.</>,
    rejecting: "On error is set to reject the request: in the meantime, requests it applies to are rejected.",
    hashes: (from: string, to: string) => `SHA-256 ${from} → ${to}`,
    changes: "Changes",
    fullCode: "Full code",
    code: "Code",
    cannotLoad: "The changed code cannot be loaded",
    at: (where: string) => `At ${where}.`,
    missing: "The plugin file no longer exists or cannot be read.",
    missingHint: "Replace it with new code, or delete the plugin.",
    loadFailed: "The file could not be read",
    approve: "Approve changes",
    replace: "Replace code…",
    cancelled: "Cancelled. The configuration was not changed.",
  },
);
