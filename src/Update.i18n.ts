import { messages } from "@/i18n";

/**
 * 更新：设置里的那一节（`Update.tsx`）、更新窗口（`UpdateWindow.tsx`），
 * 以及安装进行到哪一步（`updateFlow.ts`）。三处说的是同一件事，放在一份里。
 */
export const updateText = messages(
  {
    // 设置里的「更新」
    title: "更新",
    autoCheck: "自动检查新版本",
    checkNow: "立即检查",
    checkFailed: (err: string) => `检查更新失败：${err}`,
    newer: (version: string, current: string) => `新版本 ${version} 可用，当前 ${current}`,
    latest: (version: string) => `已是最新版本 ${version}`,
    current: (version: string) => `当前版本 ${version}`,

    // 更新窗口
    available: (version: string) => `ThinkWatch Lite ${version} 可用`,
    closeWhileWaiting: "关闭此窗口不影响更新，更新完成后将发送通知。",
    standalone: "下载完成后自动安装。网关将在进行中的请求全部结束后重新启动。",
    later: "稍后",
    install: "下载并安装",
    homebrew: "此应用由 Homebrew 管理，请在终端中执行以下命令完成更新：",
    command: "更新命令",
    copyFailed: "未能写入剪贴板。命令已选中，请按 ⌘C 复制。",
    copyCommand: "复制命令",
    dev: "当前运行的是开发构建，不执行自动更新。",

    // 安装进行到哪一步
    downloadingOf: (done: string, total: string) => `正在下载 ${done} / ${total} MB`,
    downloading: (done: string) => `正在下载 ${done} MB`,
    waiting: (n: number) => `等待 ${n} 个进行中的请求结束`,
    installing: "正在安装",
    restarting: "正在重新启动",
  },
  {
    title: "Updates",
    autoCheck: "Check for updates automatically",
    checkNow: "Check now",
    checkFailed: (err: string) => `Update check failed: ${err}`,
    newer: (version: string, current: string) => `Version ${version} is available (current: ${current})`,
    latest: (version: string) => `${version} is the latest version`,
    current: (version: string) => `Current version: ${version}`,

    available: (version: string) => `ThinkWatch Lite ${version} is available`,
    closeWhileWaiting: "Closing this window does not stop the update. A notification is sent when it is complete.",
    standalone:
      "Installs automatically after downloading. The gateway restarts once all requests in progress have finished.",
    later: "Later",
    install: "Download and install",
    homebrew: "This app is managed by Homebrew. To update, run this command in Terminal:",
    command: "Update command",
    copyFailed: "The clipboard could not be written to. The command is selected; press ⌘C to copy it.",
    copyCommand: "Copy command",
    dev: "This is a development build; it does not update automatically.",

    downloadingOf: (done: string, total: string) => `Downloading ${done} / ${total} MB`,
    downloading: (done: string) => `Downloading ${done} MB`,
    waiting: (n: number) =>
      n === 1
        ? "Waiting for 1 request in progress to finish"
        : `Waiting for ${n} requests in progress to finish`,
    installing: "Installing",
    restarting: "Restarting",
  },
);
