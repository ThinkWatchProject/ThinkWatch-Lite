import { messages } from "@/i18n";

export const rangeListText = messages(
  {
    placeholder: "例如 192.168.1.0/24",
    enterToAdd: "回车添加",
    /** 一行是单个地址时，右边写这个而不是起止 */
    single: "单个地址",
    remove: (c: string) => `删除 ${c}`,
    what: "可添加多个网段或单个地址。只有这些来源的设备可以连接，本机始终可以连接。",
    empty: "未放行任何网段，除本机外的设备都无法连接。",
    restore: "恢复默认",
    bad: (v: string) => `「${v}」不是有效的网段或地址，写法如 192.168.1.0/24 或 192.168.1.5。`,
  },
  {
    placeholder: "e.g. 192.168.1.0/24",
    enterToAdd: "Enter to add",
    single: "single address",
    remove: (c: string) => `Remove ${c}`,
    what: "Add as many ranges or single addresses as needed. Only devices from these can connect; this computer always can.",
    empty: "No range is allowed, so only this computer can connect.",
    restore: "Restore defaults",
    bad: (v: string) => `“${v}” is not a range or an address; it is written as 192.168.1.0/24 or 192.168.1.5.`,
  },
);
