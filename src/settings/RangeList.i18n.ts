import { messages } from "@/i18n";

export const rangeListText = messages(
  {
    placeholder: "例如 192.168.1.0/24",
    enterToAdd: "回车添加",
    /** 一行是单个地址时，右边写这个而不是起止 */
    single: "单个地址",
    remove: (c: string) => `删除 ${c}`,
    removeShort: "删除",
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
    removeShort: "Remove",
    what: "Add as many ranges or single addresses as needed. Only devices from these can connect; this computer always can.",
    empty: "No range is allowed, so only this computer can connect.",
    restore: "Restore defaults",
    bad: (v: string) => `“${v}” is not a range or an address; it is written as 192.168.1.0/24 or 192.168.1.5.`,
  },
  {
    "zh-Hant": {
      enterToAdd: "回車新增",
      single: "單個地址",
      remove: (c: string) => `刪除 ${c}`,
      removeShort: "刪除",
      what: "可新增多個網段或單個地址。只有這些來源的裝置可以連線，本機始終可以連線。",
      empty: "未放行任何網段，除本機外的裝置都無法連線。",
      restore: "恢復預設",
      bad: (v: string) => `「${v}」不是有效的網段或地址，寫法如 192.168.1.0/24 或 192.168.1.5。`,
    },
    ja: {
      placeholder: "例：192.168.1.0/24",
      enterToAdd: "Enter で追加",
      single: "単一アドレス",
      remove: (c: string) => `${c} を削除`,
      removeShort: "削除",
      what: "接続を許可するネットワーク範囲またはアドレスを追加できます。この端末からは常に接続できます。",
      empty: "許可された範囲がないため、この端末からのみ接続できます。",
      restore: "初期設定に戻す",
      bad: (v: string) => `「${v}」は無効です。192.168.1.0/24 や 192.168.1.5 の形式で入力してください。`,
    },
    ko: {
      removeShort: "제거",
    },
    es: {
      enterToAdd: "Introduzca para añadir",
      single: "dirección única",
      remove: (c: string) => `Eliminar ${c}`,
      removeShort: "Quitar",
      what: "Añadir tantos rangos o direcciones individuales como sea necesario. Sólo los dispositivos de estos pueden conectarse; este equipo siempre puede.",
      empty: "No se permite ningún rango, por lo que sólo este equipo puede conectarse.",
      restore: "Restaurar valores predeterminados",
      bad: (v: string) => `“${v}” no es un rango ni una dirección; está escrito como 192.168.1.0/24 o 192.168.1.5.`,
    },
  },
);
