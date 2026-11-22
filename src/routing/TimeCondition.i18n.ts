import { messages } from "@/i18n";

export const timeConditionText = messages(
  {
    /** 星期开关上的字：一个字就够，七个排成一行 */
    days: { mon: "一", tue: "二", wed: "三", thu: "四", fri: "五", sat: "六", sun: "日" },
    window: (n: number) => `第 ${n} 个时段`,
    start: (n: number) => `第 ${n} 个时段的开始时间`,
    end: (n: number) => `第 ${n} 个时段的结束时间`,
    remove: "移除",
    removeWindow: (n: number) => `移除第 ${n} 个时段`,
    addWindow: "添加时段",
    rawHint: "无法识别的写法，示例：mon-fri 09:00-18:00",
    note: "按网关所在机器的本地时间。结束早于开始的为跨夜时段；全天写 00:00–24:00。",
  },
  {
    days: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
    window: (n: number) => `Time window ${n}`,
    start: (n: number) => `Start of time window ${n}`,
    end: (n: number) => `End of time window ${n}`,
    remove: "Remove",
    removeWindow: (n: number) => `Remove time window ${n}`,
    addWindow: "Add time window",
    rawHint: "Unrecognised form; example: mon-fri 09:00-18:00",
    note: "Local time of the machine the gateway runs on. An end earlier than the start is an overnight window; a whole day is 00:00–24:00.",
  },
  {
    "zh-Hant": {
      window: (n: number) => `第 ${n} 個時段`,
      start: (n: number) => `第 ${n} 個時段的開始時間`,
      end: (n: number) => `第 ${n} 個時段的結束時間`,
      removeWindow: (n: number) => `移除第 ${n} 個時段`,
      addWindow: "新增時段",
      rawHint: "無法識別的寫法，示例：mon-fri 09:00-18:00",
      note: "按閘道器所在機器的本地時間。結束早於開始的為跨夜時段；全天寫 00:00–24:00。",
    },
    ko: {
      remove: "제거",
    },
    es: {
      days: { mon: "Mon", tue: "Mar", wed: "Mié", thu: "Thu", fri: "Fri", sat: "Sáb", sun: "Sol" },
      window: (n: number) => `Ventana temporal ${n}`,
      start: (n: number) => `Inicio de la ventana de tiempo ${n}`,
      end: (n: number) => `Ventana de fin de tiempo ${n}`,
      remove: "Quitar",
      removeWindow: (n: number) => `Eliminar ventana de tiempo ${n}`,
      addWindow: "Añadir ventana de tiempo",
      rawHint: "Forma no reconocida; ejemplo: mon-fri 09:00-18:00",
      note: "Hora local de la máquina en la puerta de entrada. Un final anterior al inicio es una ventana de noche; todo el día es de 00:00 a 24:00.",
    },
  },
);
