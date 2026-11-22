import { messages } from "@/i18n";

export const deleteDialogText = messages(
  {
    title: (name: string) => `删除密钥「${name}」`,
    description: "删除后，使用这把密钥的客户端将立即无法连接。可从备份中恢复。",
    regenerated: (client: string) => `${client} 再次接管时会重新生成一把`,
    keepIt: "这把密钥是接管时生成的。保留它，下次接管可以直接复用，不必重新配置。",
  },
  {
    title: (name: string) => `Delete key “${name}”`,
    description:
      "Clients using this key lose access immediately. The key can be restored from the backups.",
    regenerated: (client: string) => `${client} gets a new key when connected again`,
    keepIt:
      "This key was generated when the client was connected. Keeping it lets the next connection reuse it, with nothing to reconfigure.",
  },
  {
    "zh-Hant": {
      title: (name: string) => `刪除金鑰「${name}」`,
      description: "刪除後，使用這把金鑰的用戶端將立即無法連線。可從備份中恢復。",
      regenerated: (client: string) => `${client} 再次接管時會重新生成一把`,
      keepIt: "這把金鑰是接管時生成的。保留它，下次接管可以直接複用，不必重新配置。",
    },
    es: {
      title: (name: string) => `Suprímase la clave “${name}”`,
      description: "Los clientes que utilizan esta llave pierden acceso inmediatamente. La llave se puede restaurar desde las copias de seguridad.",
      regenerated: (client: string) => `${client} obtiene una nueva clave cuando se conecta de nuevo`,
      keepIt: "Esta clave fue generada cuando el cliente estaba conectado. Mantenerla permite que la siguiente conexión la reutilice, sin nada que reconfigurar.",
    },
  },
);
