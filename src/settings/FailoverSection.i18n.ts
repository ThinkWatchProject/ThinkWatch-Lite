import { messages } from "@/i18n";

export const failoverText = messages(
  {
    title: "故障转移",
    intro: "上游失败后暂停使用一段时间，请求交给下一个上游。暂停时长按上游给出的原因确定。",
    label: {
      failures_to_pause: "连续失败",
      pause_secs: "暂停时长",
      max_pause_secs: "暂停上限",
      no_balance_pause_secs: "余额不足",
      quota_pause_secs: "额度用完",
      rate_limit_max_pause_secs: "限流",
      idle_timeout_secs: "无响应超时",
      slot_wait_secs: "最多等待空位",
    },
    what: {
      failures_to_pause: "服务器错误、无法连接等未说明原因的失败，连续达到此次数后暂停。",
      pause_secs: "此类失败第一次暂停的时长，此后每次加倍。",
      max_pause_secs: "加倍后的暂停时长不超过此值。",
      no_balance_pause_secs: "上游报告余额不足时暂停的时长。",
      quota_pause_secs: "上游报告额度用完、但未给出重置时间时暂停的时长。给出重置时间的，暂停到重置为止。",
      rate_limit_max_pause_secs: "上游限流时按其要求的等待时间暂停，最长为此值。",
      idle_timeout_secs:
        "上游连续这么久没有发出内容即放弃：尚未向客户端发出内容时转到下一个上游，已经发出时以错误结束。默认 300 秒。",
      slot_wait_secs: "上游并发已满或密钥的分钟、小时上限用满时，请求合计最多等待的时长。0 表示不等待。",
    },
    times: "次",
    secs: "秒",
    badCount: "须为 1 到 100 之间的整数。",
    badSecs: "须为 1 到 604800 之间的整数。",
    badMax: "须为整数，不小于暂停时长，不超过 604800。",
    badIdle: "须为 30 到 3600 之间的整数。",
    badSlotWait: "须为 0 到 300 之间的整数。",
    saveFailed: "未能保存",
  },
  {
    title: "Failover",
    intro:
      "An upstream that fails is paused for a while and requests go to the next one. How long depends on the reason the upstream gives.",
    label: {
      failures_to_pause: "Consecutive failures",
      pause_secs: "Pause",
      max_pause_secs: "Longest pause",
      no_balance_pause_secs: "Insufficient balance",
      quota_pause_secs: "Quota used up",
      rate_limit_max_pause_secs: "Rate limit",
      idle_timeout_secs: "No-response timeout",
      slot_wait_secs: "Wait for a free slot at most",
    },
    what: {
      failures_to_pause:
        "Failures without a stated reason, such as server errors and connection failures, pause the upstream after this many in a row.",
      pause_secs: "The first pause after such failures. Each further pause doubles it.",
      max_pause_secs: "The doubled pause does not exceed this.",
      no_balance_pause_secs: "The pause when the upstream reports an insufficient balance.",
      quota_pause_secs:
        "The pause when the upstream reports its quota used up without saying when it resets. When it does, the pause lasts until then.",
      rate_limit_max_pause_secs: "A rate-limited upstream is paused for the wait it asks for, at most this long.",
      idle_timeout_secs:
        "An upstream that sends no content for this long is given up on: the request moves to the next upstream if nothing has reached the client yet, and ends with an error otherwise. 300 s by default.",
      slot_wait_secs: "Total time a request waits for a full upstream or a key's per-minute or per-hour limit. 0 means no wait.",
    },
    times: "times",
    secs: "s",
    badCount: "A whole number from 1 to 100.",
    badSecs: "A whole number from 1 to 604800.",
    badMax: "A whole number, not less than the pause and at most 604800.",
    badIdle: "A whole number from 30 to 3600.",
    badSlotWait: "A whole number from 0 to 300.",
    saveFailed: "Not saved",
  },
);
