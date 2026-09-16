import { useEffect, useState } from "react";
import { useStableState } from "./useStable";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import RequestDrawer from "./RequestDrawer";
import { triggers } from "./triggers";
import { StackedArea } from "@/ui/charts";
import { bucketStart, compact, densify } from "./format";
import { usd, type Dashboard as Data, type LatencyView, type Overview } from "./types";
import { Alert, AlertDescription } from "@/ui/alert";
import { toast } from "sonner";
import { DEFAULT_RANGE, RangePicker, type Range } from "@/ui/range";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
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
 * 一个环比。
 *
 * **没有参照系的数字只能读，不能判断** ——「$0.956」是多还是少，只有
 * 和上一个等长区间比过才知道。
 *
 * 只有花费那一侧有「好坏」：少花是好事，所以降下来才上色。用量那一侧
 * 两个方向都不上色 —— 多用掉一些 token 不是问题，少用也不是成绩。
 */
function Delta({ v, more, good }: { v: number; more: string; good?: "down" }) {
  const better = good === "down" && v < 0;
  return (
    <span className={"tw-label " + (better ? "text-cache-hit" : "text-muted-foreground")}>
      较上一个{more} {v < 0 ? "↓" : "↑"} {Math.abs(v * 100).toFixed(0)}%
    </span>
  );
}

/** 缓存构成条上的一段。 */
function Swatch({
  color,
  name,
  n,
  rate,
}: {
  color: string;
  name: string;
  n: number;
  rate: string;
}) {
  return (
    <Tip text={`${n.toLocaleString()} token`}>
      <span className="flex items-center gap-1.5">
        <span className={"inline-block h-2 w-2 shrink-0 rounded-[2px] " + color} />
        {name} {compact(n)}
        <span className="tw-label text-muted-foreground">{rate}</span>
      </span>
    </Tip>
  );
}

/**
 * 延迟的分位区间。
 *
 * **区间条，不是两列数字。**并排的两列毫秒数要逐行读才能比较，而这张
 * 图要回答的是「哪个模型既慢又不稳定」—— 那是条的**起点加长度**，
 * 一次扫视就能得到。亮线标的是 P50：多数请求落在它附近。
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
            {l.samples} 次{l.samples < 10 && " · 样本不足"}
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
export default function Dashboard({ tick, ov }: { tick: number; ov: Overview | null }) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  /**
   * 图按哪个口径画。
   *
   * **默认 token。**这一页叫用量概览，而按金额画时一次 opus 突发会把
   * 前后一周压平 —— 那张图好看，但除了「opus 贵」说不出别的。
   */
  const [by, setBy] = useState<"token" | "cost">("token");
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
    **「输入」是送往上游的全部上下文，包含命中缓存的那部分。**
    `input_tokens` 单独一个字段说的是「没命中缓存的那部分」—— 命中率
    高的时候它只有真实输入的零头，直接标成「输入」会让人以为自己这段
    时间几乎没用。
  */
  const ctx = s.input_tokens + s.cache_read_tokens + s.cache_write_tokens;
  const tokensIn = ctx;
  const tokensTotal = ctx + s.output_tokens;
  const beforeTokens = d.prev
    ? d.prev.input_tokens +
      d.prev.cache_read_tokens +
      d.prev.cache_write_tokens +
      d.prev.output_tokens
    : 0;
  const tokenDelta = beforeTokens > 0 ? (tokensTotal - beforeTokens) / beforeTokens : null;
  const hit = ctx > 0 ? s.cache_read_tokens / ctx : null;
  const ratio = s.cache_write_tokens > 0 ? s.cache_read_tokens / s.cache_write_tokens : null;

  /*
    趋势图按模型分层。

    **两种口径画的是两种形状。**一次 opus 突发在按金额的图上会压平
    它前后的整整一周，而它传达的只是「opus 贵」—— 图例里已经写着。
    同一段时间按 token 画出来，那个峰回到它应有的比例，图才开始能
    看出作息。头部那两个数等重，图跟着其中一个走就行，但要能切。

    **只保留前四项，其余合并为「其他」。**一家上游可能报出十几个模型
    名，十几层叠在九十六像素里已经分辨不出，而排在后面的那些合计往往
    不到百分之一。
  */
  const byBucket = new Map<number, Map<string, number>>();
  const money = new Map<string, number>();
  const volume = new Map<string, number>();
  for (const b of d.buckets_by_model ?? []) {
    const name = b.name || "未知模型";
    const cost = b.cost_micros_exact + b.cost_micros_estimated;
    const tok =
      b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens;
    money.set(name, (money.get(name) ?? 0) + cost);
    volume.set(name, (volume.get(name) ?? 0) + tok);
    const slot = byBucket.get(b.at_ms) ?? new Map<string, number>();
    slot.set(name, (slot.get(name) ?? 0) + (by === "token" ? tok : cost));
    byBucket.set(b.at_ms, slot);
  }
  // 排行按当前口径排 —— 切到 token 之后，最贵的那个未必是用得最多的
  const sortBy = by === "token" ? volume : money;
  const ranked = [...sortBy.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 5).map(([name]) => name);
  const rest = ranked.slice(5);
  // 画的顺序是从下往上，所以**占得少的垫底、占得多的在上** —— 最重的
  // 那一层在视觉上也该最重。颜色跟着走：chart-1 最亮，给最多的那个。
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
  const restMoney = rest.reduce((a, x) => a + (money.get(x[0]) ?? 0), 0);
  const restVolume = rest.reduce((a, x) => a + (volume.get(x[0]) ?? 0), 0);
  // 条长按当前口径里最大的那一项归一 —— 按总量归一的话，一个占七成的
  // 模型会把其余几条压成看不见的短线，而排行要比的正是它们之间的差距
  const topMoney = Math.max(restMoney, ...[...money.values()]);
  const topVolume = Math.max(restVolume, ...[...volume.values()]);

  const grid = densify(d.buckets ?? [], d.since_ms ?? 0, Date.now(), bucketMs);
  const area = grid.map((g) => {
    const slot = byBucket.get(g.at_ms);
    const sum = [...(slot?.values() ?? [])].reduce((a, v) => a + v, 0);
    const row: Record<string, number | string> = {
      label: `${fmtBucket(g.at_ms, bucketMs)}　${
        by === "token" ? `${compact(sum)} token` : usd(g.cost_micros_exact + g.cost_micros_estimated)
      }　${g.requests} 次${g.failed ? `（${g.failed} 次失败）` : ""}`,
    };
    let other = 0;
    for (const [name, v] of slot ?? []) {
      // 金额从微分换成千分之一美元：纵轴刻度上那几位小数没有意义
      const y = by === "token" ? v : v / 1000;
      if (top.includes(name)) row[name] = y;
      else other += y;
    }
    // 没有值的那几层要显式给 0，否则 recharts 会把这一格整条断开
    for (const k of top) row[k] ??= 0;
    if (rest.length > 0) row["其他"] = other;
    return row;
  });

  /*
    三条防线现在各在哪一档，以及这段时间各自看见了什么。

    **档位和所见要一起说。**只说所见的话，「未发现」在关闭档下是句
    空话；只说档位的话，用户不知道它到底拦下过什么。
  */
  const sec = ov?.security;
  const label = (m: string) => (m === "enforce" ? "拦截" : m === "off" ? "关闭" : "观察");
  const leaked = d.leaks.reduce((a, l) => a + l.requests, 0);
  const guards = sec
    ? [
        {
          key: "redact",
          name: "出站脱敏",
          mode: sec.redact,
          modeLabel: label(sec.redact),
          /*
            两档留下的痕迹不是同一种：观察档记的是「检测到的外泄」，
            拦截档记的是「换掉了几处」。**分别说明** —— 用同一句话
            套两档的话，切到拦截之后会显示成「未发现」。
          */
          hits: sec.redact === "enforce" ? s.redacted_requests : leaked,
          saw:
            sec.redact === "off"
              ? "未启用，出站内容不做检查"
              : sec.redact === "enforce"
                ? s.redacted_requests > 0
                  ? `已替换 ${s.redacted_requests} 个请求中的凭据`
                  : "未发现需要替换的内容"
                : leaked > 0
                  ? `检测到 ${leaked} 次凭据外泄，未做替换`
                  : "未检测到凭据外泄",
        },
        {
          key: "inspect",
          name: "工具调用检查",
          mode: sec.inspect_tools,
          modeLabel: label(sec.inspect_tools),
          hits: s.flagged_requests,
          saw:
            sec.inspect_tools === "off"
              ? "未启用，上游返回的工具调用不做检查"
              : s.flagged_requests > 0
                ? `${s.flagged_requests} 个请求带回可疑工具调用` +
                  (sec.inspect_tools === "enforce" ? "，已切断" : "")
                : "未发现可疑工具调用",
        },
        {
          key: "scan",
          name: "配置面扫描",
          mode: sec.scan_configs,
          modeLabel: label(sec.scan_configs),
          // **这一行不跟着时间区间变。**它说的是此刻磁盘上的状态，
          // 而文件现在什么样和你选了看几天没有关系。
          hits: 0,
          saw:
            sec.scan_configs === "off"
              ? "未启用，客户端配置文件不做监控"
              : "持续监控客户端配置文件，新增可疑内容会立即提示",
        },
      ]
    : [];

  /*
    这一段时间里值得单独说明的几件事。

    **轻重由颜色分，不由位置分。**失败和外泄是问题，用告警色；未计价
    是一句限定（那部分支出没有计入上面的金额）；本地应答和订阅额度是
    中性事实。全为零时整行不出现 —— 一排零不构成安心，只占位置。
  */
  const notes = [
    s.failed > 0 && {
      key: "failed",
      n: s.failed,
      what: "次请求失败",
      note: `占 ${((s.failed / Math.max(1, s.requests)) * 100).toFixed(1)}%`,
      tone: "bad" as const,
    },
    d.leaks.length > 0 && {
      key: "leaks",
      n: d.leaks.reduce((a, l) => a + l.requests, 0),
      what: "次凭据外泄",
      note: "观察模式，未修改请求",
      tone: "bad" as const,
    },
    s.unpriced_requests > 0 && {
      key: "unpriced",
      n: s.unpriced_requests,
      what: "条请求未计价",
      note: "所用模型不在价目表中，未计入金额",
      tone: "warn" as const,
    },
    s.subscription_requests > 0 && {
      key: "subscription",
      n: s.subscription_requests,
      what: "次订阅额度调用",
      note: `${compact(s.subscription_tokens)} token，不计入金额`,
      tone: "plain" as const,
    },
    // **正向的那一条也留着。**它既证明客户端确实连上了，又说明那些
    // 探测没有产生任何费用。
    s.locally_answered > 0 && {
      key: "local",
      n: s.locally_answered,
      what: "次本地应答",
      note: "未转发至上游，无费用",
      tone: "plain" as const,
    },
  ].filter((x) => x !== false);

  return (
    <div className="space-y-7 p-5">
      <section>
        {header}

        {/*
          **用量和花费并排，不分主次。**这一页叫「用量概览」，而在此之前
          顶上一个 token 都没有 —— 只有钱。用掉多少 token 是这个工具
          唯一一个「越大越好」的数字，它和花了多少是同一件事的两面。

          「输入」是**送往上游的全部上下文**，包含命中缓存的那部分。
          只算 `input_tokens` 的话，报出来的是「没命中缓存的那部分输入」
          —— 命中率高的时候它只有真实输入的零头，而那个数字会被当成
          「我这段时间才用了这么点」。
        */}
        <div className="mt-4 grid gap-x-10 gap-y-4 sm:grid-cols-2">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Tip text={`${tokensTotal.toLocaleString()} token`}>
                <span className="tw-num tw-display">{compact(tokensTotal)}</span>
              </Tip>
              <span className="tw-body text-muted-foreground">token</span>
              {tokenDelta != null && <Delta v={tokenDelta} more={range.compare} />}
            </div>
            <p className="mt-1 tw-body text-muted-foreground">
              输入 {compact(tokensIn)} · 输出 {compact(s.output_tokens)}
            </p>
          </div>
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="tw-num tw-display">{usd(spent)}</span>
              {delta != null && <Delta v={delta} more={range.compare} good="down" />}
            </div>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3 tw-body text-muted-foreground">
              <span>{s.requests.toLocaleString()} 次请求</span>
              {hasEstimate && (
                <Tip text="上游未返回用量，或该模型的单价来自其他平台。此部分金额为估算值。">
                  <span className="tw-label underline decoration-dotted underline-offset-2">
                    含估算 {usd(s.cost_micros_estimated)}
                  </span>
                </Tip>
              )}
            </p>
          </div>
        </div>

        {/*
          输入按计费单价拆开。**紧跟在「输入」下面，不另立一节** ——
          它解释的就是上面那个数，隔开之后读的人要自己把两处对上。

          这根条就是命中率本身：三段按单价排列，亮的那段越长越省。
        */}
        {ctx > 0 && (
          <div className="mt-5">
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 tw-body">
              <span>
                缓存命中{" "}
                <span className="tw-num font-medium">
                  {hit == null ? "—" : `${Math.round(hit * 100)}%`}
                </span>
              </span>
              <span className="ml-auto flex flex-wrap items-baseline gap-x-5 gap-y-1">
                {/*
                  **净额，不是毛额。**缓存写入按 1.25 倍单价计费，只统计
                  命中省下的部分，等于声称缓存永远只会降低支出 —— 而一份
                  反复重建缓存、命中很少的用法，实际账单高于不使用缓存。
                  所以这个数可以是负的。
                */}
                <span>
                  {s.cache_saved_micros < 0 ? "净增成本" : "净节省"}{" "}
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
                  <Tip text="缓存写入按输入单价的 1.25 倍计费，命中读取按 0.1 倍计费。读取量达到写入量的约 28% 即可抵消写入成本；低于该比例，缓存将增加总支出。">
                    <span className="underline decoration-dotted underline-offset-2">
                      读写比 <span className="tw-num font-medium">{ratio.toFixed(1)} : 1</span>
                    </span>
                  </Tip>
                )}
              </span>
            </div>
            <div className="mt-2 flex h-3.5 overflow-hidden rounded-sm">
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
              <Swatch color="bg-cache-hit" name="缓存读" n={s.cache_read_tokens} rate="0.1 倍单价" />
              <Swatch color="bg-cache-plain" name="新输入" n={s.input_tokens} rate="1 倍" />
              <Swatch color="bg-cache-write" name="缓存写" n={s.cache_write_tokens} rate="1.25 倍" />
            </div>
          </div>
        )}

        <div className="mt-6">
          <div className="mb-2 flex items-baseline gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={by}
              onValueChange={(v) => v && setBy(v as "token" | "cost")}
            >
              <ToggleGroupItem value="token">token</ToggleGroupItem>
              <ToggleGroupItem value="cost">花费</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <StackedArea
            data={area}
            keys={keys}
            colors={colors}
            height={96}
            empty="所选区间内无请求记录。"
          />
          {/*
            存在失败的时段画在基线上。**不往金额高度里加** —— 加一格固定
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

        {/*
          图例和构成合成一张排行。

          **药丸式的一行图例在模型一多就会折行，而且不携带比例。**这里
          的条长就是占比，色块和曲线里那一层同色 —— 图例的职责就是那个
          映射，保留下来了。两个数都给，当前口径的那个加粗。
        */}
        {keys.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {[...keys].reverse().map((k, i) => {
              const c = k === "其他" ? restMoney : (money.get(k) ?? 0);
              const v = k === "其他" ? restVolume : (volume.get(k) ?? 0);
              const w = (by === "token" ? v / Math.max(1, topVolume) : c / Math.max(1, topMoney)) * 100;
              return (
                <div key={k} className="flex items-center gap-2.5 tw-body">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ background: colors[keys.length - 1 - i] }}
                  />
                  <span className="w-44 shrink-0 truncate" title={k}>
                    {k === "其他" ? `其他 ${rest.length} 项` : k}
                  </span>
                  <span className="h-2.5 flex-1 rounded-sm bg-muted">
                    <span
                      className="block h-full rounded-sm"
                      style={{ width: `${w}%`, background: colors[keys.length - 1 - i] }}
                    />
                  </span>
                  <Tip text={`${v.toLocaleString()} token`}>
                    <span
                      className={
                        "w-20 shrink-0 text-right tw-num " +
                        (by === "token" ? "font-medium" : "text-muted-foreground")
                      }
                    >
                      {compact(v)}
                    </span>
                  </Tip>
                  <span
                    className={
                      "w-20 shrink-0 text-right tw-num " +
                      (by === "cost" ? "font-medium" : "text-muted-foreground")
                    }
                  >
                    {usd(c)}
                  </span>
                </div>
              );
            })}
            {grid.some((g) => g.failed > 0) && (
              <p className="flex items-center gap-2.5 pt-0.5 tw-label text-muted-foreground">
                <span className="inline-block h-2 w-2 shrink-0 rounded-[2px] bg-destructive" />
                曲线下方的红色刻度标出存在失败的时段
              </p>
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
        这段时间里值得单独说明的几件事。**全为零时整行不出现** —— 一排零
        不构成安心，只占位置。这也是全页唯一使用语义色的地方。
      */}
      {notes.length > 0 && (
        <section className="flex flex-wrap gap-x-8 gap-y-2">
          {notes.map((x) => (
            <span key={x.key} className="flex items-baseline gap-1.5">
              <span
                className={
                  "tw-num text-lg leading-none font-medium " +
                  (x.tone === "bad"
                    ? "text-destructive"
                    : x.tone === "warn"
                      ? "text-amber-600 dark:text-amber-400"
                      : "")
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
        安全防护。

        **没有发现时也在，而且说「未发现」。**这一页别处的纪律是「条件
        不满足就不出现」—— 那条对成本面板成立：一排零不构成安心。但
        安全是反过来的：**看不见的防护会被当成没开**，而用户需要的恰恰
        是「它在盯着，这段时间没事」这句话。

        每一行说两件事：**现在是哪一档**，以及**这段时间看见了什么**。
        「观察」和「拦截」对用户是完全不同的两件事，而这个区别在此之前
        只有防护页里看得到。
      */}
      {sec && (
        <section>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="tw-title font-semibold">安全防护</h2>
            <p className="tw-body text-muted-foreground">三条防线的当前档位与本区间所见</p>
          </div>
          <div className="mt-2 space-y-1.5">
            {guards.map((g) => (
              <div key={g.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 tw-body">
                <span
                  className={
                    "inline-block h-2 w-2 shrink-0 translate-y-px rounded-full " +
                    (g.mode === "off"
                      ? "bg-muted-foreground/40"
                      : g.hits > 0
                        ? "bg-destructive"
                        : "bg-cache-hit")
                  }
                />
                <span className="w-32 shrink-0">{g.name}</span>
                <span className="w-16 shrink-0 text-muted-foreground">{g.modeLabel}</span>
                <span className={g.hits > 0 ? "text-destructive" : "text-muted-foreground"}>
                  {g.saw}
                </span>
              </div>
            ))}
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
            <p className="tw-body text-muted-foreground">首字节延迟，区间为 P50 至 P95</p>
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
            <p className="tw-body text-muted-foreground">首字节延迟，按上游分组</p>
          </div>
          <Spread rows={d.latency_by_provider} />
        </section>
      )}

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
