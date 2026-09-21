import { useEffect, useRef, useState } from "react";
import { useStableState } from "./useStable";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import RequestDrawer from "./RequestDrawer";
import { triggers } from "./triggers";
import { StackedArea } from "@/ui/charts";
import { bucketStart, compact, densify } from "./format";
import { usd, type Dashboard as Data, type LatencyView, type Overview } from "./types";
import { Alert, AlertDescription } from "@/ui/alert";
import { DEFAULT_RANGE, RangePicker, type Range } from "@/ui/range";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { Skeleton } from "@/ui/skeleton";
import { LIVE_BUCKET_MS, LIVE_REACH_MS, LIVE_SIGMA_MS, useLive } from "./useLive";
import { useCountUp } from "./useCountUp";
import { secretLabel, storageText } from "./labels";
import { useText } from "@/i18n";
import { dashboardText } from "./Dashboard.i18n";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 每一栏最多列几项。超出的写出来有几项，**不静默丢掉**。 */
const ROWS = 6;

/**
 * 一格多宽。
 *
 * **比「一小时一格」细得多，这是故意的。**少而肥的格子只能看出「这段
 * 时间有没有用过」；细到四五十格以上，图上开始能看出**作息** —— 白天
 * 成片、夜里断开、周末矮一截。一张能看出作息的图才是仪表。
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
/** 往上取到最近的 1/2/5 × 10ⁿ。纵轴上界用它，刻度才落在整数上。 */
function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

function fmtBucket(atMs: number, bucketMs: number): string {
  const t = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  if (bucketMs >= DAY) return `${t.getMonth() + 1}/${t.getDate()}`;
  if (bucketMs < 60_000) return `${p(t.getMinutes())}:${p(t.getSeconds())}`;
  return `${t.getMonth() + 1}/${t.getDate()} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/**
 * 读数据时的骨架。
 *
 * **不是一句「读取中…」。**那一行字占的地方和真正的内容差着两百像素，
 * 读完之后整页会跳一次；而这一页最大的那几个数字恰好在跳动的位置上。
 */
function OverviewSkeleton() {
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-[200px] w-full" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
    </>
  );
}

/** 一块密排信息。左边那列标签把所有块钉在同一条竖线上。 */
function Block({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section className="flex items-start gap-4 border-t border-border/60 py-2.5">
      <span className="w-12 shrink-0 pt-0.5 tw-label">{name}</span>
      <div className="min-w-0 flex-1 space-y-1.5">{children}</div>
    </section>
  );
}

/**
 * 延迟的分位区间。
 *
 * **区间条，不是两列数字。**并排的两列毫秒数要逐行读才能比较，而这张
 * 图要回答的是「哪个又慢又不稳定」—— 那是条的起点加长度，一次扫视
 * 就能得到。亮线标的是 P50：多数请求落在它附近。
 *
 * 用分位数不用平均值：AI 延迟是长尾分布，平均值会被极端值拉偏。
 */
function Spread({ rows, max }: { rows: LatencyView[]; max: number }) {
  const t = useText(dashboardText);
  const shown = [...rows].sort((a, b) => b.samples - a.samples).slice(0, ROWS);
  return (
    <>
      {shown.map((l) => (
        <div key={l.model} className="flex items-center gap-2.5 tw-body">
          <span className="min-w-0 flex-1 truncate" title={l.model}>
            {l.model}
          </span>
          {/* 条宽固定：两栏的条这样才对齐，能横着比 */}
          <span className="relative h-2.5 w-26 shrink-0 rounded-sm bg-muted">
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
          <span className="w-28 shrink-0 text-right tw-num whitespace-nowrap text-muted-foreground">
            {l.p50} – {l.p95}ms
          </span>
          {/*
            **样本数要显示**：「800ms」是 3 个样本还是 300 个，含义完全
            不同。不可靠的是**样本数**，不是延迟值 —— 所以只标这个数。
          */}
          <span
            className={
              "w-11 shrink-0 text-right tw-label " +
              (l.samples < 10 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")
            }
          >
            {t.times(l.samples)}
          </span>
        </div>
      ))}
      {rows.length > shown.length && (
        <p className="tw-label text-muted-foreground">
          {t.moreNotListed(rows.length - shown.length)}
        </p>
      )}
    </>
  );
}

/**
 * 页眉上的一个大数。
 *
 * **三栏等宽，说明那一行固定占两行高。**在此之前这三组是并排的弹性
 * 块，而「较上一个区间」在没有可比数据时整个消失 —— 于是切一次时间
 * 范围，三个数字的横向位置全变了，眼睛每次都要重新找。
 *
 * 所以限定语一律放到第二行：第一行只留那个数和单位，宽度由它决定，
 * 而它在各种区间下长得都差不多。
 */
function Stat({
  n,
  unit,
  after,
  note,
}: {
  n: string;
  unit?: string;
  after?: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="tw-num tw-display">{n}</span>
        {unit && <span className="tw-body text-muted-foreground">{unit}</span>}
        {after}
      </div>
      {/* 高度写死两行：少一条限定语时不该把整页往上收 */}
      <p className="mt-1 flex min-h-8 flex-wrap items-baseline gap-x-2 tw-label text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

/**
 * 一个环比。
 *
 * **没有参照系的数字只能读，不能判断。**只有花费那一侧有「好坏」：
 * 少花是好事，所以降下来才上色。用量那一侧两个方向都不上色 —— 多用掉
 * 一些 token 不是问题，少用也不是成绩。
 */
function Delta({ v, more, good }: { v: number; more: string; good?: "down" }) {
  const t = useText(dashboardText);
  const better = good === "down" && v < 0;
  return (
    <span className={"tw-label " + (better ? "text-cache-hit" : "text-muted-foreground")}>
      {t.delta(more, v < 0 ? "↓" : "↑", Math.abs(v * 100).toFixed(0))}
    </span>
  );
}

/** 缓存构成条上的一段。 */
function Swatch({ color, name, n }: { color: string; name: string; n: number }) {
  const t = useText(dashboardText);
  return (
    <Tip text={t.tokens(n.toLocaleString(), n)}>
      <span className="flex items-center gap-1.5">
        <span className={"inline-block size-2 shrink-0 rounded-[2px] " + color} />
        {name} {compact(n)}
      </span>
    </Tip>
  );
}

/**
 * 用量概览。
 *
 * 这一页的每一个数字都受那条约束：**绝不让估算值混进精确数字里
 * 假装准确。**所以金额旁边永远跟着它的限定词。
 *
 * 版面上只有一个视觉锚点：那张图。其余全是发丝线分隔的密排行，左边
 * 一列标签把它们钉在同一条竖线上 —— **参照物是原生监控工具，不是网页
 * 后台**。圆角卡片的网格恰恰是最像后台的做法。
 */
export default function Dashboard({ tick, ov }: { tick: number; ov: Overview | null }) {
  const t = useText(dashboardText);
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  /**
   * 图按哪个口径画。
   *
   * **默认 token。**这一页叫用量概览，而按金额画时一次 opus 突发会把
   * 前后一周压平 —— 那张图好看，但除了「opus 贵」说不出别的。
   */
  const [by, setBy] = useState<"token" | "cost">("token");
  /*
    纵轴的上界**不跟着每一帧的峰值走**。

    自动域下，一个大请求进出窗口就让整条曲线连同刻度一起上下弹 ——
    看起来像图在抖，其实抖的是尺子。所以上界取一个整齐的数（1/2/5
    档），而且只在实际峰值掉到它一半以下时才降档：在档位边界上来回
    过线的话，抖得比不取整还厉害。

    口径和区间一换，量级差几个数量级，得重新起。
  */
  const yHold = useRef({ key: "", v: 0 });
  /*
    上一次的堆叠次序。**名次要有滞回。**

    两个模型量级接近时，没有滞回就会在名次边界上来回过线，而每过一次
    线，整条带子在纵向跳过另一条、颜色还跟着换（颜色是按名次给的）。
    实测这个演示实例的流量：按两分钟窗口排，十分钟里换位 145 次；改按
    24 小时排降到 14 次；要到零得让换位本身有门槛。
  */
  const stack = useRef<string[]>([]);
  const live = range.live === true;
  /*
    **实时档只有图是实时的。**两分钟窗口里算不出有意义的延迟分位，也
    统计不出缓存命中率；那些仍然按 24 小时算，图下面有一行小字说明。
    所以这里查的窗口和图的窗口是两回事。
  */
  const queryMs = live ? DAY : range.ms;
  const bucketMs = live ? LIVE_BUCKET_MS : bucketFor(range.ms);
  /*
    **多留一个核宽的样本。**最左边那一格的鼓包有一半来自图外的那几秒；
    按图的宽度留样本的话，左端会凭空塌下去一个口子。
  */
  const { samples, fails, inFlight } = useLive(live, range.ms + LIVE_REACH_MS);
  /**
   * **只在内容真的变了的时候才换。**每次 `invoke` 回来都是一个新对象，
   * 直接 setState 会让整页重画一遍，而这一切发生在什么都没发生的时候。
   */
  const [d, setD] = useStableState<Data | null>(null);
  const gatewayHint = t.gatewayHint;
  const [error, setError] = useState<string | null>(null);
  /** 点开的那一条。**抽屉是右侧覆盖的，不是跳页** */
  const [open, setOpen] = useState<number | null>(null);

  /*
    三个大数会走过去，不是跳过去。

    **只在同一个口径里走**：换时间范围时那不是「涨了」，是换了一个东西
    在看 —— 从 251k 滚到 661k 看起来像用量突然翻了三倍，所以
    `range.label` 一变就直接落值。

    **这三个 hook 必须站在早返回之前。**下面有「还没读到数据」和
    「出错了」两条 return，而 React 要求每次渲染调用的 hook 数量一致
    —— 放在后面的话，数据第一次到达的那一刻整页会崩。所以这里用
    `d?.` 取值，读不到就是 0。
  */
  const sum = d?.summary;
  const tokensAt = useCountUp(
    sum
      ? sum.input_tokens + sum.cache_read_tokens + sum.cache_write_tokens + sum.output_tokens
      : 0,
    range.label,
  );
  const spentAt = useCountUp(
    sum ? sum.cost_micros_exact + sum.cost_micros_estimated : 0,
    range.label,
  );
  const requestsAt = useCountUp(sum?.requests ?? 0, range.label);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 窗口起点对齐到格子边界，格宽一起送过去 —— 两边各算一遍的话，
        // 补空桶时格子对不上，整张图会是零。见 bucketStart 的注释。
        //
        // 实时档下这次查询要的是 24 小时的汇总，图另有来路，所以格宽
        // 取一小时就够 —— 一秒一格去查二十四小时是八万多个分组。
        const q = live ? HOUR : bucketMs;
        const sinceMs = bucketStart(Date.now() - queryMs, q);
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const x = await invoke<Data>("dashboard", { sinceMs, bucketMs: q });
        if (alive) {
          setD(x);
          setError(null);
        }
      } catch {
        /*
          **读不到不在这一层报。**连不上控制面是启动过程中的预期状态，
          而 App 那边已经用一整面（或一条带子）在说这件事了 —— 这儿再弹
          一条 toast，就是同一件事说两遍，而且说得更难懂。

          上一次读到的值留着不动：一个凝固的旧数字加上面那句「已断开」，
          比清空成骨架有用。
        */
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick, queryMs, bucketMs, live, setD]);

  /*
    **两组控件不放在一起。**时间范围管的是整页（下面每一块都跟着它
    走），口径只管那一张图 —— 两个不同维度的东西并排成一串同样的药丸，
    读起来就是一排七个平级选项。

    所以范围留在标题行右端（页面级），口径挪到图的正上方、左对齐
    （图级），中间隔着整排大数字。
  */
  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <div className="ml-auto">
        <RangePicker value={range} onChange={setRange} />
      </div>
    </div>
  );

  /**
   * 图按什么口径画。**两档都在实时下可用** —— core 会在算完价钱之后
   * 补一条 `request_priced`，所以金额也是推过来的，只比用量晚一拍。
   */
  const metric = (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={by}
      onValueChange={(v) => v && setBy(v as "token" | "cost")}
    >
      <ToggleGroupItem value="token">{t.byTokens}</ToggleGroupItem>
      <ToggleGroupItem value="cost">{t.byCost}</ToggleGroupItem>
    </ToggleGroup>
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
  const has = triggers(null, d);
  const spent = s.cost_micros_exact + s.cost_micros_estimated;
  const nothingYet = !has.cost;

  /*
    **「输入」是送往上游的全部上下文，包含命中缓存的那部分。**
    `input_tokens` 单独一个字段说的是「没命中缓存的那部分」—— 命中率
    高的时候它只有真实输入的零头，标成「输入」会让人以为自己几乎没用。
  */
  const ctx = s.input_tokens + s.cache_read_tokens + s.cache_write_tokens;
  const tokensTotal = ctx + s.output_tokens;
  const beforeCost = d.prev ? d.prev.cost_micros_exact + d.prev.cost_micros_estimated : 0;
  const beforeTokens = d.prev
    ? d.prev.input_tokens +
      d.prev.cache_read_tokens +
      d.prev.cache_write_tokens +
      d.prev.output_tokens
    : 0;
  const hit = ctx > 0 ? s.cache_read_tokens / ctx : null;
  const ratio = s.cache_write_tokens > 0 ? s.cache_read_tokens / s.cache_write_tokens : null;


  /*
    趋势图按模型分层。**只保留前五项，其余合并为「其他」** —— 一家上游
    可能报出十几个模型名，十几层叠在两百像素里已经分辨不出，而排在后面
    的那些合计往往不到百分之一。
  */
  /*
    实时档的格子**不对齐整秒**：最右边那一格就是此刻，往左每格一秒。
    对齐到整秒的话，格子只在跨秒的那一帧整体挪一格，曲线于是每秒跳
    一次；而高斯核在任意时刻都求得出值，格子没有必须落在整秒上的理由。
  */
  const nowMs = Date.now();
  const liveSpan = Math.round(range.ms / LIVE_BUCKET_MS);
  const liveAt = live
    ? Array.from(
        { length: liveSpan },
        (_, i) => nowMs - (liveSpan - 1 - i) * LIVE_BUCKET_MS,
      )
    : [];
  const byBucket = new Map<number, Map<string, number>>();
  const money = new Map<string, number>();
  const volume = new Map<string, number>();
  const count = new Map<string, number>();
  const add = (at: number, name: string, v: number) => {
    const slot = byBucket.get(at) ?? new Map<string, number>();
    slot.set(name, (slot.get(name) ?? 0) + v);
    byBucket.set(at, slot);
  };
  if (live) {
    /*
      **一条请求摊成一个高斯鼓包，不是一根针也不是一个方块。**
      核归一到总权重 1，所以摊完之后每一格读作速率：token 口径是
      token/秒，费用口径乘 3600 换成每小时 —— 实时看网关，想知道的
      是此刻烧钱多快，而「这一秒花了 $0.0003」没有人读得出大小。

      排行和总量不走这条路：它们数的是这两分钟里实际发生的量，
      一条请求只算一次，在上面。
    */
    /*
      核在**格子的时刻**上求值，不在「第几格」上求值 —— 这样格子挪到
      哪儿都对得上，曲线是平移的，不会因为重新分桶而抖。

      归一化除的是连续高斯的积分（σ√2π）再折算成每格一秒，所以摊完
      之后一格读作速率。
    */
    const norm = (LIVE_SIGMA_MS * Math.SQRT2 * Math.sqrt(Math.PI)) / LIVE_BUCKET_MS;
    const twoSigmaSq = 2 * LIVE_SIGMA_MS * LIVE_SIGMA_MS;
    for (const x of samples) {
      volume.set(x.model, (volume.get(x.model) ?? 0) + x.tokens);
      money.set(x.model, (money.get(x.model) ?? 0) + (x.cost ?? 0));
      count.set(x.model, (count.get(x.model) ?? 0) + 1);
      const rate = (by === "token" ? x.tokens : (x.cost ?? 0) * 3600) / norm;
      // 只碰核够得着的那几格
      const lo = Math.max(
        0,
        Math.ceil((x.at - LIVE_REACH_MS - (liveAt[0] ?? 0)) / LIVE_BUCKET_MS),
      );
      const hi = Math.min(
        liveAt.length - 1,
        Math.floor((x.at + LIVE_REACH_MS - (liveAt[0] ?? 0)) / LIVE_BUCKET_MS),
      );
      for (let i = lo; i <= hi; i++) {
        const t = liveAt[i];
        if (t === undefined) continue;
        const d = t - x.at;
        add(t, x.model, rate * Math.exp(-(d * d) / twoSigmaSq));
      }
    }
  } else {
    for (const b of d.buckets_by_model ?? []) {
      const name = b.name || t.unknownModel;
      const cost = b.cost_micros_exact + b.cost_micros_estimated;
      const tok = b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens;
      money.set(name, (money.get(name) ?? 0) + cost);
      volume.set(name, (volume.get(name) ?? 0) + tok);
      count.set(name, (count.get(name) ?? 0) + b.requests);
      add(b.at_ms, name, by === "token" ? tok : cost);
    }
  }
  const useTokens = by === "token";
  /*
    **堆叠的次序不跟着实时窗口走。**

    按窗口内的用量排的话，几个模型量级接近时排名一两秒就翻一次 ——
    一翻，整条带子在纵向跳过另一条，颜色还跟着换（颜色是按名次给的）。
    那比曲线自己的移动剧烈得多，看起来就是图在抽。

    所以实时档按**最近 24 小时**的用量定次序：那份数据本来就在手上
    （见上面查询里的 `q`），而且只随慢刷新变。历史档按它自己那段排，
    那段本来就不会在两帧之间变。量相同时按名字定，免得 Map 的插入
    顺序泄漏进来。
  */
  const steady = new Map<string, number>();
  if (live) {
    for (const b of d.buckets_by_model ?? []) {
      const name = b.name || t.unknownModel;
      const v = useTokens
        ? b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens
        : b.cost_micros_exact + b.cost_micros_estimated;
      steady.set(name, (steady.get(name) ?? 0) + v);
    }
  }
  // 排行按当前口径排 —— 切到 token 之后，最贵的那个未必是用得最多的
  const here = useTokens ? volume : money;
  // 排行按当前口径排 —— 切到 token 之后，最贵的那个未必是用得最多的。
  // **这是给人读的列表，它就该从大到小**，和图的堆叠次序不是一回事。
  const ranked = [...here.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, 5).map(([name]) => name);
  const rest = ranked.slice(5);

  /*
    图里的堆叠次序另算。画的顺序是从下往上：**占得少的垫底、占得多的
    在上**，最重的那一层在视觉上也该最重；颜色跟着走，chart-1 最亮给
    最多的那个。要紧的是这个次序**不能每帧都重算一遍**。

    记住的次序里还在的那些保持相对位置，新出现的按量插进去；之后只在
    一个模型**明显**超过它上一名（两成）时才换位。历史档不需要这一层
    —— 那段数据两帧之间本来就不变。
  */
  const val = (m: string) => (live ? steady : here).get(m) ?? 0;
  const byVolume = [...top].sort((a, b) => val(b) - val(a) || a.localeCompare(b));
  let stacked = byVolume;
  if (live) {
    const kept = stack.current.filter((m) => top.includes(m));
    for (const m of byVolume) if (!kept.includes(m)) kept.splice(byVolume.indexOf(m), 0, m);
    for (let i = kept.length - 1; i > 0; i--) {
      const up = kept[i - 1];
      const down = kept[i];
      if (up === undefined || down === undefined) continue;
      if (val(down) > val(up) * 1.2) {
        kept[i - 1] = down;
        kept[i] = up;
      }
    }
    stack.current = kept;
    stacked = kept;
  }
  const otherKey = t.other;
  const keys =
    rest.length > 0 ? [otherKey, ...[...stacked].reverse()] : [...stacked].reverse();
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
  // **色块按名字查。**列表按用量排、图按堆叠次序排，两边要对得上同一个色
  const colorOf = new Map(keys.map((k, i) => [k, colors[i] ?? "var(--chart-1)"]));
  const restMoney = rest.reduce((a, x) => a + (money.get(x[0]) ?? 0), 0);
  const restVolume = rest.reduce((a, x) => a + (volume.get(x[0]) ?? 0), 0);
  const restCount = rest.reduce((a, x) => a + (count.get(x[0]) ?? 0), 0);
  // 条长按当前口径里**最大的那一项**归一。按总量归一的话，一个占七成
  // 的模型会把其余几条压成看不见的短线，而排行要比的正是它们的差距。
  const topBar = Math.max(
    1,
    useTokens ? Math.max(restVolume, ...volume.values()) : Math.max(restMoney, ...money.values()),
  );

  /*
    实时档的格子自己铺：两分钟、一秒一格，一路铺到「现在」。
    历史档沿用后端给的桶 —— 空桶由 `densify` 补成 0，这是面积图不会把
    空档画成「连续在用」的前提。
  */
  const now = nowMs;
  const grid = live
    ? liveAt.map((at_ms) => ({
        at_ms,
        requests: 0,
        failed: 0,
        cost_micros_exact: 0,
        cost_micros_estimated: 0,
        unpriced_requests: 0,
        no_usage_requests: 0,
      }))
    : densify(d.buckets ?? [], d.since_ms ?? 0, now, bucketMs);
  if (live) {
    const from = liveAt[0] ?? 0;
    for (const at of fails) {
      const g = grid[Math.round((at - from) / LIVE_BUCKET_MS)];
      if (g) g.failed += 1;
    }
  }
  const area = grid.map((g) => {
    const slot = byBucket.get(g.at_ms);
    const sum = [...(slot?.values() ?? [])].reduce((a, v) => a + v, 0);
    const row: Record<string, number | string> = {
      label: live
        ? t.liveBucket(
            fmtBucket(g.at_ms, bucketMs),
            useTokens
              ? t.tokenRate(compact(Math.round(sum)))
              : t.costRate(usd(sum)),
          )
        : t.bucket(
            fmtBucket(g.at_ms, bucketMs),
            useTokens
              ? t.tokens(compact(sum), sum)
              : usd(g.cost_micros_exact + g.cost_micros_estimated),
            g.requests,
            g.failed,
          ),
    };
    let other = 0;
    for (const [name, v] of slot ?? []) {
      // 金额从微分换成千分之一美元：纵轴上那几位小数没有意义
      const y = useTokens ? v : v / 1000;
      if (top.includes(name)) row[name] = y;
      else other += y;
    }
    // 没有值的那几层要显式给 0，否则 recharts 会把这一格整条断开
    for (const k of top) row[k] ??= 0;
    if (rest.length > 0) row[otherKey] = other;
    return row;
  });

  const peak = area.reduce((hi, row) => {
    let sum = 0;
    for (const k of keys) {
      const v = row[k];
      if (typeof v === "number") sum += v;
    }
    return Math.max(hi, sum);
  }, 0);
  const yKey = `${by}/${range.label}`;
  if (yHold.current.key !== yKey) yHold.current = { key: yKey, v: 0 };
  if (peak > yHold.current.v || peak < yHold.current.v * 0.5)
    yHold.current = { key: yKey, v: niceCeil(peak * 1.08) };
  const yMax = yHold.current.v || undefined;

  const latMax =
    Math.max(1, ...d.latency.map((l) => l.p95), ...d.latency_by_provider.map((l) => l.p95)) * 1.04;

  /*
    三条防线现在各在哪一档，以及这段时间各自看见了什么。

    **档位和所见要一起说。**只说所见的话，「未发现」在关闭档下是句
    空话；只说档位的话，用户不知道它到底拦下过什么。
  */
  const sec = ov?.security;
  const label = (m: string) =>
    m === "enforce" ? t.modeEnforce : m === "off" ? t.modeOff : t.modeObserve;
  const leaked = d.leaks.reduce((a, l) => a + l.requests, 0);
  const guards = sec
    ? [
        {
          key: "redact",
          name: t.redact,
          mode: sec.redact,
          /*
            两档留下的痕迹不是同一种：观察档记的是「检测到的外泄」，
            拦截档记的是「换掉了几处」。**分别说明** —— 用同一句话套
            两档的话，切到拦截之后会显示成「未发现」。
          */
          hits: sec.redact === "enforce" ? s.redacted_requests : leaked,
          saw:
            sec.redact === "off"
              ? t.redactOff
              : sec.redact === "enforce"
                ? s.redacted_requests > 0
                  ? t.redacted(s.redacted_requests)
                  : t.nothingToReplace
                : leaked > 0
                  ? t.leaksDetected(leaked)
                  : t.noLeaks,
        },
        {
          key: "inspect",
          name: t.inspect,
          mode: sec.inspect_tools,
          hits: s.flagged_requests,
          saw:
            sec.inspect_tools === "off"
              ? t.inspectOff
              : s.flagged_requests > 0
                ? t.flagged(s.flagged_requests, sec.inspect_tools === "enforce")
                : t.noFlagged,
        },
        {
          key: "scan",
          name: t.scan,
          mode: sec.scan_configs,
          // **这一行不跟着时间区间变。**它说的是此刻磁盘上的状态，而
          // 文件现在什么样和你选了看几天没有关系。
          hits: 0,
          saw: sec.scan_configs === "off" ? t.scanOff : t.scanOn,
        },
      ]
    : [];

  return (
    <div className="p-5">
      {header}

      {/*
        三个数并排：**做了多少、花了多少、发了多少次**。它们是同一层的
        事实，所以同一个字号、同一个宽度的栏。

        **等宽栏，而不是并排的弹性块。**后者会让「较上一个区间」这类
        时有时无的限定语改变每一栏的宽度，切一次范围三个数字就横向
        挪一次位置。
      */}
      <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <Stat
          n={compact(tokensAt)}
          unit={t.tokenUnit(tokensAt)}
          note={
            <>
              {beforeTokens > 0 && (
                <Delta v={(tokensTotal - beforeTokens) / beforeTokens} more={range.compare} />
              )}
              <Tip text={t.tokens(tokensTotal.toLocaleString(), tokensTotal)}>
                <span>{t.inputOutput(compact(ctx), compact(s.output_tokens))}</span>
              </Tip>
            </>
          }
        />

        <Stat
          n={usd(spentAt)}
          note={
            <>
              {beforeCost > 0 && (
                <Delta v={(spent - beforeCost) / beforeCost} more={range.compare} good="down" />
              )}
              {s.cost_micros_estimated > 0 && (
                <Tip text={t.estimatedTip}>
                  <span className="underline decoration-dotted underline-offset-2">
                    {t.estimated(usd(s.cost_micros_estimated))}
                  </span>
                </Tip>
              )}
              {s.unpriced_requests > 0 && (
                <Tip text={t.unpricedTip}>
                  <span className="underline decoration-dotted underline-offset-2">
                    {t.unpriced(s.unpriced_requests)}
                  </span>
                </Tip>
              )}
              {(s.no_usage_requests ?? 0) > 0 && (
                <Tip text={t.noUsageTip}>
                  <span className="underline decoration-dotted underline-offset-2">
                    {t.noUsage(s.no_usage_requests ?? 0)}
                  </span>
                </Tip>
              )}
              {s.subscription_requests > 0 && (
                <Tip text={t.subscriptionTip}>
                  <span className="underline decoration-dotted underline-offset-2">
                    {t.subscription(s.subscription_requests)}
                  </span>
                </Tip>
              )}
              {s.cost_micros_estimated === 0 &&
                s.unpriced_requests === 0 &&
                (s.no_usage_requests ?? 0) === 0 &&
                s.subscription_requests === 0 && <span>{t.allMeasured}</span>}
            </>
          }
        />

        <Stat
          n={Math.round(requestsAt).toLocaleString()}
          unit={t.requestUnit(Math.round(requestsAt))}
          after={
            s.failed > 0 && <span className="tw-label text-destructive">{t.failed(s.failed)}</span>
          }
          note={
            <>
              <span>{t.failureRate(((s.failed / Math.max(1, s.requests)) * 100).toFixed(1))}</span>
              {live && <span>{inFlight > 0 ? t.inFlight(inFlight) : t.idle}</span>}
            </>
          }
        />
      </div>

      <div className="mt-4">
        <div className="mb-2 flex justify-end">{metric}</div>
        <StackedArea
          data={area}
          keys={keys}
          colors={colors}
          height={200}
          empty={live ? t.waiting : t.noRequests}
          /*
            **纵轴的单位跟着口径走，和悬停里那句一致。**费用那一路
            的图值是千分之一美元（见上面 `y`），刻度要换回微分再格式化。
          */
          tickFormat={(v) => (useTokens ? compact(v) : usd(v * 1000))}
          yMax={yMax}
          liveEdge={live}
        />
        {/*
          有失败的时段画在基线上。**不往高度里加** —— 加一格固定高度的
          话，那一格在大桶上看不见、在小桶上直接翻倍，而它本来就不代表
          任何数量。
        */}
        <div className="flex h-0.5 gap-px bg-muted">
          {grid.map((g) => (
            <span key={g.at_ms} className={"flex-1 " + (g.failed > 0 ? "bg-destructive" : "")} />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between tw-label text-muted-foreground">
          {(live
            ? t.liveTicks
            : [fmtBucket(d.since_ms ?? 0, bucketMs)]
          ).map((x) => (
            <span key={x}>{x}</span>
          ))}
          <span className={live ? "text-foreground" : ""}>{t.now}</span>
        </div>
        {/* 这一行有没有话说都占一行高：少一句就把下面整块往上提，
            正是切换时的那种来回动 */}
        <p className="mt-2 flex min-h-4 flex-wrap items-center gap-x-2 gap-y-1 tw-label text-muted-foreground">
          {grid.some((g) => g.failed > 0) && (
            <>
              <span className="inline-block h-0.5 w-3.5 bg-destructive" />
              <span>{t.failureMarks}</span>
            </>
          )}
          {/*
            实时档下这一页有两个口径，必须说清哪个是哪个：**模型排行
            是这张图的图例**（色块要对得上曲线里那一层），所以跟着图
            走；而两分钟里算不出分位延迟和命中率，那些连同顶部的数字
            一起按 24 小时算。
          */}
          {live && <span>{t.liveScope}</span>}
        </p>
      </div>

      {nothingYet && (
        <p className="mt-4 tw-body text-muted-foreground">
          {t.pointClients(gatewayHint)}
          {s.locally_answered > 0 && t.probesAnswered(s.locally_answered)}
        </p>
      )}

      <div className="mt-5">
        {/*
          图例和构成合成一张排行。**药丸式的一行图例在模型一多就会折行，
          而且不携带比例。**这里的条长就是占比，色块和曲线里那一层同色
          —— 图例的职责就是那个映射，保留下来了。
        */}
        {/*
          **这一块永远在。**它在「有数据」和「没数据」之间消失的话，
          切一次时间范围整页就上下弹一次。没有数据时留一行字占住。
        */}
        <Block name={t.models}>
          {keys.length === 0 && (
            <p className="tw-body text-muted-foreground">
              {live ? t.waiting : t.noRequests}
            </p>
          )}
          {[...top, ...(rest.length > 0 ? [otherKey] : [])].map((k) => {
              const c = k === otherKey ? restMoney : (money.get(k) ?? 0);
              const v = k === otherKey ? restVolume : (volume.get(k) ?? 0);
              const n = k === otherKey ? restCount : (count.get(k) ?? 0);
              const color = colorOf.get(k);
              return (
                <div key={k} className="flex items-center gap-2.5 tw-body">
                  <span
                    className="inline-block size-2 shrink-0 rounded-[2px]"
                    style={{ background: color }}
                  />
                  <span className="w-40 shrink-0 truncate" title={k}>
                    {k === otherKey ? t.otherCount(rest.length) : k}
                  </span>
                  <span className="h-2.5 flex-1 rounded-sm bg-muted">
                    <span
                      className="block h-full rounded-sm"
                      style={{
                        width: `${((useTokens ? v : c) / topBar) * 100}%`,
                        background: color,
                      }}
                    />
                  </span>
                  <Tip text={t.tokens(v.toLocaleString(), v)}>
                    <span
                      className={
                        "w-16 shrink-0 text-right tw-num " +
                        (useTokens ? "font-medium" : "text-muted-foreground")
                      }
                    >
                      {compact(v)}
                    </span>
                  </Tip>
                  <span
                    className={
                      "w-16 shrink-0 text-right tw-num " +
                      (by === "cost" ? "font-medium" : "text-muted-foreground")
                    }
                  >
                    {usd(c)}
                  </span>
                  <span className="w-11 shrink-0 text-right tw-label text-muted-foreground">
                    {t.times(n)}
                  </span>
                </div>
              );
            })}
        </Block>

        {/*
          缓存。**要的是率，不是累计量** —— 「省了多少」在一个长会话里
          只会一路涨，它回答不了「缓存到底有没有在起作用」。
        */}
        <Block name={t.cache}>
          {ctx === 0 ? (
            <p className="tw-body text-muted-foreground">{t.noTokens}</p>
          ) : (
            <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 tw-body">
              <span className="tw-num tw-title leading-none font-medium">
                {hit == null ? "—" : `${Math.round(hit * 100)}%`}
              </span>
              <span className="text-muted-foreground">{t.hitRate}</span>
              {/* 这根条**就是命中率的公式本身**：三段按单价排，亮的越长越省 */}
              <span className="flex h-2.5 min-w-32 flex-1 overflow-hidden rounded-sm">
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
              </span>
              {/*
                **净额，不是毛额。**缓存写入通常按高于输入的单价计费，
                只统计命中省下的部分，等于声称缓存永远只会降低支出 ——
                而一份反复重建缓存、命中很少的用法，实际账单高于不使用
                缓存。倍率各家不同，这个数是按每个模型自己的价目算的。
              */}
              <span className="text-muted-foreground">
                {s.cache_saved_micros < 0 ? t.netCost : t.netSavings}{" "}
                <span
                  className={
                    "tw-num font-medium " +
                    (s.cache_saved_micros < 0 ? "text-destructive" : "text-cache-hit")
                  }
                >
                  {usd(Math.abs(s.cache_saved_micros))}
                </span>
              </span>
              {/*
                **不解释倍率。**读写各按几倍计费是某一家的价目，而这一
                页上的模型可能来自任何一家上游 —— 把一家的计费规则写死
                在界面上，对别家就是错的。

                旁边那个净节省已经说清了结论，而它是按**每个模型自己的
                价目**算出来的；读写比只是那个结论的来路，摆在这里让人
                能自己看一眼比例，不需要再加一段说明。
              */}
              {ratio != null && (
                <span className="text-muted-foreground">
                  {t.readWrite} <span className="tw-num font-medium">{ratio.toFixed(1)} : 1</span>
                </span>
              )}
            </div>
            {/* 同上：不标倍率。三段的顺序本身就是从便宜到贵 */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 tw-body">
              <Swatch color="bg-cache-hit" name={t.cacheReads} n={s.cache_read_tokens} />
              <Swatch color="bg-cache-plain" name={t.uncachedInput} n={s.input_tokens} />
              <Swatch color="bg-cache-write" name={t.cacheWrites} n={s.cache_write_tokens} />
            </div>
            </>
          )}
        </Block>

        {/*
          **左右两栏，各自纵向长。**「哪个模型慢」的下一步是换模型，
          「哪家上游慢」的下一步是换上游 —— 两个问题各占一栏。排成一行
          的话，上游一多就横向挤爆了。
        */}
        <Block name={t.latency}>
          {d.latency.length === 0 ? (
            <p className="tw-body text-muted-foreground">{t.notEnoughSamples}</p>
          ) : (
            <div className="grid gap-x-7 gap-y-3 lg:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <p className="tw-label text-muted-foreground">{t.byModel}</p>
                <Spread rows={d.latency} max={latMax} />
              </div>
              {has.comparison && d.latency_by_provider.length > 0 && (
                <div className="min-w-0 space-y-1.5">
                  <p className="tw-label text-muted-foreground">{t.byUpstream}</p>
                  <Spread rows={d.latency_by_provider} max={latMax} />
                </div>
              )}
            </div>
          )}
        </Block>

        {/*
          安全。**没有发现时也在，而且说「未发现」。**这一页别处的纪律
          是「条件不满足就不出现」—— 那条对成本面板成立：一排零不构成
          安心。但安全是反过来的：**看不见的防护会被当成没开**。
        */}
        {guards.length > 0 && (
          <Block name={t.security}>
            {guards.map((g) => (
              <div key={g.key} className="flex items-baseline gap-2.5 tw-body">
                <span
                  className={
                    "inline-block size-2 shrink-0 translate-y-px rounded-full " +
                    (g.mode === "off"
                      ? "bg-muted-foreground/40"
                      : g.hits > 0
                        ? "bg-destructive"
                        : "bg-cache-hit")
                  }
                />
                <span className="w-40 shrink-0">{g.name}</span>
                {/* 56px：Observe 要 51，44 的话会压到后面那一列上 */}
                <span className="w-14 shrink-0 text-muted-foreground">{label(g.mode)}</span>
                <span className={g.hits > 0 ? "text-destructive" : "text-muted-foreground"}>
                  {g.saw}
                </span>
              </div>
            ))}
          </Block>
        )}
      </div>

      {/*
        出站密钥检测攒下的证据。**只在真的发现过东西时出现** —— 这一块
        的全部说服力来自「它说的是已经发生在你身上的事」。
      */}
      {d.leaks.length > 0 && (
        <section className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="tw-title font-semibold text-amber-900 dark:text-amber-200">
            {t.leaksTitle}
          </h2>
          <ul className="mt-2 space-y-1.5 tw-body text-amber-900 dark:text-amber-200">
            {d.leaks.map((l) => (
              <li key={`${l.provider}/${l.secret}`}>
                {t.leak(
                  l.requests,
                  l.provider || t.someUpstream,
                  secretLabel(l.secret),
                  (x) => <span className="font-medium">{x}</span>,
                )}
                {l.masked.length > 0 && (
                  // **打码之后才显示。**把发现的密钥原样贴出来，等于
                  // 把泄漏搬了个家
                  <span className="text-amber-700 dark:text-amber-400">
                    {" "}
                    · {t.involving(l.masked)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 tw-body text-amber-700 dark:text-amber-400">
            {t.observeOnly}
            <Tip text={t.enforceTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">
                {t.enforce}
              </span>
            </Tip>
          </p>
        </section>
      )}

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}

      {/* 存储状态。**正常时不显示** —— 没问题的时候不该占地方 */}
      {d.storage && d.storage.level !== "ok" && (
        <Alert variant="warning" className="mt-5">
          <AlertDescription>
            {storageText(d.storage.level)}
            {!d.storage.forwarding_affected && t.forwardingUnaffected}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
