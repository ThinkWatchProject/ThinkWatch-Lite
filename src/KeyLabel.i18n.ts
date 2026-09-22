import { messages } from "@/i18n";

export const keyLabelText = messages(
  {
    /** 打码的密钥后面括号里的名字 */
    named: (name: string) => `（${name}）`,
    /** 老记录没有打码的值，只有名字 */
    bare: (name: string) => `密钥 ${name}`,
  },
  {
    named: (name: string) => ` (${name})`,
    bare: (name: string) => `Key ${name}`,
  },
);
