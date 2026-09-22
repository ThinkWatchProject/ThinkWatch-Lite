import { messages } from "@/i18n";

export const keysPageText = messages(
  {
    intro: "客户端须使用密钥连接网关，本机连接也不例外。",
    connectClient: "接管客户端…",
    newKey: "新建密钥",
    copied: (name: string) => `已复制密钥「${name}」`,
    madeDefault: (name: string) => `「${name}」已设为默认密钥`,
    emptyTitle: "每个客户端一把密钥",
    emptyDescription: "接管一个客户端时会为它单独生成密钥，流量、路由和并发上限才能分得清是谁的。",
    deleteTitle: (name: string) => `删除密钥「${name}」`,
    deleteDescription: "删除后，使用这把密钥的客户端将立即无法连接。可在版本历史中恢复。",
    regenerated: (client: string) => `${client} 再次接管时会重新生成一把`,
    keepIt: "这把密钥是接管时生成的。保留它，下次接管可以直接复用，不必重新配置。",
    createdTitle: "密钥已创建",
    canConnect: "现在可以连接网关。",
    gatewayAddress: "网关地址",
    loading: "读取中…",
    key: "密钥",
    done: "完成",
  },
  {
    intro: "Clients must use a key to connect to the gateway, even from this computer.",
    connectClient: "Connect a client…",
    newKey: "New key",
    copied: (name: string) => `Key “${name}” copied`,
    madeDefault: (name: string) => `“${name}” is now the default key`,
    emptyTitle: "One key per client",
    emptyDescription:
      "Connecting a client generates a separate key for it, so traffic, routes and concurrency limits are attributed to the right client.",
    deleteTitle: (name: string) => `Delete key “${name}”`,
    deleteDescription:
      "Clients using this key lose access immediately. The key can be restored from the version history.",
    regenerated: (client: string) => `${client} gets a new key when connected again`,
    keepIt:
      "This key was generated when the client was connected. Keeping it lets the next connection reuse it, with nothing to reconfigure.",
    createdTitle: "Key created",
    canConnect: "can now connect to the gateway.",
    gatewayAddress: "Gateway address",
    loading: "Loading…",
    key: "Key",
    done: "Done",
  },
);
