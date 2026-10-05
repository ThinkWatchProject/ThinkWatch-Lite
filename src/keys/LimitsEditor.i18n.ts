import { messages } from "@/i18n";

export const limitsEditorText = messages(
  {
    title: "用量上限",
    hint: "任一上限用满后，此密钥的请求会被拒绝",
    none: "未设上限，用量不限",
    add: "添加上限",
    every: "每",
    atMost: "最多",
    perLabel: (n: number) => `第 ${n} 条上限的周期`,
    maxLabel: (n: number) => `第 ${n} 条上限的数值`,
    measureLabel: (n: number) => `第 ${n} 条上限的计量`,
    cacheReads: "计入缓存读取",
    remove: "删除",
    removeLabel: (n: number) => `删除第 ${n} 条上限`,
    required: "请填写上限",
    notPositive: (cost: boolean): string => (cost ? "须为大于 0 的金额" : "须为大于 0 的整数"),
    duplicate: "与前面的一条上限重复",
    monthRetention: (days: number) => `每月上限要求请求记录至少保留 31 天，当前为 ${days} 天`,
    unpriced: (n: number) => `${n} 个可用模型没有价格，其费用按 0 计入上限：`,
    more: (n: number) => `另有 ${n} 个`,
    fewer: "收起",
  },
  {
    title: "Usage limits",
    hint: "Once any limit is used up, requests with this key are rejected",
    none: "No limits set: usage is unlimited",
    add: "Add limit",
    every: "Per",
    atMost: "at most",
    perLabel: (n: number) => `Period of limit ${n}`,
    maxLabel: (n: number) => `Amount of limit ${n}`,
    measureLabel: (n: number) => `Measure of limit ${n}`,
    cacheReads: "Count cache reads",
    remove: "Remove",
    removeLabel: (n: number) => `Remove limit ${n}`,
    required: "Enter a limit",
    notPositive: (cost: boolean): string => (cost ? "Must be an amount above 0" : "Must be a whole number above 0"),
    duplicate: "Same as a limit above",
    monthRetention: (days: number) =>
      `A monthly limit needs request records kept for at least 31 days; they are kept for ${days}`,
    unpriced: (n: number) =>
      n === 1
        ? "1 model this key can use has no price and counts as $0 toward the limit:"
        : `${n} models this key can use have no price and count as $0 toward the limit:`,
    more: (n: number) => `${n} more`,
    fewer: "Show less",
  },
);
