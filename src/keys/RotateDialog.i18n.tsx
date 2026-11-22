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
  {
    "zh-Hant": {
      doneTitle: "金鑰已更換",
      synced: (key: ReactNode, clients: string[]) => (<>
        {key}
        {` 的新金鑰已寫入 ${clients.join("、")} 的配置檔案。`}
       </>),
      shown: (key: ReactNode) => (<>
        {key}
        {" 的新金鑰如下。"}
       </>),
      newKey: "新金鑰",
      restart: (client: string) => `請重新啟動 ${client}`,
      stillOld: "正在執行的視窗仍在使用原金鑰，重啟後恢復。",
      writeFailed: (client: string) => `未能寫入 ${client} 的配置`,
      enterManually: (error: string, client: string) => `${error}。金鑰已更換，請在 ${client} 中手動填寫新金鑰。`,
      updateElsewhere: "使用原金鑰的地方需要改成新金鑰，否則將無法連線。",
      title: (name: string) => `更換金鑰「${name}」`,
      description: (owner: string | null) => owner
        ? `原金鑰立即失效。新金鑰會同時寫入 ${owner} 的配置檔案。`
        : "原金鑰立即失效。使用原金鑰的地方需要改成新金鑰。",
      needsRestart: (client: string) => `${client} 需要重新啟動`,
      readsAtStart: (client: string) => `${client} 在啟動時讀取配置，更換後正在執行的視窗會無法連線，需要重新啟動它。`,
      isDefault: "這是預設金鑰",
      defaultClients: "手動配置了這把金鑰的用戶端都會無法連線，需要逐個改成新金鑰。",
      rotateAndSync: "更換並同步",
      rotate: "更換",
    },
    es: {
      doneTitle: "Tecla rotada",
      synced: (key: ReactNode, clients: string[]) => (<>
        {"La nueva clave para "}
        {key}
        {` ha sido escrito en la configuración ${andList(clients)} ${clients.length === 1 ? "archivo" : "archivos"}.`}
       </>),
      shown: (key: ReactNode) => (<>
        {"La nueva clave para "}
        {key}
        {" se muestra a continuación."}
       </>),
      newKey: "Nueva tecla",
      restart: (client: string) => `Reiniciar ${client}`,
      stillOld: "Windows que ya se están ejecutando todavía utilizan la vieja clave. Reiniciar restaura la conexión.",
      writeFailed: (client: string) => `No se pudo escribir a la configuración ${client}`,
      enterManually: (error: string, client: string) => `${error}. La clave ha sido rotada, por lo que la nueva clave tiene que ser introducida manualmente ${client}.`,
      updateElsewhere: "Cualquier cosa que use la vieja llave debe ser cambiada a la nueva llave, o no se conectará.",
      done: "Hecho",
      title: (name: string) => `Girar la tecla “${name}”`,
      description: (owner: string | null) => owner
        ? `La clave actual deja de funcionar inmediatamente. La nueva clave también se escribe en el archivo de configuraciónuración ${owner}.`
        : "La llave actual deja de funcionar inmediatamente. Cualquier cosa que la use debe ser cambiada a la nueva llave.",
      needsRestart: (client: string) => `${client} necesita reiniciar`,
      readsAtStart: (client: string) => `${client} lee su configuración al iniciar. Una vez rotada la tecla, las ventanas que ya se están ejecutando no pueden conectarse hasta que ${client} se reinicie.`,
      isDefault: "Esta es la clave predeterminada",
      defaultClients: "Los clientes configurados manualmente con esta clave no se conectarán, y cada uno debe ser cambiado a la nueva clave.",
      rotateAndSync: "Rotar y sincronizar",
      rotate: "Rotar",
    },
  },
);
