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
  {
    "zh-Hant": {
      title: "金鑰已建立",
      canConnect: (name: ReactNode) => <>{name} 現在可以連線閘道器。</>,
      gatewayAddress: "閘道器地址",
      key: "金鑰",
    },
    ko: {
      key: "키",
    },
    es: {
      title: "Tecla creada",
      canConnect: (name: ReactNode) => <>{name} ahora se puede conectar a la puerta de enlace.</>,
      gatewayAddress: "Dirección de la pasarela",
      key: "Clave",
      done: "Hecho",
    },
  },
);
