import { messages } from "@/i18n";

/** 英文句中的「Since 9/8」要小写开头 */
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const logTabText = messages(
  {
    time: "时间",
    type: "类型",
    hit: "命中",
    action: "处置",
    request: "请求",
    from: (ip: string) => `来自 ${ip}`,
    /** 一天里有几条 */
    count: (n: number) => `${n} 条`,
    viewRequest: "查看请求",
    viewRule: "查看规则",
    disableRule: "停用此规则",
    actionsFor: (rule: string) => `${rule} 的操作`,
    /** 区间里没有记录。自定义区间的名字本身是「9/8 至今」，不再加「内」 */
    emptyIn: (range: string, custom: boolean) => (custom ? `${range}无记录` : `${range}内无记录`),
    emptyHint: "命中任一项防护的请求将记录在此。",
    widen: "查看 30 天",
    allOff: "各项防护均已关闭",
    allOffHint: "开启任一项防护后，命中的请求将记录在此。",
    goTo: (guard: string) => `前往${guard}`,
    loadMore: "加载更多",
    loadFailed: "安全日志读取失败",
  },
  {
    time: "Time",
    type: "Type",
    hit: "Match",
    action: "Action",
    request: "Request",
    from: (ip: string) => `from ${ip}`,
    count: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
    viewRequest: "View request",
    viewRule: "View rule",
    disableRule: "Turn off this rule",
    actionsFor: (rule: string) => `Actions for ${rule}`,
    emptyIn: (range: string, custom: boolean) =>
      custom ? `No entries ${lower(range)}` : `No entries in the last ${range}`,
    emptyHint: "Requests that match any protection are recorded here.",
    widen: "Show 30 days",
    allOff: "All protections are off",
    allOffHint: "Once a protection is on, the requests it matches are recorded here.",
    goTo: (guard: string) => `Go to ${guard}`,
    loadMore: "Load more",
    loadFailed: "The security log could not be loaded",
  },
);
