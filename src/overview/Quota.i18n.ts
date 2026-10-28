import { messages } from "@/i18n";

/** 概览「额度与余额」那一块的文案。额度、余额本身的说法用上游页那一套（`balance.i18n.ts`、`labels.i18n.ts`） */
export const quotaText = messages(
  {
    title: "额度与余额",
    showUpstreams: "在上游页中查看",
    /** 名字后面那个词：这一行的大数是钱包余额 */
    wallet: "余额",
    /** 余额接口给的总额度那根条 */
    total: "总额度",
    /** 账号的限额（账号下每把密钥共用） */
    scoped: (window: string, scope: string) => `${window}（${scope}）`,
    /** 下一次重置的时刻：一天以内写钟点，更远的带上日期 */
    resetAt: (clock: string) => `${clock} 重置`,
    used: (percent: number) => `${percent}%`,
    /** 一个窗口的悬停：窗口、已用、剩余（积分制、按量的才有）、重置时刻 */
    gaugeTip: (window: string, percent: number, left: string | null, reset: string | null) =>
      `${window}额度已用 ${percent}%${left ? `，${left}` : ""}${reset ? `，${reset}` : ""}`,
    /** 条上的提醒图标，读屏念它 */
    nearlyOut: "即将用完",
    exhausted: "已用完",
    /** 读屏念的条的名字 */
    gaugeLabel: (name: string, window: string) => `${name} ${window}额度`,
  },
  {
    title: "Quotas and balances",
    showUpstreams: "View in Upstreams",
    wallet: "Balance",
    total: "Total",
    scoped: (window: string, scope: string) => `${window} (${scope})`,
    resetAt: (clock: string) => `Resets ${clock}`,
    used: (percent: number) => `${percent}%`,
    gaugeTip: (window: string, percent: number, left: string | null, reset: string | null) =>
      `${window}: ${percent}% used${left ? `, ${left}` : ""}${reset ? `; ${reset.charAt(0).toLowerCase()}${reset.slice(1)}` : ""}`,
    nearlyOut: "Nearly used up",
    exhausted: "Used up",
    gaugeLabel: (name: string, window: string) => `${name} ${window} quota`,
  },
);
