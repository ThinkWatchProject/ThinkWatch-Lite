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
import { LIVE_BUCKET_MS, useLive } from "./useLive";

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
          <span className="w-24 shrink-0 text-right tw-num text-muted-foreground">
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
            {l.samples} 次
          </span>
        </div>
      ))}
      {rows.length > shown.length && (
        <p className="tw-label text-muted-foreground">
          另有 {rows.length - shown.length} 项未列出
        </p>
      )}
    </>
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
        <span className={"inline-block size-2 shrink-0 rounded-[2px] " + color} />
        {name} {compact(n)}
        <span className="tw-label text-muted-foreground">{rate}</span>
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
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  /**
   * 图按哪个口径画。
   *
   * **默认 token。**这一页叫用量概览，而按金额画时一次 opus 突发会把
   * 前后一周压平 —— 那张图好看，但除了「opus 贵」说不出别的。
   */
  const [by, setBy] = useState<"token" | "cost">("token");
  const live = range.live === true;
  /*
    **实时档只有图是实时的。**两分钟窗口里算不出有意义的延迟分位，也
    统计不出缓存命中率；那些仍然按 24 小时算，图下面有一行小字说明。
    所以这里查的窗口和图的窗口是两回事。
  */
  const queryMs = live ? DAY : range.ms;
  const bucketMs = live ? LIVE_BUCKET_MS : bucketFor(range.ms);
  const { samples, fails, inFlight } = useLive(live, range.ms);
  /**
   * **只在内容真的变了的时候才换。**每次 `invoke` 回来都是一个新对象，
   * 直接 setState 会让整页重画一遍，而这一切发生在什么都没发生的时候。
   */
  const [d, setD] = useStableState<Data | null>(null);
  const gatewayHint = "本机网关地址";
  const [error, setError] = useState<string | null>(null);
  /** 点开的那一条。**抽屉是右侧覆盖的，不是跳页** */
  const [open, setOpen] = useState<number | null>(null);

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
      } catch (e) {
        if (alive) toast.error(typeof e === "string" ? e : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick, queryMs, bucketMs, live, setD]);

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
  const nothingYet = !t.cost;

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
    for (const x of samples) {
      volume.set(x.model, (volume.get(x.model) ?? 0) + x.tokens);
      count.set(x.model, (count.get(x.model) ?? 0) + 1);
      add(Math.floor(x.at / LIVE_BUCKET_MS) * LIVE_BUCKET_MS, x.model, x.tokens);
    }
  } else {
    for (const b of d.buckets_by_model ?? []) {
      const name = b.name || "未知模型";
      const cost = b.cost_micros_exact + b.cost_micros_estimated;
      const tok = b.input_tokens + b.output_tokens + b.cache_read_tokens + b.cache_write_tokens;
      money.set(name, (money.get(name) ?? 0) + cost);
      volume.set(name, (volume.get(name) ?? 0) + tok);
      count.set(name, (count.get(name) ?? 0) + b.requests);
      add(b.at_ms, name, by === "token" ? tok : cost);
    }
  }
  const useTokens = by === "token" || live;
  // 排行按当前口径排 —— 切到 token 之后，最贵的那个未必是用得最多的
  const ranked = [...(useTokens ? volume : money).entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 5).map(([name]) => name);
  const rest = ranked.slice(5);
  // 画的顺序是从下往上：**占得少的垫底、占得多的在上**，最重的那一层
  // 在视觉上也该最重。颜色跟着走，chart-1 最亮给最多的那个。
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
  const now = Date.now();
  const liveStart = Math.floor((now - range.ms) / LIVE_BUCKET_MS) * LIVE_BUCKET_MS;
  const grid = live
    ? Array.from({ length: Math.round(range.ms / LIVE_BUCKET_MS) }, (_, i) => ({
        at_ms: liveStart + i * LIVE_BUCKET_MS,
        requests: 0,
        failed: 0,
        cost_micros_exact: 0,
        cost_micros_estimated: 0,
        unpriced_requests: 0,
      }))
    : densify(d.buckets ?? [], d.since_ms ?? 0, now, bucketMs);
  if (live) {
    for (const at of fails) {
      const g = grid[Math.round((at - liveStart) / LIVE_BUCKET_MS)];
      if (g) g.failed += 1;
    }
  }
  const area = grid.map((g) => {
    const slot = byBucket.get(g.at_ms);
    const sum = [...(slot?.values() ?? [])].reduce((a, v) => a + v, 0);
    const row: Record<string, number | string> = {
      label: live
        ? `${fmtBucket(g.at_ms, bucketMs)}　${compact(sum)} token`
        : `${fmtBucket(g.at_ms, bucketMs)}　${
            useTokens
              ? `${compact(sum)} token`
              : usd(g.cost_micros_exact + g.cost_micros_estimated)
          }　${g.requests} 次${g.failed ? `（${g.failed} 次失败）` : ""}`,
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
    if (rest.length > 0) row["其他"] = other;
    return row;
  });

  const latMax =
    Math.max(1, ...d.latency.map((l) => l.p95), ...d.latency_by_provider.map((l) => l.p95)) * 1.04;

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
          /*
            两档留下的痕迹不是同一种：观察档记的是「检测到的外泄」，
            拦截档记的是「换掉了几处」。**分别说明** —— 用同一句话套
            两档的话，切到拦截之后会显示成「未发现」。
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
          // **这一行不跟着时间区间变。**它说的是此刻磁盘上的状态，而
          // 文件现在什么样和你选了看几天没有关系。
          hits: 0,
          saw:
            sec.scan_configs === "off"
              ? "未启用，客户端配置文件不做监控"
              : "持续监控客户端配置文件，新增可疑内容会立即提示",
        },
      ]
    : [];

  return (
    <div className="p-5">
      {header}

      {/*
        三个数并排：**做了多少、花了多少、发了多少次**。它们是同一层的
        事实，所以同一个字号。每个数下面跟着限定它的那几句 —— 失败挂在
        请求数上，估算和未计价挂在金额上。放别处就要读者自己去对。
      */}
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Tip text={`${tokensTotal.toLocaleString()} token`}>
              <span className="tw-num tw-display">{compact(tokensTotal)}</span>
            </Tip>
            <span className="tw-body text-muted-foreground">token</span>
            {beforeTokens > 0 && (
              <Delta v={(tokensTotal - beforeTokens) / beforeTokens} more={range.compare} />
            )}
          </div>
          <p className="mt-1 tw-label text-muted-foreground">
            输入 {compact(ctx)} · 输出 {compact(s.output_tokens)}
          </p>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="tw-num tw-display">{usd(spent)}</span>
            {beforeCost > 0 && (
              <Delta v={(spent - beforeCost) / beforeCost} more={range.compare} good="down" />
            )}
          </div>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 tw-label text-muted-foreground">
            {s.cost_micros_estimated > 0 && (
              <Tip text="上游未返回用量，或该模型的单价来自其他平台。此部分金额为估算值。">
                <span className="underline decoration-dotted underline-offset-2">
                  含估算 {usd(s.cost_micros_estimated)}
                </span>
              </Tip>
            )}
            {s.unpriced_requests > 0 && (
              <Tip text="这些请求所用的模型不在价目表中，它们的花费没有计入上面的金额。">
                <span className="underline decoration-dotted underline-offset-2">
                  {s.unpriced_requests} 条未计价
                </span>
              </Tip>
            )}
            {s.subscription_requests > 0 && (
              <Tip text="订阅型上游的边际成本为零，按 API 价目表折算出的金额是虚构的，因此不计入。">
                <span className="underline decoration-dotted underline-offset-2">
                  订阅额度 {s.subscription_requests} 次
                </span>
              </Tip>
            )}
            {s.cost_micros_estimated === 0 &&
              s.unpriced_requests === 0 &&
              s.subscription_requests === 0 &&
              "全部按价目表实测"}
          </p>
        </div>

        <div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="tw-num tw-display">{s.requests.toLocaleString()}</span>
            <span className="tw-body text-muted-foreground">次请求</span>
            {s.failed > 0 && <span className="tw-label text-destructive">{s.failed} 次失败</span>}
          </div>
          <p className="mt-1 tw-label text-muted-foreground">
            {live
              ? inFlight > 0
                ? `${inFlight} 个进行中`
                : "当前空闲"
              : `失败率 ${((s.failed / Math.max(1, s.requests)) * 100).toFixed(1)}%`}
          </p>
        </div>
      </div>

      <div className="relative mt-4">
        {/* 实时档只画 token —— 金额是落库时算的，事件流里没有 */}
        {!live && (
          <div className="absolute top-0 right-0 z-10">
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
        )}
        <StackedArea
          data={area}
          keys={keys}
          colors={colors}
          height={200}
          empty={live ? "等待请求。" : "所选区间内无请求记录。"}
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
            ? ["2 分钟前", "90 秒", "60 秒", "30 秒"]
            : [fmtBucket(d.since_ms ?? 0, bucketMs)]
          ).map((x) => (
            <span key={x}>{x}</span>
          ))}
          <span className={live ? "text-foreground" : ""}>现在</span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 tw-label text-muted-foreground">
          {grid.some((g) => g.failed > 0) && (
            <>
              <span className="inline-block h-0.5 w-3.5 bg-destructive" />
              <span>基线上的红色标出存在失败的时段</span>
            </>
          )}
          {live && <span>以下各项按最近 24 小时统计</span>}
        </p>
      </div>

      {nothingYet && (
        <p className="mt-4 tw-body text-muted-foreground">
          将客户端指向{gatewayHint}后，用量与费用将在此处显示。
          {s.locally_answered > 0 &&
            ` 已本地应答 ${s.locally_answered} 次客户端探测 —— 客户端已连上，这些探测未产生费用。`}
        </p>
      )}

      <div className="mt-5">
        {/*
          图例和构成合成一张排行。**药丸式的一行图例在模型一多就会折行，
          而且不携带比例。**这里的条长就是占比，色块和曲线里那一层同色
          —— 图例的职责就是那个映射，保留下来了。
        */}
        {keys.length > 0 && (
          <Block name="模型">
            {[...keys].reverse().map((k, i) => {
              const c = k === "其他" ? restMoney : (money.get(k) ?? 0);
              const v = k === "其他" ? restVolume : (volume.get(k) ?? 0);
              const n = k === "其他" ? restCount : (count.get(k) ?? 0);
              const color = colors[keys.length - 1 - i];
              return (
                <div key={k} className="flex items-center gap-2.5 tw-body">
                  <span
                    className="inline-block size-2 shrink-0 rounded-[2px]"
                    style={{ background: color }}
                  />
                  <span className="w-40 shrink-0 truncate" title={k}>
                    {k === "其他" ? `其他 ${rest.length} 项` : k}
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
                  <Tip text={`${v.toLocaleString()} token`}>
                    <span
                      className={
                        "w-16 shrink-0 text-right tw-num " +
                        (useTokens ? "font-medium" : "text-muted-foreground")
                      }
                    >
                      {compact(v)}
                    </span>
                  </Tip>
                  {!live && (
                    <span
                      className={
                        "w-16 shrink-0 text-right tw-num " +
                        (by === "cost" ? "font-medium" : "text-muted-foreground")
                      }
                    >
                      {usd(c)}
                    </span>
                  )}
                  <span className="w-11 shrink-0 text-right tw-label text-muted-foreground">
                    {n} 次
                  </span>
                </div>
              );
            })}
          </Block>
        )}

        {/*
          缓存。**要的是率，不是累计量** —— 「省了多少」在一个长会话里
          只会一路涨，它回答不了「缓存到底有没有在起作用」。
        */}
        {ctx > 0 && (
          <Block name="缓存">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 tw-body">
              <span className="tw-num tw-title leading-none font-medium">
                {hit == null ? "—" : `${Math.round(hit * 100)}%`}
              </span>
              <span className="text-muted-foreground">命中</span>
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
                **净额，不是毛额。**缓存写入按 1.25 倍单价计费，只统计
                命中省下的部分，等于声称缓存永远只会降低支出 —— 而一份
                反复重建缓存、命中很少的用法，实际账单高于不使用缓存。
              */}
              <span className="text-muted-foreground">
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
                  <span className="text-muted-foreground underline decoration-dotted underline-offset-2">
                    读写比 <span className="tw-num font-medium">{ratio.toFixed(1)} : 1</span>
                  </span>
                </Tip>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 tw-body">
              <Swatch color="bg-cache-hit" name="缓存读" n={s.cache_read_tokens} rate="0.1 倍单价" />
              <Swatch color="bg-cache-plain" name="新输入" n={s.input_tokens} rate="1 倍" />
              <Swatch color="bg-cache-write" name="缓存写" n={s.cache_write_tokens} rate="1.25 倍" />
            </div>
          </Block>
        )}

        {/*
          **左右两栏，各自纵向长。**「哪个模型慢」的下一步是换模型，
          「哪家上游慢」的下一步是换上游 —— 两个问题各占一栏。排成一行
          的话，上游一多就横向挤爆了。
        */}
        {d.latency.length > 0 && (
          <Block name="延迟">
            <div className="grid gap-x-7 gap-y-3 lg:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <p className="tw-label text-muted-foreground">按模型 · 首字节 P50 至 P95</p>
                <Spread rows={d.latency} max={latMax} />
              </div>
              {t.comparison && d.latency_by_provider.length > 0 && (
                <div className="min-w-0 space-y-1.5">
                  <p className="tw-label text-muted-foreground">按上游 · 同上</p>
                  <Spread rows={d.latency_by_provider} max={latMax} />
                </div>
              )}
            </div>
          </Block>
        )}

        {/*
          安全。**没有发现时也在，而且说「未发现」。**这一页别处的纪律
          是「条件不满足就不出现」—— 那条对成本面板成立：一排零不构成
          安心。但安全是反过来的：**看不见的防护会被当成没开**。
        */}
        {guards.length > 0 && (
          <Block name="安全">
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
                <span className="w-11 shrink-0 text-muted-foreground">{label(g.mode)}</span>
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

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}

      {/* 存储状态。**正常时不显示** —— 没问题的时候不该占地方 */}
      {d.storage && d.storage.level !== "正常" && (
        <Alert variant="warning" className="mt-5">
          <AlertDescription>
            {d.storage.level}
            {!d.storage.forwarding_affected && " —— 转发不受影响。"}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
