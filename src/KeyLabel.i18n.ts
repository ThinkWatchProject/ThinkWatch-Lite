import { messages } from "@/i18n";

export const keyLabelText = messages(
  {
    /** 打码的密钥后面括号里的名字 */
    named: (name: string) => `（${name}）`,
    /** 拿不到打码的值时只有名字 */
    bare: (name: string) => `密钥 ${name}`,
  },
  {
    named: (name: string) => ` (${name})`,
    bare: (name: string) => `Key ${name}`,
  },
  {
    "zh-Hant": {
      bare: (name: string) => `金鑰 ${name}`,
    },
    es: {
      bare: (name: string) => `Clave ${name}`,
    },
  },
);
