import { messages } from "@/i18n";

/** 上游余额的说法（`balance.ts`）：上游表那一格、悬停、检测连接的结果、刷新后的提示 */
export const balanceText = messages(
  {
    wallet: (amount: string) => `余额 ${amount}`,
    left: (pair: string) => `剩余 ${pair}`,
    usedAmount: (amount: string) => `已用 ${amount}`,
    used: (percent: number) => `已用 ${percent}%`,
    // 一个数、一对数（「剩余 / 总额」）后面跟的单位。金额不跟：符号写在数前面
    units: {
      tokens: (s: string) => `${s} token`,
      requests: (s: string) => `${s} 次`,
    },
    // 用掉了多少，没有余额、额度可说时写它
    spent: {
      today: (amount: string) => `今日已用 ${amount}`,
      month: (amount: string) => `本月已用 ${amount}`,
      total: (amount: string) => `累计已用 ${amount}`,
    },
    // 花的是账号整体的（账号下几把密钥合计），不是这把密钥自己的
    accountSpent: {
      today: (amount: string) => `账号今日已用 ${amount}`,
      month: (amount: string) => `账号本月已用 ${amount}`,
      total: (amount: string) => `账号累计已用 ${amount}`,
    },
    sourceQuota: (source: string) => `${source} 额度`,
    // 账号的限额：账号下每把密钥共用。这把密钥自己的不用说
    accountLimit: "账号额度",
    scopes: { key: "本密钥", user: "账号" },
    read: {
      now: "刚刚读取",
      minutes: (n: number) => `${n} 分钟前读取`,
      hours: (n: number) => `${n} 小时前读取`,
      at: (time: string) => `${time} 读取`,
    },
    failed: "余额读取失败",
    // `used`：「已用 / 总额」那一对
    quotaLine: (used: string, left: string) => `额度：已用 ${used}，剩余 ${left}`,
    quotaUsed: (used: string) => `额度：已用 ${used}`,
    windowLine: (window: string, scope: string | null, used: string, percent: number, reset: string | null) =>
      `${window}额度${scope ? `（${scope}）` : ""}：已用 ${used}（${percent}%）${reset ? `，${reset}重置` : ""}`,
    // `scope`：账号的限额写「账号」，这把密钥自己的不写
    windowBrief: (window: string, scope: string | null, percent: number) =>
      `${window}额度${scope ? `（${scope}）` : ""}已用 ${percent}%`,
    expires: (date: string) => `${date} 到期`,
    sheet: (name: string) => `价目表 ${name}`,
  },
  {
    wallet: (amount: string) => `Balance ${amount}`,
    left: (pair: string) => `${pair} left`,
    usedAmount: (amount: string) => `${amount} used`,
    used: (percent: number) => `${percent}% used`,
    units: {
      tokens: (s: string) => `${s} tokens`,
      requests: (s: string) => `${s} requests`,
    },
    spent: {
      today: (amount: string) => `${amount} spent today`,
      month: (amount: string) => `${amount} spent this month`,
      total: (amount: string) => `${amount} spent to date`,
    },
    accountSpent: {
      today: (amount: string) => `${amount} spent by the account today`,
      month: (amount: string) => `${amount} spent by the account this month`,
      total: (amount: string) => `${amount} spent by the account to date`,
    },
    sourceQuota: (source: string) => `${source} quota`,
    accountLimit: "Account limit",
    scopes: { key: "this key", user: "account" },
    read: {
      now: "read just now",
      minutes: (n: number) => `read ${n} min ago`,
      hours: (n: number) => `read ${n} h ago`,
      at: (time: string) => `read at ${time}`,
    },
    failed: "Balance unavailable",
    quotaLine: (used: string, left: string) => `Quota: ${used} used, ${left} left`,
    quotaUsed: (used: string) => `Quota: ${used} used`,
    windowLine: (window: string, scope: string | null, used: string, percent: number, reset: string | null) =>
      `${window} limit${scope ? ` (${scope})` : ""}: ${used} used (${percent}%)${reset ? `, resets ${reset}` : ""}`,
    windowBrief: (window: string, scope: string | null, percent: number) =>
      `${window} limit${scope ? ` (${scope})` : ""} ${percent}% used`,
    expires: (date: string) => `Expires ${date}`,
    sheet: (name: string) => `Price sheet: ${name}`,
  },
);
