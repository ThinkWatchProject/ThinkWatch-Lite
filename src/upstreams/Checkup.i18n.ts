import { messages } from "@/i18n";

/** 英文的单复数 */
const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * 上游页「体检」标签的文案。
 *
 * **只说事实和参照，不下结论**：「12 次不同」「+31%」，不说「虚报」「掺假」。偏差标成
 * 琥珀色，是请人看一眼，不是替人判断（见 `checkup.ts`）。
 */
export const checkupText = messages(
  {
    // 表头
    upstream: "上游",
    models: "模型名",
    modelsTip: "回答中写的模型名与发出的是否相同。",
    input: "输入 token",
    inputTip: "上游报告的输入 token 与本地估算之比，和服务同一模型的其他上游相比。",
    cache: "缓存读取",
    cacheTip: "可命中缓存的轮次中，输入从缓存读取的比例。",
    timing: "首 token / 速度",

    // 上游一格
    requests: (n: number) => `${n.toLocaleString()} 次请求`,
    failedShare: (pct: string) => `失败 ${pct}`,
    requestsTip: (n: number) => `请求 ${n.toLocaleString()} 次`,
    failedTip: (n: number) => `失败 ${n.toLocaleString()} 次`,
    cancelledTip: (n: number) => `另有 ${n.toLocaleString()} 次被客户端取消，不计入请求`,

    // 模型名
    consistent: "一致",
    differed: (n: number) => `${n.toLocaleString()} 次不同`,
    named: (n: number) => `共 ${n.toLocaleString()} 次`,
    noNames: "回答中没有写模型名。",
    allSame: (n: number) => `${n.toLocaleString()} 次回答中写的模型名都与发出的相同。`,
    pairsTitle: (n: number, of: number) =>
      `${of.toLocaleString()} 次回答中，${n.toLocaleString()} 次写的模型名与发出的不同：`,
    pair: (sent: string, answered: string, n: number) => `发出 ${sent}，回答 ${answered} · ${n.toLocaleString()} 次`,

    // 输入 token
    ratio: (x: number) => `${x.toFixed(2)} 倍`,
    inputUnit: "上游报告的输入 token 为本地估算的倍数：",
    inputLine: (here: string, hereN: number, k: number, others: string, othersN: number) =>
      `本上游 ${here}（${hereN.toLocaleString()} 次）· 其他 ${k} 个上游 ${others}（${othersN.toLocaleString()} 次）`,
    inputAll: (x: string, n: number) => `所有模型合计为本地估算的 ${x}（${n.toLocaleString()} 次）。`,
    noComparison: "没有服务同一模型且样本足够的其他上游，无从比较。",

    // 缓存读取
    turns: (n: number) => `${n.toLocaleString()} 轮`,
    cacheSummary: (turns: number, share: string, zero: number) =>
      `可命中缓存的 ${turns.toLocaleString()} 轮中，缓存读取占输入的 ${share}，${zero.toLocaleString()} 轮未读到缓存。`,
    cacheLine: (here: string, hereN: number, k: number, others: string, othersN: number) =>
      `本上游 ${here}（${hereN.toLocaleString()} 轮）· 其他 ${k} 个上游 ${others}（${othersN.toLocaleString()} 轮）`,
    noTurns: "没有可命中缓存的轮次。",

    // 首 token / 速度
    ms: (n: number) => `${n.toLocaleString()} ms`,
    speed: (n: number) => `${n.toLocaleString()} token/秒`,
    ttftTip: (n: number) => `首 token 中位数 · ${n.toLocaleString()} 个样本`,
    speedTip: (n: number) => `生成速度中位数 · ${n.toLocaleString()} 个样本`,

    // 整页
    covered: (at: string) => `请求记录自 ${at} 起，更早的时段不在统计内。`,
    empty: "所选时段内没有发往上游的请求",
    emptyDesc: "请求经上游转发后，这里按上游列出统计。",
    failed: "体检数据读取失败",
  },
  {
    upstream: "Upstream",
    models: "Model name",
    modelsTip: "Whether the model named in the answers matches the one sent.",
    input: "Input tokens",
    inputTip:
      "Input tokens reported by the upstream relative to the local estimate, compared with other upstreams serving the same model.",
    cache: "Cache reads",
    cacheTip: "The share of input read from the prompt cache, over turns that could read it.",
    timing: "TTFT / speed",

    requests: (n: number) => count(n, "request", "requests"),
    failedShare: (pct: string) => `${pct} failed`,
    requestsTip: (n: number) => count(n, "request", "requests"),
    failedTip: (n: number) => `${n.toLocaleString()} failed`,
    cancelledTip: (n: number) =>
      n === 1
        ? "1 more was cancelled by the client and is not counted"
        : `${n.toLocaleString()} more were cancelled by the client and are not counted`,

    consistent: "Matches",
    differed: (n: number) => `${n.toLocaleString()} differ`,
    named: (n: number) => count(n, "answer", "answers"),
    noNames: "The answers do not name a model.",
    allSame: (n: number) =>
      n === 1 ? "The model named in 1 answer matches the one sent." : `The model named in all ${n.toLocaleString()} answers matches the one sent.`,
    pairsTitle: (n: number, of: number) =>
      `In ${n.toLocaleString()} of ${count(of, "answer", "answers")}, the model named differs from the one sent:`,
    pair: (sent: string, answered: string, n: number) => `Sent ${sent}, answered ${answered} · ${n.toLocaleString()}×`,

    ratio: (x: number) => `${x.toFixed(2)}×`,
    inputUnit: "Input tokens reported by the upstream, as a multiple of the local estimate:",
    inputLine: (here: string, hereN: number, k: number, others: string, othersN: number) =>
      `This upstream ${here} (${count(hereN, "request", "requests")}) · ${count(k, "other upstream", "other upstreams")} ${others} (${count(othersN, "request", "requests")})`,
    inputAll: (x: string, n: number) => `All models together: ${x} the local estimate (${count(n, "request", "requests")}).`,
    noComparison: "No other upstream served the same model with enough samples to compare.",

    turns: (n: number) => count(n, "turn", "turns"),
    cacheSummary: (turns: number, share: string, zero: number) =>
      `Over ${count(turns, "turn", "turns")} that could read the cache, ${share} of the input was read from it; ${zero.toLocaleString()} read none.`,
    cacheLine: (here: string, hereN: number, k: number, others: string, othersN: number) =>
      `This upstream ${here} (${count(hereN, "turn", "turns")}) · ${count(k, "other upstream", "other upstreams")} ${others} (${count(othersN, "turn", "turns")})`,
    noTurns: "No turns could read the cache.",

    ms: (n: number) => `${n.toLocaleString()} ms`,
    speed: (n: number) => `${n.toLocaleString()} tokens/s`,
    ttftTip: (n: number) => `Median time to first token · ${count(n, "sample", "samples")}`,
    speedTip: (n: number) => `Median generation speed · ${count(n, "sample", "samples")}`,

    covered: (at: string) => `Requests are recorded from ${at}; earlier times are not included.`,
    empty: "No requests went to an upstream in this period",
    emptyDesc: "Once requests go through upstreams, each upstream's figures are listed here.",
    failed: "Could not load the check-up",
  },
);
