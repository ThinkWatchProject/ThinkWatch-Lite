import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const createdDialogText = messages(
  {
    title: "密钥已创建",
    canConnect: (name: ReactNode) => <>{name} 现在可以连接网关。</>,
    gatewayAddress: "网关地址",
    key: "密钥",
    done: "完成",
  },
  {
    title: "Key created",
    canConnect: (name: ReactNode) => <>{name} can now connect to the gateway.</>,
    gatewayAddress: "Gateway address",
    key: "Key",
    done: "Done",
  },
);
