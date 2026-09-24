import { messages } from "@/i18n";

export const logTabText = messages(
  {
    time: "时间",
    type: "类型",
    hit: "命中",
    action: "处置",
    request: "请求",
    from: (ip: string) => `来自 ${ip}`,
    /** 还有更多没读进来时，说的是「前 N 条」 */
    count: (n: number, more: boolean) => (more ? `前 ${n} 条` : `${n} 条`),
    viewRequest: "查看请求",
    viewRule: "查看规则",
    disableRule: "停用此规则",
    actionsFor: (rule: string) => `${rule} 的操作`,
    empty: "所选区间内无记录。",
    allOff: "各项防护均已关闭，不会产生记录。",
    loadMore: "加载更多",
  },
  {
    time: "Time",
    type: "Type",
    hit: "Match",
    action: "Action",
    request: "Request",
    from: (ip: string) => `from ${ip}`,
    count: (n: number, more: boolean) =>
      more ? `First ${n}` : n === 1 ? "1 entry" : `${n} entries`,
    viewRequest: "View request",
    viewRule: "View rule",
    disableRule: "Turn off this rule",
    actionsFor: (rule: string) => `Actions for ${rule}`,
    empty: "No entries in the selected range.",
    allOff: "All protections are off, so nothing is recorded.",
    loadMore: "Load more",
  },
);
