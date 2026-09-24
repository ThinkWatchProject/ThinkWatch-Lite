import { messages } from "@/i18n";

export const deleteDialogText = messages(
  {
    title: (name: string) => `删除密钥「${name}」`,
    description: "删除后，使用这把密钥的客户端将立即无法连接。可在版本历史中恢复。",
    regenerated: (client: string) => `${client} 再次接管时会重新生成一把`,
    keepIt: "这把密钥是接管时生成的。保留它，下次接管可以直接复用，不必重新配置。",
  },
  {
    title: (name: string) => `Delete key “${name}”`,
    description:
      "Clients using this key lose access immediately. The key can be restored from the version history.",
    regenerated: (client: string) => `${client} gets a new key when connected again`,
    keepIt:
      "This key was generated when the client was connected. Keeping it lets the next connection reuse it, with nothing to reconfigure.",
  },
);
