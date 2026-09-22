import { messages } from "@/i18n";

export const limitsText = messages(
  {
    title: "并发",
    intro: "超出上限的请求进入队列，队列满后才拒绝。每把密钥各自的上限在密钥的编辑对话框中设置。",
    perProvider: "单个上游",
    perProviderWhat: "每个上游同时处理的请求数上限，避免个别上游变慢时占住所有请求。",
    queueDepth: "队列上限",
    queueDepthWhat: "排队的请求达到此数量后，新请求被拒绝。",
    queueTimeout: "排队超时",
    queueTimeoutWhat: "排队超过此时长的请求不再等待。",
    seconds: "秒",
    bad: "须为正整数。",
    saved: "并发设置已保存",
    saveFailed: "未能保存",
  },
  {
    title: "Concurrency",
    intro:
      "Requests beyond a limit wait in the queue; only a full queue is refused. Each key's own limit is set in that key's edit dialog.",
    perProvider: "Per upstream",
    perProviderWhat: "The most requests one upstream handles at once, so a slow upstream cannot hold every request.",
    queueDepth: "Queue limit",
    queueDepthWhat: "New requests are refused once this many are waiting.",
    queueTimeout: "Queue timeout",
    queueTimeoutWhat: "Requests stop waiting after this long.",
    seconds: "s",
    bad: "A positive whole number.",
    saved: "Concurrency settings saved",
    saveFailed: "Not saved",
  },
);
