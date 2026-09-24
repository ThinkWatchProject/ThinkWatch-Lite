import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const keysPageText = messages(
  {
    // 页头的摘要
    keysUnit: (_n: number) => "把密钥",
    active: "活跃",
    disabled: "已停用",
    requests24h: (n: ReactNode) => <>24 小时 {n} 次请求</>,
    noRequests24h: "24 小时内无请求",
    cost: "费用",

    connectClient: "接管客户端…",
    newKey: "新建密钥",
    copied: (name: string) => `已复制密钥「${name}」`,
    madeDefault: (name: string) => `「${name}」已设为默认密钥`,
    disabledToast: (name: string) => `已停用「${name}」`,
    enabledToast: (name: string) => `已启用「${name}」`,
    loadFailed: "无法读取密钥",

    // 只有默认密钥时
    emptyTitle: "每个客户端一把密钥",
    emptyDescription: "接管客户端时为它单独生成密钥，流量、路由和并发上限按客户端区分。",
    // 一把都没有（配置里总有默认密钥，这一屏只在读到的列表为空时出现）
    noKeys: "尚无密钥",
    noKeysHint: "客户端须使用密钥连接网关，本机连接也不例外。",
  },
  {
    keysUnit: (n: number) => (n === 1 ? "key" : "keys"),
    active: "active",
    disabled: "disabled",
    requests24h: (n: ReactNode) => <>{n} requests in 24 hours</>,
    noRequests24h: "No requests in 24 hours",
    cost: "Cost",

    connectClient: "Connect a client…",
    newKey: "New key",
    copied: (name: string) => `Key “${name}” copied`,
    madeDefault: (name: string) => `“${name}” is now the default key`,
    disabledToast: (name: string) => `“${name}” disabled`,
    enabledToast: (name: string) => `“${name}” enabled`,
    loadFailed: "Could not load the keys",

    emptyTitle: "One key per client",
    emptyDescription:
      "Connecting a client generates a separate key for it, so traffic, routes and concurrency limits are attributed to the right client.",
    noKeys: "No keys yet",
    noKeysHint: "Clients must use a key to connect to the gateway, even from this computer.",
  },
);
