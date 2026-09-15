import { useEffect, useState } from "react";
import { useStableState } from "./useStable";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import RequestDrawer from "./RequestDrawer";
import { triggers } from "./triggers";
import { StackedArea } from "@/ui/charts";
import { bucketStart, densify } from "./format";
import { usd, type Dashboard as Data, type LatencyView } from "./types";
import { Alert, AlertDescription } from "@/ui/alert";
import { toast } from "sonner";
import { DEFAULT_RANGE, RangePicker, type Range } from "@/ui/range";
import { Skeleton } from "@/ui/skeleton";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * 一格多宽。
 *
 * **比「一小时一格」细得多，这是故意的。**少而肥的格子只能看出「这段
 * 时间有没有用过」；细到四五十格以上，图上开始能看出**作息** —— 白天
 * 成片、夜里断开、周末矮一截。一张能看出作息的图才是仪表，否则它只是
 * 几个方块。
 *
 * 上限压在 120 格上下：再密就是把噪声当细节，而每一格还要再乘上模型
 * 个数去查库。
 */
function bucketFor(rangeMs: number): number {
  if (rangeMs > 7 * DAY) return 6 * HOUR;
  if (rangeMs > 2 * DAY) return 2 * HOUR;
  return HOUR / 2;
}

/** 一格的时间标签。跨度大到按天分格时就只写日期。 */
function fmtBucket(atMs: number, bucketMs: number): string {
  const t = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  if (bucketMs >= DAY) return `${t.getMonth() + 1}/${t.getDate()}`;
  return `${t.getMonth() + 1}/${t.getDate()} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * 读数据时的骨架。
 *
 * **不是一句「读取中…」。**那一行字占的地方和真正的内容差着两百像素，
 * 读完之后整页会跳一次；而这一页最大的那个数字恰好在跳动的位置上。
 */
function OverviewSkeleton() {
  return (
    <>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="mt-4 h-24 w-full" />
      <div className="mt-3 flex gap-5">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-2.5 w-28" />
      </div>
      <div className="mt-7 space-y-3">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-3.5 w-full" />
      </div>
    </>
  );
}

/**
 * 延迟的分位区间。
 *
 * **条子从 P50 画到 P95，不是两列数字。**并排的两列毫秒数要逐行读才能
 * 比较，而这张图要回答的是「哪个模型又慢又不稳」—— 那是条子的**位置
 * 加长度**，一眼的事。亮线是 P50：多数请求落在那儿。
 *
 * 用分位数不用平均值：AI 延迟是长尾分布，平均值会被极端值拉偏。
 */
function Spread({ rows }: { rows: LatencyView[] }) {
  const max = Math.max(1, ...rows.map((r) => r.p95)) * 1.04;
  return (
    <div className="mt-2 space-y-2">
      {rows.map((l) => (
        <div key={l.model} className="flex items-center gap-3 tw-body">
          <span className="w-44 shrink-0 truncate" title={l.model}>
            {l.model}
          </span>
          <span className="relative h-2.5 flex-1 rounded-sm bg-muted">
            <span
              className="absolute inset-y-0 rounded-sm bg-chart-2"
              style={{
                left: `${(l.p50 / max) * 100}%`,
                width: `${((l.p95 - l.p50) / max) * 100}%`,
              }}
            />
            <span
              className="absolute -top-0.5 h-3.5 w-0.5 bg-chart-1"
              style={{ left: `${(l.p50 / max) * 100}%` }}
            />
          </span>
          <span className="w-28 shrink-0 text-right tw-num text-muted-foreground">
            {l.p50} – {l.p95}ms
          </span>
          {/* **样本数要显示。**「800ms」是 3 个样本还是 300 个，含义
              完全不同 —— 少了它这张图就是在假装确定 */}
          <span
            className={
              "w-16 shrink-0 text-right tw-label " +
              (l.samples < 10 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")
            }
          >
            {l.samples} 次{l.samples < 10 && " · 少"}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 用量概览。
 *
 * 这一页的每一个数字都受那条约束：**绝不让估算值混进精确数字里
 * 假装准确。**所以成本是三个数并排，不是一个。
 *
 * 口径由页头那个时间范围决定，不是固定的「今天」——「上个月账单对不上」
 * 和「刚才那阵是不是我自己跑的」是两个问题，而它们要的窗口不一样。
 */
export default function Dashboard({ tick }: { tick: number }) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const bucketMs = bucketFor(range.ms);
  /**
   * **只在内容真的变了的时候才换。**每次 `invoke` 回来都是一个新对象，
   * 直接 setState 会让整页重画一遍，而这一切发生在什么都没发生的时候。
   */
  const [d, setD] = useStableState<Data | null>(null);
  const gatewayHint = "本机网关地址";
  const [error, setError] = useState<string | null>(null);
  /** 点开的那一条。**抽屉是右侧覆盖的，不是跳页** —— 用户要能一边看
      详情一边对着列表里的别的行 */
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 窗口起点对齐到格子边界，格宽一起送过去 —— 两边各算一遍的话，
        // 补空桶时格子对不上，整张图会是零。见 bucketStart 的注释。
        const sinceMs = bucketStart(Date.now() - range.ms, bucketMs);
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const x = await invoke<Data>("dashboard", { sinceMs, bucketMs });
        if (alive) {
          setD(x);
          setError(null);
        }
      } catch (e) {
        if (alive) toast.error(typeof e === "string" ? e : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick, range.ms, bucketMs, setD]);

  /*
    标题和时间范围在读到数据之前就该在那儿 —— 它们不依赖数据，而且
    切换范围本身就是「重读一次」的入口。骨架只盖数据那一块。
  */
  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="tw-title font-semibold">用量概览</h2>
      <div className="ml-auto">
        <RangePicker value={range} onChange={setRange} />
      </div>
    </div>
  );

  if (error) {
    return (
      <div className="p-5">
        <Alert variant="warning">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="p-5">
        <section>
          {header}
          <OverviewSkeleton />
        </section>
      </div>
    );
  }

  const s = d.summary;
  const t = triggers(null, d);
  const spent = s.cost_micros_exact + s.cost_micros_estimated;
  const hasEstimate = s.cost_micros_estimated > 0;
  // 条件不满足就**不出现**，不是折叠
  const nothingYet = !t.cost;

  /*
    较上一个等长区间。**没有参照系的数字只能读，不能判断** ——「$4.05」
    是多还是少，只有和上一个七天比过才知道。

    上一个区间是 0 时不显示：和零比出来的是「涨了无穷多」，那不是一个
    能读的数。花得更多也**不上告警色** —— 多花钱不是故障。
  */
  const before = d.prev ? d.prev.cost_micros_exact + d.prev.cost_micros_estimated : 0;
  const delta = before > 0 ? (spent - before) / before : null;

  /*
    趋势图按模型分层。

    **只留花得最多的四个，其余并成「其他」。**一个上游可能报出十几个
    模型名，十几层堆在九十六像素里谁也看不清，而排在后面的那些加起来
    往往不到百分之一。
  */
  const byBucket = new Map<number, Map<string, number>>();
  const total = new Map<string, number>();
  for (const b of d.buckets_by_model ?? []) {
    const cost = b.cost_micros_exact + b.cost_micros_estimated;
    const name = b.name || "未知模型";
    total.set(name, (total.get(name) ?? 0) + cost);
    const slot = byBucket.get(b.at_ms) ?? new Map<string, number>();
    slot.set(name, (slot.get(name) ?? 0) + cost);
    byBucket.set(b.at_ms, slot);
  }
  const ranked = [...total.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 4).map(([name]) => name);
  const rest = ranked.slice(4);
  // 画的顺序是从下往上，所以**便宜的垫底、贵的在上** —— 贵的那层在
  // 视觉上也该是最重的一层。颜色跟着走：chart-1 最亮，给花得最多的。
  const keys = rest.length > 0 ? ["其他", ...[...top].reverse()] : [...top].reverse();
  const shade = [
    "var(--chart-5)",
    "var(--chart-4)",
    "var(--chart-3)",
    "var(--chart-2)",
    "var(--chart-1)",
  ];
  const colors = keys.map(
    (_, i) => shade[Math.max(0, shade.length - keys.length + i)] ?? "var(--chart-1)",
  );

  const grid = densify(d.buckets ?? [], d.since_ms ?? 0, Date.now(), bucketMs);
  const area = grid.map((g) => {
    const row: Record<string, number | string> = {
      label: `${fmtBucket(g.at_ms, bucketMs)}　${usd(
        g.cost_micros_exact + g.cost_micros_estimated,
      )}　${g.requests} 次${g.failed ? `（${g.failed} 次失败）` : ""}`,
    };
    let other = 0;
    for (const [name, v] of byBucket.get(g.at_ms) ?? []) {
      if (top.includes(name)) row[name] = v / 1000;
      else other += v;
    }
    // 没有值的那几层要显式给 0，否则 recharts 会把这一格整条断开
    for (const k of top) row[k] ??= 0;
    if (rest.length > 0) row["其他"] = other / 1000;
    return row;
  });

  /*
    缓存。**要的是率，不是累计量。**

    「省了多少」在一个长会话里只会一路涨，它回答不了「缓存到底有没有
    在起作用」。命中率回答得了：这段时间送上去的上下文里，有多大比例
    是从缓存拿的。
  */
  const ctx = s.input_tokens + s.cache_read_tokens + s.cache_write_tokens;
  const hit = ctx > 0 ? s.cache_read_tokens / ctx : null;
  const ratio = s.cache_write_tokens > 0 ? s.cache_read_tokens / s.cache_write_tokens : null;

  const troubles = [
    s.failed > 0 && {
      key: "failed",
      n: s.failed,
      what: "次失败",
      note: `占 ${((s.failed / Math.max(1, s.requests)) * 100).toFixed(1)}%`,
      bad: true,
    },
    s.unpriced_requests > 0 && {
      key: "unpriced",
      n: s.unpriced_requests,
      what: "条未计价",
      note: "该模型不在价目表中",
      bad: false,
    },
    d.leaks.length > 0 && {
      key: "leaks",
      n: d.leaks.reduce((a, l) => a + l.requests, 0),
      what: "次凭据外泄",
      note: "观察模式，未改动请求",
      bad: true,
    },
  ].filter((x) => x !== false);

  return (
    <div className="space-y-7 p-5">
      <section>
        {header}

        {/*
          **金额是主角，趋势图是它站的地面。**
          数字回答「多少」，形状回答「什么时候、花在什么上」—— 它们是
          一句话，所以图紧贴在数字下面、全宽、不套框也不加标题。
        */}
        <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="tw-num tw-display">{usd(spent)}</span>
          <span className="tw-body text-muted-foreground">
            {s.requests.toLocaleString()} 次请求
          </span>
          {delta != null && (
            <span className={"tw-body " + (delta < 0 ? "text-cache-hit" : "text-muted-foreground")}>
              较上一个{range.label} {delta < 0 ? "↓" : "↑"}{" "}
              {Math.abs(delta * 100).toFixed(0)}%
            </span>
          )}
          {hasEstimate && (
            <Tip text="上游未返回用量，或该模型的单价来自其他平台。这部分金额为估算值。">
              <span className="tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
                含估算 {usd(s.cost_micros_estimated)}
              </span>
            </Tip>
          )}
        </div>

        <div className="mt-4">
          <StackedArea
            data={area}
            keys={keys}
            colors={colors}
            height={96}
            empty="所选区间内无请求记录。"
          />
          {/*
            有失败的时段画在基线上。**不往金额高度里加** —— 加一格固定
            高度的话，那一格在 $0.50 的桶上看不见，在 $0.0005 的桶上
            直接翻倍，而它本来就不代表任何金额。
          */}
          <div className="flex h-0.5 gap-px bg-muted">
            {grid.map((g) => (
              <span key={g.at_ms} className={"flex-1 " + (g.failed > 0 ? "bg-destructive" : "")} />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between tw-label text-muted-foreground">
            <span>{fmtBucket(d.since_ms ?? 0, bucketMs)}</span>
            <span>现在</span>
          </div>
        </div>

        {/* 图例兼构成：按模型的总额就在这一行，不另开一张构成图 */}
        {keys.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 tw-body">
            {[...keys].reverse().map((k, i) => (
              <span key={k} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: colors[keys.length - 1 - i] }}
                />
                {k}
                <span className="tw-num text-muted-foreground">
                  {usd(k === "其他" ? rest.reduce((a, x) => a + x[1], 0) : (total.get(k) ?? 0))}
                </span>
              </span>
            ))}
            {grid.some((g) => g.failed > 0) && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-destructive" />
                有失败的时段
              </span>
            )}
          </div>
        )}

        {nothingYet && (
          <p className="mt-4 tw-body text-muted-foreground">
            将客户端指向{gatewayHint}后，用量与费用将在此处显示。
          </p>
        )}
      </section>

      {/*
        出事了的那一行。**全是零时整行不出现** —— 一排零不是安心，是在
        占地方。这也是全页唯一上语义色的地方。
      */}
      {troubles.length > 0 && (
        <section className="flex flex-wrap gap-x-8 gap-y-2">
          {troubles.map((x) => (
            <span key={x.key} className="flex items-baseline gap-1.5">
              <span
                className={
                  "tw-num text-lg leading-none font-medium " +
                  (x.bad ? "text-destructive" : "text-amber-600 dark:text-amber-400")
                }
              >
                {x.n}
              </span>
              <span className="tw-body text-muted-foreground">{x.what}</span>
              <span className="tw-label text-muted-foreground">{x.note}</span>
            </span>
          ))}
        </section>
      )}

      {/*
        缓存。**放在这个分量上，因为它是别的工具给不出来的那一块**，
        而且需要一点解释才读得懂。
      */}
      {ctx > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="tw-title font-semibold">缓存</h2>
            <p className="tw-body text-muted-foreground">
              送上去的上下文里，有多少是从缓存拿的
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="tw-num text-2xl leading-none font-medium">
              {hit == null ? "—" : `${Math.round(hit * 100)}%`}
            </span>
            <span className="tw-body text-muted-foreground">命中率</span>
            <span className="ml-auto flex flex-wrap items-baseline gap-x-6 gap-y-2 tw-body">
              {/*
                **净的，不是毛的。**缓存写是 1.25 倍单价，只算读省下的
                等于声称缓存永远只会让人省钱 —— 而一个反复重建、很少
                命中的用法真实账单更贵。所以这个数可以是负的。
              */}
              <span>
                {s.cache_saved_micros < 0 ? "净多花" : "净省"}{" "}
                <span
                  className={
                    "tw-num font-medium " +
                    (s.cache_saved_micros < 0 ? "text-destructive" : "text-cache-hit")
                  }
                >
                  {usd(Math.abs(s.cache_saved_micros))}
                </span>
              </span>
              {ratio != null && (
                <Tip text="写一次缓存多花 0.25 倍单价，每次命中省 0.9 倍 —— 读量到写量的约 28% 就回本。低于这个比例，缓存在亏钱。">
                  <span className="underline decoration-dotted underline-offset-2">
                    读写比 <span className="tw-num font-medium">{ratio.toFixed(1)} : 1</span>
                  </span>
                </Tip>
              )}
            </span>
          </div>

          {/* 这根条**就是命中率的公式本身**：三段按价位排，亮的那段越长越好 */}
          <div className="mt-3 flex h-3.5 overflow-hidden rounded-sm">
            <span
              className="bg-cache-hit"
              style={{ width: `${(s.cache_read_tokens / ctx) * 100}%` }}
            />
            <span
              className="bg-cache-plain"
              style={{ width: `${(s.input_tokens / ctx) * 100}%` }}
            />
            <span
              className="bg-cache-write"
              style={{ width: `${(s.cache_write_tokens / ctx) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 tw-body">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-cache-hit" />
              缓存读 {s.cache_read_tokens.toLocaleString()}
              <span className="tw-label text-muted-foreground">0.1 倍价</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-cache-plain" />
              新输入 {s.input_tokens.toLocaleString()}
              <span className="tw-label text-muted-foreground">1 倍</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-cache-write" />
              缓存写 {s.cache_write_tokens.toLocaleString()}
              <span className="tw-label text-muted-foreground">1.25 倍</span>
            </span>
          </div>
        </section>
      )}

      {/*
        出站密钥检测攒下的证据。**只在真的发现过东西时出现** ——
        没发现的时候显示一句「一切正常」是在占地方，而这一块的
        全部说服力来自「它说的是已经发生在你身上的事」。
      */}
      {d.leaks.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="tw-title font-semibold text-amber-900 dark:text-amber-200">
            凭据外泄检测
          </h2>
          <ul className="mt-2 space-y-1.5 tw-body text-amber-900 dark:text-amber-200">
            {d.leaks.map((l) => (
              <li key={`${l.provider}/${l.kind}`}>
                <span className="font-medium">{l.requests}</span> 个请求把{" "}
                <span className="font-medium">{l.kind}</span> 发给了{" "}
                <span className="font-medium">{l.provider || "上游"}</span>
                {l.masked.length > 0 && (
                  // **打码之后才显示。**把发现的密钥原样贴出来，等于
                  // 把泄漏搬了个家
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    · 涉及 {l.masked.join("、")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 tw-body text-amber-700 dark:text-amber-400">
            观察模式：只记录，没有改变任何请求。
            <Tip text="要真的替换成占位符，去「安全 › 防护」把出站脱敏切到「拦截」。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">
                怎么真的拦
              </span>
            </Tip>
          </p>
        </section>
      )}

      {/* 有得比的时候才比 —— 一个模型的时候，这张图说的是「它就是这么
          快」，那已经写在上面了 */}
      {d.latency.length > 1 && (
        <section>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="tw-title font-semibold">延迟</h2>
            <p className="tw-body text-muted-foreground">首字节，条子从 P50 画到 P95</p>
          </div>
          <Spread rows={d.latency} />
        </section>
      )}

      {/*
        **按上游分是另一个问题。**「哪个模型慢」的下一步是换模型，
        「哪家上游慢」的下一步是换上游 —— 合成一张图两个都答不好。
      */}
      {t.comparison && d.latency_by_provider.length > 1 && (
        <section>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="tw-title font-semibold">上游延迟对比</h2>
            <p className="tw-body text-muted-foreground">同上，按上游分</p>
          </div>
          <Spread rows={d.latency_by_provider} />
        </section>
      )}

      {/* 查得到就够了的那些，收成一行 —— 它们不值得各占一格 */}
      <section className="flex flex-wrap gap-x-6 gap-y-1.5 border-t border-border pt-4 tw-label text-muted-foreground">
        <span>
          输入 {s.input_tokens.toLocaleString()} · 输出 {s.output_tokens.toLocaleString()} token
        </span>
        {s.locally_answered > 0 && <span>本地应答 {s.locally_answered} 次，未转发至上游</span>}
        {s.subscription_requests > 0 && (
          <span>
            订阅额度调用 {s.subscription_requests} 次，
            {s.subscription_tokens.toLocaleString()} token，不计入金额
          </span>
        )}
        {(d.by_provider ?? []).length > 0 && (
          <span>
            上游{" "}
            {(d.by_provider ?? [])
              .slice(0, 4)
              .map((g) => `${g.name} ${usd(g.cost_micros)}`)
              .join(" · ")}
          </span>
        )}
        <span>价目表 {s.pricing_date}</span>
      </section>

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}

      {/* 存储状态。**正常时不显示** —— 没问题的时候不该占地方 */}
      {d.storage && d.storage.level !== "正常" && (
        <Alert variant="warning">
          <AlertDescription>
            {d.storage.level}
            {!d.storage.forwarding_affected && " —— 转发不受影响。"}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
