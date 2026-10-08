import { messages } from "@/i18n";

/** 成功率：整数写整数（100%），否则留一位（98.5%） */
function rate(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** 英文的单复数 */
const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export const upstreamTableText = messages(
  {
    upstream: "上游",
    models: "模型",
    quota: "额度 / 计费",
    day: "24 小时",
    /** 上面一行是首 token 的 P50，下面一行是生成速度的中位数 */
    timing: "首 token / 速度",
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
    // 体检标出的偏差（最近 7 天，规则在 checkup.ts）。**只说事实和参照**：「12 次不同」
    // 「+31%」，不说「虚报」「掺假」 —— 标出来是请人看一眼，不是替人判断
    modelDiffers: "模型名不符",
    inputHigh: "输入 token 偏多",
    inputLow: "输入 token 偏少",
    cacheLow: "缓存读取偏低",
    modelDiffersTip: (n: number, of: number) =>
      `最近 7 天的 ${of.toLocaleString()} 次回答中，${n.toLocaleString()} 次写的模型名与发出的不同：`,
    modelPair: (sent: string, answered: string, n: number) =>
      `发出 ${sent}，回答 ${answered} · ${n.toLocaleString()} 次`,
    inputTip: "最近 7 天，上游报告的输入 token 为本地估算的倍数，与服务同一模型的其他上游相比：",
    inputLine: (model: string, gap: string, here: string, hereN: number, k: number, others: string, othersN: number) =>
      `${model} ${gap}：本上游 ${here}（${hereN.toLocaleString()} 次）· 其他 ${k} 个上游 ${others}（${othersN.toLocaleString()} 次）`,
    ratio: (x: number) => `${x.toFixed(2)} 倍`,
    cacheTip: "最近 7 天，可命中缓存的轮次中输入从缓存读取的比例，与服务同一模型的其他上游相比：",
    cacheLine: (model: string, here: string, hereN: number, k: number, others: string, othersN: number) =>
      `${model}：本上游 ${here}（${hereN.toLocaleString()} 轮）· 其他 ${k} 个上游 ${others}（${othersN.toLocaleString()} 轮）`,
    inFlight: (n: number) => `${n} 个请求进行中`,
    inFlightOf: (n: number, max: number) => `${n} 个请求进行中，并发上限 ${max} 个`,
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
    // `left`：积分制套餐的窗口还剩多少积分（「剩余 1,976 / 2,000 积分」），别的窗口没有
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
    latencyTip: (p95: string, samples: number) => `首 token P95 ${p95} · ${samples.toLocaleString()} 个样本`,
    speedValue: (n: number) => `${n.toLocaleString()} token/秒`,
    speedTip: (samples: number) => `生成速度 · ${samples.toLocaleString()} 个样本`,
  },
  {
    upstream: "Upstream",
    models: "Models",
    quota: "Quota / billing",
    day: "24 hours",
    timing: "TTFT / speed",
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
    modelDiffers: "Model name differs",
    inputHigh: "Input reported high",
    inputLow: "Input reported low",
    cacheLow: "Low cache reads",
    modelDiffersTip: (n: number, of: number) =>
      `Over the last 7 days, in ${n.toLocaleString()} of ${count(of, "answer", "answers")}, the model named differs from the one sent:`,
    modelPair: (sent: string, answered: string, n: number) =>
      `Sent ${sent}, answered ${answered} · ${n.toLocaleString()}×`,
    inputTip:
      "Over the last 7 days, input tokens reported by the upstream as a multiple of the local estimate, compared with other upstreams serving the same model:",
    inputLine: (model: string, gap: string, here: string, hereN: number, k: number, others: string, othersN: number) =>
      `${model} ${gap}: this upstream ${here} (${count(hereN, "request", "requests")}) · ${count(k, "other upstream", "other upstreams")} ${others} (${count(othersN, "request", "requests")})`,
    ratio: (x: number) => `${x.toFixed(2)}×`,
    cacheTip:
      "Over the last 7 days, the share of input read from the prompt cache over turns that could read it, compared with other upstreams serving the same model:",
    cacheLine: (model: string, here: string, hereN: number, k: number, others: string, othersN: number) =>
      `${model}: this upstream ${here} (${count(hereN, "turn", "turns")}) · ${count(k, "other upstream", "other upstreams")} ${others} (${count(othersN, "turn", "turns")})`,
    inFlight: (n: number) => (n === 1 ? "1 request in progress" : `${n} requests in progress`),
    inFlightOf: (n: number, max: number) =>
      `${n === 1 ? "1 request" : `${n} requests`} in progress, concurrency limit ${max}`,
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
    latencyTip: (p95: string, samples: number) =>
      `First token P95 ${p95} · ${samples.toLocaleString()} ${samples === 1 ? "sample" : "samples"}`,
    speedValue: (n: number) => `${n.toLocaleString()} tokens/s`,
    speedTip: (samples: number) =>
      `Speed · ${samples.toLocaleString()} ${samples === 1 ? "sample" : "samples"}`,
  },
);
