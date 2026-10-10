import { messages } from "@/i18n";

export const timeWindowText = messages(
  {
    days: { mon: "周一", tue: "周二", wed: "周三", thu: "周四", fri: "周五", sat: "周六", sun: "周日" },
    /** 连着的几天：`周一至周五` */
    dayRange: (from: string, to: string) => `${from}至${to}`,
    /** 不连着的几段之间 */
    daySep: "、",
    /** 同一天里的一段 */
    span: (start: string, end: string) => `${start}–${end}`,
    /** 结束在次日 */
    overnight: (start: string, end: string) => `${start}–次日 ${end}`,
    withDays: (days: string, time: string) => `${days} ${time}`,
    /** 编辑器里结束时间后面的标记 */
    nextDay: "次日",
  },
  {
    days: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
    dayRange: (from: string, to: string) => `${from}–${to}`,
    daySep: ", ",
    span: (start: string, end: string) => `${start}–${end}`,
    overnight: (start: string, end: string) => `${start}–${end} next day`,
    withDays: (days: string, time: string) => `${days} ${time}`,
    nextDay: "next day",
  },
);
