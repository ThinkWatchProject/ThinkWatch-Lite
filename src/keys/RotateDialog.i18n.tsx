import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 英文的并列：`A`、`A and B`、`A, B and C` */
function andList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export const rotateDialogText = messages(
  {
    doneTitle: "密钥已更换",
    synced: (key: ReactNode, clients: string[]) => (
      <>
        {key}
        {` 的新密钥已写入 ${clients.join("、")} 的配置文件。`}
      </>
    ),
    shown: (key: ReactNode) => (
      <>
        {key}
        {" 的新密钥如下。"}
      </>
    ),
    newKey: "新密钥",
    restart: (client: string) => `请重新启动 ${client}`,
    stillOld: "正在运行的窗口仍在使用原密钥，重启后恢复。",
    writeFailed: (client: string) => `未能写入 ${client} 的配置`,
    enterManually: (error: string, client: string) =>
      `${error}。密钥已更换，请在 ${client} 中手动填写新密钥。`,
    updateElsewhere: "使用原密钥的地方需要改成新密钥，否则将无法连接。",
    done: "完成",
    title: (name: string) => `更换密钥「${name}」`,
    description: (owner: string | null) =>
      owner
        ? `原密钥立即失效。新密钥会同时写入 ${owner} 的配置文件。`
        : "原密钥立即失效。使用原密钥的地方需要改成新密钥。",
    needsRestart: (client: string) => `${client} 需要重新启动`,
    readsAtStart: (client: string) =>
      `${client} 在启动时读取配置，更换后正在运行的窗口会无法连接，需要重新启动它。`,
    isDefault: "这是默认密钥",
    defaultClients: "手动配置了这把密钥的客户端都会无法连接，需要逐个改成新密钥。",
    rotateAndSync: "更换并同步",
    rotate: "更换",
  },
  {
    doneTitle: "Key rotated",
    synced: (key: ReactNode, clients: string[]) => (
      <>
        {"The new key for "}
        {key}
        {` has been written to the ${andList(clients)} config ${clients.length === 1 ? "file" : "files"}.`}
      </>
    ),
    shown: (key: ReactNode) => (
      <>
        {"The new key for "}
        {key}
        {" is shown below."}
      </>
    ),
    newKey: "New key",
    restart: (client: string) => `Restart ${client}`,
    stillOld: "Windows that are already running still use the old key. Restarting restores the connection.",
    writeFailed: (client: string) => `Could not write to the ${client} config`,
    enterManually: (error: string, client: string) =>
      `${error}. The key has been rotated, so the new key has to be entered in ${client} manually.`,
    updateElsewhere: "Anything that uses the old key must be switched to the new key, or it will fail to connect.",
    done: "Done",
    title: (name: string) => `Rotate key “${name}”`,
    description: (owner: string | null) =>
      owner
        ? `The current key stops working immediately. The new key is also written to the ${owner} config file.`
        : "The current key stops working immediately. Anything that uses it must be switched to the new key.",
    needsRestart: (client: string) => `${client} needs a restart`,
    readsAtStart: (client: string) =>
      `${client} reads its config at startup. Once the key is rotated, windows already running cannot connect until ${client} is restarted.`,
    isDefault: "This is the default key",
    defaultClients:
      "Clients configured manually with this key will fail to connect, and each one must be switched to the new key.",
    rotateAndSync: "Rotate and sync",
    rotate: "Rotate",
  },
);
