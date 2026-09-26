import { messages } from "@/i18n";

/** 成功率：整数写整数（100%），否则留一位（98.5%） */
function rate(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export const upstreamTableText = messages(
  {
    upstream: "上游",
    models: "模型",
    quota: "额度 / 计费",
    day: "24 小时",
    ttfb: "首字节 P50",
    actionsColumn: "操作",
    disabled: "已停用",
    disabledTip: "已停用的上游不参与转发。",
    circuitOpen: "熔断中",
    circuitOpenTip: "此上游连续失败，暂不参与转发。",
    authRejected: "凭据被拒",
    authRejectedTip: (status: number) =>
      `上游返回未授权（${status}），该上游的凭据可能已失效。`,
    needsLogin: "需要重新登录",
    needsLoginTip: "账号的登录已失效。重新登录之前，经此上游的请求都会失败。",
    inFlight: (n: number) => `${n} 个请求进行中`,
    actions: (name: string) => `${name} 的操作`,
    check: "检测连接",
    linkTest: "链路测速",
    speedTest: "推理测速…",
    refreshModels: "刷新模型列表",
    account: "额度与重置卡…",
    traffic: "查看流量",
    enable: "启用",
    disable: "停用",
    locate: "在配置文件中定位",
    via: (egress: string) => `经 ${egress}`,
    modelsOf: (name: string) => `${name} 的模型`,
    used: (percent: number) => `已用 ${percent}%`,
    quotaOf: (window: string) => `${window}额度`,
    // `left`：按数量计的窗口还剩多少（「剩余 1,976 / 2,000 积分」），按百分比报的没有
    windowLine: (window: string, used: number, left: string | null, reset: string | null) =>
      `${window}额度：${[`已用 ${used}%`, left, reset && `${reset}重置`].filter(Boolean).join("，")}`,
    sheet: (name: string) => `价目表 ${name}`,
    defaultSheet: "默认",
    requests: (n: number) => `${n.toLocaleString()} 次`,
    unpriced: (n: number) => `${n} 次无法计价`,
    dayRequests: (n: number) => `24 小时 ${n.toLocaleString()} 次请求`,
    dayFailed: (n: number, success: number) => `失败 ${n.toLocaleString()} 次，成功率 ${rate(success)}%`,
    dayNoFailures: "无失败",
    dayCost: (cost: string) => `费用 ${cost}`,
    unpricedTip: (n: number) => `${n.toLocaleString()} 次无法计价，未计入费用`,
    ms: (n: number) => `${n.toLocaleString()} ms`,
    latencyTip: (p95: number, samples: number) =>
      `P95 ${p95.toLocaleString()} ms · ${samples.toLocaleString()} 个样本`,
  },
  {
    upstream: "Upstream",
    models: "Models",
    quota: "Quota / billing",
    day: "24 hours",
    ttfb: "TTFB P50",
    actionsColumn: "Actions",
    disabled: "Disabled",
    disabledTip: "A disabled upstream receives no requests.",
    circuitOpen: "Circuit open",
    circuitOpenTip: "This upstream failed repeatedly and receives no requests for now.",
    authRejected: "Credential rejected",
    authRejectedTip: (status: number) =>
      `The upstream returned an unauthorized response (${status}). The credential for this upstream may no longer be valid.`,
    needsLogin: "Sign in again",
    needsLoginTip:
      "The account's sign-in has expired. Until the account is signed in again, requests through this upstream will fail.",
    inFlight: (n: number) => (n === 1 ? "1 request in progress" : `${n} requests in progress`),
    actions: (name: string) => `Actions for ${name}`,
    check: "Check connection",
    linkTest: "Connection test",
    speedTest: "Inference test…",
    refreshModels: "Refresh model list",
    account: "Usage limits and reset credits…",
    traffic: "View traffic",
    enable: "Enable",
    disable: "Disable",
    locate: "Show in config file",
    via: (egress: string) => `via ${egress}`,
    modelsOf: (name: string) => `Models for ${name}`,
    used: (percent: number) => `${percent}% used`,
    quotaOf: (window: string) => `${window} usage limit`,
    windowLine: (window: string, used: number, left: string | null, reset: string | null) =>
      `${window} limit: ${[`${used}% used`, left, reset && `resets ${reset}`].filter(Boolean).join(", ")}`,
    sheet: (name: string) => `Price sheet: ${name}`,
    defaultSheet: "default",
    requests: (n: number) => (n === 1 ? "1 request" : `${n.toLocaleString()} requests`),
    unpriced: (n: number) => `${n} unpriced`,
    dayRequests: (n: number) =>
      n === 1 ? "1 request in 24 hours" : `${n.toLocaleString()} requests in 24 hours`,
    dayFailed: (n: number, success: number) =>
      `${n.toLocaleString()} failed, ${rate(success)}% succeeded`,
    dayNoFailures: "No failures",
    dayCost: (cost: string) => `Cost ${cost}`,
    unpricedTip: (n: number) =>
      n === 1 ? "1 request unpriced, not included in the cost" : `${n.toLocaleString()} requests unpriced, not included in the cost`,
    ms: (n: number) => `${n.toLocaleString()} ms`,
    latencyTip: (p95: number, samples: number) =>
      `P95 ${p95.toLocaleString()} ms · ${samples.toLocaleString()} ${samples === 1 ? "sample" : "samples"}`,
  },
);
