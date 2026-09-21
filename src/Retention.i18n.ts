export const retentionText = {
  zh: {
    title: "日志保留",
    intro:
      "请求记录和报文各留各的期限。报文是大头，一条几十 KB；一行记录几百字节，留久一点几乎不占地方。",
    bodyDays: "报文",
    bodyDaysWhat: "天。超过就删，请求详情里的「内容」那一栏会空",
    rowDays: "记录",
    rowDaysWhat: "天。撑着「上个月花了多少」这类问题",
    bodyMax: "报文上限",
    bodyMaxWhat: (g: string) => `字节（约 ${g} GB）。超了从最旧的整天开始删`,
    usedNow: (used: string, cap: string) =>
      `报文当前占用 ${used}，上限 ${cap} GB。回收在启动时跑一次，之后每小时一次。`,
  },
  en: {
    title: "Log retention",
    intro:
      "Records and payloads expire on separate clocks. Payloads are the bulk of it at tens of KB each; a record is a few hundred bytes and costs almost nothing to keep longer.",
    bodyDays: "Payloads",
    bodyDaysWhat: "days. Past that they go, and a request's Content tab is empty",
    rowDays: "Records",
    rowDaysWhat: "days. These answer what last month cost",
    bodyMax: "Payload cap",
    bodyMaxWhat: (g: string) =>
      `bytes (about ${g} GB). Over it, the oldest whole days go first`,
    usedNow: (used: string, cap: string) =>
      `Payloads currently use ${used} of ${cap} GB. Reclaimed at startup, then hourly.`,
  },
};
