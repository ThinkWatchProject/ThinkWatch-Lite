import { messages } from "@/i18n";

export const rangeText = messages(
  {
    /** 读屏读出来的这一组叫什么 */
    label: "时间范围",
    live: "实时",
    /** 预设的名字，也是「较上一个 X」里的那个 X */
    preset: { "1d": "24 小时", "7d": "7 天", "30d": "30 天" },
    custom: "自定义",
    since: (date: string) => `${date} 至今`,
    /** 自定义区间的「较上一个 X」 */
    sameLength: "等长区间",
  },
  {
    label: "Time range",
    live: "Live",
    preset: { "1d": "24 hours", "7d": "7 days", "30d": "30 days" },
    custom: "Custom",
    since: (date: string) => `Since ${date}`,
    sameLength: "period",
  },
  {
    label: "期間",
    live: "リアルタイム",
    preset: { "1d": "24 時間", "7d": "7 日間", "30d": "30 日間" },
    custom: "カスタム",
    since: (date: string) => `${date} から`,
    sameLength: "同じ長さの期間",
  },
);
