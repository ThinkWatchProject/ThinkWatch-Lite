/**
 * 表格里的显示格式。
 *
 * 抽出来是因为这几条都有「边界看起来对、其实不对」的地方，而它们错了
 * 不会报错，只会让一列数字读起来是错的。
 */
import { usd } from "./types";

/**
 * 首字节和总耗时合成一列。
 *
 * 非流式请求两者几乎相同（`253ms / 254ms`），两列占着宽度却只有一个
 * 信息。**只在它们真的差得开时才显示两个数** —— 那时差值本身就是结论：
 * 首字节快而总耗时长 = 模型在慢慢吐；两者都长 = 卡在网络或排队。
 *
 * 阈值 50ms：低于这个差别在感知上不存在，显示出来只是噪音。
 */
export function latency(
  ttfbMs: number | undefined,
  durationMs: number | undefined,
): string {
  if (durationMs == null) return ttfbMs != null ? `${ttfbMs}ms` : "—";
  if (ttfbMs == null) return `${durationMs}ms`;
  if (durationMs - ttfbMs < 50) return `${durationMs}ms`;
  return `${ttfbMs}→${durationMs}ms`;
}

/**
 * 列表里的绝对时间。
 *
 * **相对时间在这一列会塌掉。**开着窗口看实时流量时「3s / 1m」是有用的，
 * 而打开应用看昨天那次时，整列二十五行全是 `1d` —— 一个所有行都相同的
 * 值不携带任何信息，而这一列存在的意义就是把某一行对上号。
 *
 * 今天的记录给到秒（同一分钟内的几次请求要能分开），更早的给到分并带上
 * 日期。完整时间戳留给悬停。
 */
export function when(atMs: number, now = Date.now()): string {
  const t = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date(now);
  const sameDay =
    t.getFullYear() === today.getFullYear() &&
    t.getMonth() === today.getMonth() &&
    t.getDate() === today.getDate();
  if (sameDay) return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
  return `${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * 一个大数收成三四位。
 *
 * 四位数以上换 k：一列 `128000` 和 `463` 混排时，位数差本身会被误读成
 * 数量级差。而一个逗号分隔的 `514,567` 读起来是账本上的条目，不是一个
 * 能一眼掂量的量 —— 精确值留给悬停。
 */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * 输入与输出 token。
 *
 * 合成一列，因为读的时候要的是两者的**比例**：输入远大于输出 = 上下文
 * 在变贵；输出远大于输入 = 在长篇生成。分成两列反而要来回扫。
 *
 * **上游没报用量就是没有，不是零。**还在跑的行同理 —— 显示 0 会让它在
 * 排序和求和里冒充一个测量结果。
 */
export function tokens(
  input: number | undefined,
  output: number | undefined,
): string {
  if (input == null || output == null) return "—";
  return `${compact(input)}→${compact(output)}`;
}

/**
 * 这一行的某个值和上一行是否相同。
 *
 * 相同就淡化 —— 一列 25 个 `relay` 以全权重重复，占掉宽度却零信息，
 * 而眼睛要找的恰恰是**变化的那一行**。抓包工具都这么做。
 *
 * **不省略，只淡化。**省略之后复制一行会缺字段，而「复制这一行」是
 * 右键菜单里就有的动作。
 */
export function repeated<T>(rows: T[], i: number, get: (r: T) => string): boolean {
  const prev = rows[i - 1];
  const cur = rows[i];
  if (i <= 0 || prev === undefined || cur === undefined) return false;
  return get(prev) === get(cur);
}

/**
 * 这一行花了多少。
 *
 * **估算值必须带记号。**一个 `$0.018` 和一个按输入长度猜出来的
 * `$0.018` 在列表里长得一模一样，而后者不该被当成账单上的数。
 *
 * 算不出来的显示「—」：订阅制上游的边际成本不在这个维度上，价目表里
 * 没有的模型也是 —— 两种都不是「零」。
 */
export function money(
  micros: number | undefined,
  estimated: boolean | undefined,
): string {
  if (micros == null) return "—";
  return (estimated ? "~" : "") + usd(micros);
}

/** 状态码的语义分档。**眼睛要能一眼扫到那个 5xx。** */
export function statusTone(
  status: number | undefined,
  state: "in_flight" | "done" | "failed",
): "pending" | "ok" | "warn" | "bad" {
  if (state === "in_flight") return "pending";
  if (state === "failed") return "bad";
  if (status == null) return "ok";
  if (status >= 500) return "bad";
  if (status >= 400) return "warn";
  return "ok";
}

/** 一个时间桶（和 core 的 `/summary/buckets` 对应）。 */
export interface CostBucket {
  at_ms: number;
  requests: number;
  failed: number;
  cost_micros_exact: number;
  cost_micros_estimated: number;
  unpriced_requests: number;
}

/**
 * 把一个时刻落到它所在那一格的开头。
 *
 * **时间窗必须对齐到格子，不能是「现在往前推 24 小时」。**后者每刷新
 * 一次就往前挪一点，于是每一格的边界跟着挪：一条固定时间的记录会在两格
 * 之间来回滑，柱子的高低随之变化 —— 而那是「你什么时候看」造成的，
 * 不是数据变了。对齐之后，同一个小时里读到的是同一张图。
 *
 * **对齐到本地日历，不是对齐到纪元。**一天一格时，纪元对齐的「一天」是
 * UTC 零点到零点，而格子上写的是本地日期 —— 两者差着时区那几个小时。
 * 半小时偏移的时区里连整点都对不上。
 */
export function bucketStart(atMs: number, bucketMs: number): number {
  const d = new Date(atMs);
  if (bucketMs >= 24 * 3_600_000) {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const hours = Math.max(1, Math.round(bucketMs / 3_600_000));
  d.setHours(Math.floor(d.getHours() / hours) * hours, 0, 0, 0);
  return d.getTime();
}

/**
 * 把稀疏的桶补成稠密的一排。
 *
 * **core 刻意不补**：GROUP BY 只产出有数据的桶，而要画多少格只有界面
 * 知道。补空桶这件事必须做，但要在这里做。
 *
 * 为什么必须做：跳过空桶的话，一天里的空档会被两边的柱子挤没，图上
 * 看起来就是**连续在用** —— 而「昨天下午我根本没碰它」恰恰是看这张图
 * 想确认的事。一张会把「没用过」画成「在用」的图，比没有图更糟。
 */
export function densify(
  buckets: CostBucket[],
  sinceMs: number,
  untilMs: number,
  bucketMs: number,
): CostBucket[] {
  if (bucketMs <= 0 || untilMs <= sinceMs) return [];
  const by = new Map(buckets.map((b) => [b.at_ms, b]));
  const out: CostBucket[] = [];
  // 上限是防御性的：跨度和桶宽算出几万格时，那不是一张图，是一次卡死
  const n = Math.min(500, Math.ceil((untilMs - sinceMs) / bucketMs));
  for (let i = 0; i < n; i++) {
    const at = sinceMs + i * bucketMs;
    out.push(
      by.get(at) ?? {
        at_ms: at,
        requests: 0,
        failed: 0,
        cost_micros_exact: 0,
        cost_micros_estimated: 0,
        unpriced_requests: 0,
      },
    );
  }
  return out;
}
