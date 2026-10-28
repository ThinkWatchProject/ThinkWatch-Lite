// 用量历史（`GET /summary/history`）：概览「最近一年」那张热力图。
//
// 一年左右的逐日用量：工作日多、周末少、偶尔几天没用，越近用得越多；费用有一小部分是估算的，
// 偶尔几条无法计价。记录从十个月前开始。格子按 core 的分法排：`from + k × bucket`，稀疏。
import type { BucketQuery, CostBucket, UsageHistory } from "@/types";
import { DAY, NOW, rng } from "./util";

/** 记录从哪一刻起：十个月前 */
const SINCE = NOW - 304 * DAY;
/** 逐条记录（请求库）只有最近 30 天：更早的日子在热力图上点不开 */
const DETAIL_SINCE = () => NOW - 30 * DAY;

export function usageHistory(req: BucketQuery, sinceMs: number = SINCE): UsageHistory {
  const now = Date.now();
  const bucket = req.bucket_ms ?? DAY;
  const from = req.from_ms ?? now - 365 * DAY;
  const to = Math.min(req.to_ms ?? now, now);
  const r = rng(20261028);
  const buckets: CostBucket[] = [];
  for (let k = 0; from + k * bucket < to; k++) {
    const at = from + k * bucket;
    const rolls = [r(), r(), r(), r()] as const;
    // 记录之前没有数据；格子按 `at + 12h` 那一刻对本地日期，这里同样按它判断工作日
    if (at + bucket <= sinceMs) continue;
    const mid = new Date(at + bucket / 2);
    const weekend = mid.getDay() === 0 || mid.getDay() === 6;
    if (rolls[0] < (weekend ? 0.35 : 0.05)) continue;
    const age = (now - at) / DAY;
    const grow = 0.35 + 0.65 * Math.pow(Math.max(0, 1 - age / 365), 1.5);
    const spike = rolls[3] < 0.04 ? 2.4 : 1;
    // 今天只过了一部分
    const part = Math.min(1, (to - at) / bucket);
    const tokens = Math.round(2.6e6 * grow * (weekend ? 0.35 : 1) * spike * (0.45 + rolls[1] * 1.1) * part);
    if (tokens <= 0) continue;
    const output = Math.round(tokens * (0.05 + rolls[1] * 0.04));
    const cacheRead = Math.round(tokens * (0.52 + rolls[0] * 0.14));
    const cacheWrite = Math.round(tokens * 0.04);
    const input = tokens - output - cacheRead - cacheWrite;
    const requests = Math.max(1, Math.round(tokens / (21_000 + rolls[2] * 14_000)));
    const cost = Math.round(tokens * (1.25 + rolls[2] * 0.5));
    // 大约每七天有一天含估算（那一天费用的一成多），每二十天有一天几条无法计价
    const estimated = rolls[2] < 0.15 ? Math.round(cost * 0.12) : 0;
    const unpriced = rolls[3] > 0.95 ? 1 + Math.floor(rolls[1] * 3) : 0;
    buckets.push({
      at_ms: at,
      requests,
      failed: Math.floor(requests * 0.02 * rolls[0]),
      cost_micros_exact: cost - estimated,
      cost_micros_estimated: estimated,
      unpriced_requests: unpriced,
      no_usage_requests: 0,
      sent_bytes: Math.round(tokens * 3.6),
      received_bytes: Math.round(output * 5.6),
      input_tokens: input,
      output_tokens: output,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      // 用量历史不记首 token
      ttft_p50_ms: null,
      ttft_p95_ms: null,
      ttft_samples: 0,
    });
  }
  return { since_ms: sinceMs, detail_since_ms: DETAIL_SINCE(), buckets };
}
