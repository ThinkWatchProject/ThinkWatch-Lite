import { useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import RequestDrawer from "./RequestDrawer";
import { triggers } from "./triggers";
import { BarChart, BarRows } from "@/ui/charts";
import { densify } from "./format";
import { usd, type Dashboard as Data } from "./types";
import { Alert, AlertDescription } from "@/ui/alert";
import { toast } from "sonner";
import { DEFAULT_RANGE, RangePicker, type Range } from "@/ui/range";
import { Item } from "@/ui/item";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

/** 一格指标。这三格放的是这个产品独有的口径，不是通用计数。 */
function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Item variant="outline" className="flex-col items-stretch gap-0.5">
      <span className="tw-label text-muted-foreground">{label}</span>
      <span className="tw-num text-xl leading-tight">{value}</span>
      {hint && <span className="tw-label text-muted-foreground">{hint}</span>}
    </Item>
  );
}

/** 一格的时间标签。桶宽超过一天就只写日期，否则写到小时。 */
function fmtBucket(atMs: number, bucketMs: number): string {
  const t = new Date(atMs);
  if (bucketMs >= 24 * 3_600_000) {
    return `${t.getMonth() + 1}/${t.getDate()}`;
  }
  return `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:00`;
}

/**
 * 今天的账。
 *
 * 这一页的每一个数字都受那条约束：**绝不让估算值混进精确数字里
 * 假装准确。**所以成本是三个数并排，不是一个。
 */
export default function Dashboard({ tick }: { tick: number }) {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  /** 桶宽跟着窗口走 —— 和后端那边算的是同一套，否则补空桶会补错格数 */
  const bucketMs =
    range.ms > 7 * 24 * 3_600_000
      ? 24 * 3_600_000
      : range.ms > 2 * 24 * 3_600_000
        ? 6 * 3_600_000
        : 3_600_000;
  const [d, setD] = useState<Data | null>(null);
  const gatewayHint = "本机网关地址";
  const [error, setError] = useState<string | null>(null);
  /** 点开的那一条。**抽屉是右侧覆盖的，不是跳页** —— 用户要能一边看
      详情一边对着列表里的别的行 */
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const x = await invoke<Data>("dashboard", { windowMs: range.ms });
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
  }, [tick, range.ms]);

  if (error) {
    return (
      <div className="p-5">
        <Alert variant="warning">
          <AlertDescription>
          {error}
        </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!d) return <p className="p-5 tw-body text-muted-foreground">读取中…</p>;

  const s = d.summary;
  const t = triggers(null, d);
  const hasEstimate = s.cost_micros_estimated > 0;
  // 条件不满足就**不出现**，不是折叠。一个还没有任何数据的成本
  // 面板是在展示空壳，而它占的地方本来可以放「接下来该做什么」
  const nothingYet = !t.cost;

  return (
    <div className="space-y-8 p-5">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="tw-title font-semibold">用量概览</h2>
          <div className="ml-auto">
            <RangePicker value={range} onChange={setRange} />
          </div>
        </div>

        {nothingYet ? (
          <Empty className="mt-3">
            <EmptyHeader>
              <EmptyTitle>暂无请求记录</EmptyTitle>
              <EmptyDescription>
                将客户端指向 {gatewayHint}，数据将在此显示。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {/*
              **金额是主角，趋势图是它站的地面。**
              数字回答「多少」，形状回答「什么时候」—— 它们是一句话，
              所以图紧贴在数字下面、全宽、不套框也不加标题。
            */}
            <div className="mt-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tw-num tw-display">
                  {usd(s.cost_micros_exact + s.cost_micros_estimated)}
                </span>
                <span className="tw-body text-muted-foreground">
                  {s.requests.toLocaleString()} 次请求
                  {s.failed > 0 && ` · ${s.failed} 次失败`}
                </span>
                {hasEstimate && (
                  <Tip text="上游未返回用量，或该模型的单价来自其他平台。这部分金额为估算值。">
                    <span className="tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
                      含估算 {usd(s.cost_micros_estimated)}
                    </span>
                  </Tip>
                )}
              </div>

              <div className="mt-3">
                <BarChart
                  height={72}
                  empty="所选区间内无请求记录。"
                  bars={densify(
                    d.buckets ?? [],
                    d.since_ms ?? 0,
                    Date.now(),
                    bucketMs,
                  ).map((b) => ({
                    at: b.at_ms,
                    value: (b.cost_micros_exact + b.cost_micros_estimated) / 1000,
                    sub: b.failed > 0 ? 1 : 0,
                    label: `${fmtBucket(b.at_ms, bucketMs)}　${usd(
                      b.cost_micros_exact + b.cost_micros_estimated,
                    )}　${b.requests} 次${b.failed ? `（${b.failed} 次失败）` : ""}`,
                  }))}
                />
                <div className="mt-1 flex justify-between tw-label text-muted-foreground">
                  <span>{fmtBucket(d.since_ms ?? 0, bucketMs)}</span>
                  <span>现在</span>
                </div>
              </div>
            </div>

            {/*
              这三格放的是**别的工具给不出来的数**。请求数、token 数那类
              通用指标跟在金额后面走，不单独占位。
            */}
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Fact
                label="缓存节省"
                value={s.cache_saved_micros > 0 ? usd(s.cache_saved_micros) : "—"}
                hint={
                  s.cache_saved_micros > 0
                    ? `占实际支出的 ${Math.round(
                        (s.cache_saved_micros /
                          Math.max(1, s.cache_saved_micros + s.cost_micros_exact)) *
                          100,
                      )}%`
                    : "本区间无缓存命中"
                }
              />
              <Fact
                label="本地应答"
                value={`${s.locally_answered}`}
                hint="未转发至上游，无费用"
              />
              <Fact
                label="未计价请求"
                value={`${s.unpriced_requests}`}
                hint={
                  s.unpriced_requests > 0
                    ? "该模型不在价目表中，金额未计入"
                    : "不限请求均已计价"
                }
              />
            </div>

            {s.subscription_requests > 0 && (
              <p className="mt-3 tw-body text-muted-foreground">
                订阅额度调用 {s.subscription_requests} 次，
                {s.subscription_tokens.toLocaleString()} token，不计入金额。
              </p>
            )}

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 tw-body">
              <dt className="text-muted-foreground">输入 / 输出</dt>
              <dd className="tw-num">
                {s.input_tokens.toLocaleString()} / {s.output_tokens.toLocaleString()} token
              </dd>
              <dt className="text-muted-foreground">缓存读 / 写</dt>
              <dd className="tw-num">
                {s.cache_read_tokens.toLocaleString()} / {s.cache_write_tokens.toLocaleString()}{" "}
                token
              </dd>
              <dt className="text-muted-foreground">价目表版本</dt>
              <dd className="tw-num">{s.pricing_date}</dd>
            </dl>
          </>
        )}
      </section>

      {/*
        出站密钥检测攒下的证据。**只在真的发现过东西时出现** ——
        没发现的时候显示一句「一切正常」是在占地方，而这一块的
        不限说服力来自「它说的是已经发生在你身上的事」。
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
              <span className="ml-1 underline decoration-dotted underline-offset-2">怎么真的拦</span>
            </Tip>
          </p>
        </section>
      )}

      {/*
        **按上游分是另一个问题。**「哪个模型慢」的下一步是换模型，
        「哪家上游慢」的下一步是换上游 —— 合成一张表两个都答不好。
        只有一家上游时不显示：那时这张表说的是「它就是这么快」。
      */}
      {t.comparison && d.latency_by_provider.length > 1 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="tw-title font-semibold">上游延迟对比</h2>
            <span className="tw-body text-neutral-400">首字节，按上游分</span>
          </div>
          <Table className="mt-2 tw-num">
            <TableHeader>
              <TableRow>
                <TableHead>上游</TableHead>
                <TableHead>通常（P50）</TableHead>
                <TableHead>最糟（P95）</TableHead>
                <TableHead>样本</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.latency_by_provider.map((l) => (
                <TableRow key={l.model}>
                  <TableCell>{l.model}</TableCell>
                  <TableCell>{l.p50}ms</TableCell>
                  <TableCell>{l.p95}ms</TableCell>
                  <TableCell className={l.samples < 10 ? "text-amber-600 dark:text-amber-400" : ""}>
                    {l.samples}
                    {l.samples < 10 && " · 数据不足"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/*
        钱成本构成。**横条不是饼图** —— 饼图比不出 12% 和 15%，而这张图
        的用途恰恰是排序和比例。
      */}
      {(d.by_model ?? []).length > 0 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="tw-title font-semibold">成本构成</h2>
            <span className="tw-body text-neutral-400">最近 24 小时</span>
          </div>
          <div className="mt-2 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-1.5 tw-head font-medium text-muted-foreground">按模型</h3>
              <BarRows
                unit={usd}
                rows={(d.by_model ?? []).slice(0, 6).map((g) => ({
                  name: g.name,
                  value: g.cost_micros,
                  // **算不出价钱的要说出来。**不说的话这根条是偏短的，
                  // 而看图的人没有线索知道少算了什么
                  note: g.unpriced_requests
                    ? `${g.unpriced_requests} 条无价`
                    : undefined,
                }))}
              />
            </div>
            {/* 一家上游的时候这张图说的是「全都在这儿」，那已经知道了 */}
            {(d.by_provider ?? []).length > 1 && (
              <div>
                <h3 className="mb-1.5 tw-head font-medium text-muted-foreground">按上游</h3>
                <BarRows
                  unit={usd}
                  rows={(d.by_provider ?? []).slice(0, 6).map((g) => ({
                    name: g.name,
                    value: g.cost_micros,
                    note: g.unpriced_requests
                      ? `${g.unpriced_requests} 条无价`
                      : undefined,
                  }))}
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* 延迟排行只在有得比的时候才有意义 —— 一家上游一个模型的时候，
          这张表说的是「它就是这么快」，那已经写在上面了 */}
      {d.latency.length > 1 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="tw-title font-semibold">延迟</h2>
            {/* 用分位数不用平均值：AI 延迟是长尾分布，平均值会被极端值
                拉偏 */}
            <span className="tw-body text-neutral-400">首字节，按模型分</span>
          </div>
          <Table className="mt-2 tw-num">
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead>通常（P50）</TableHead>
                <TableHead>最糟（P95）</TableHead>
                <TableHead>样本</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.latency.map((l) => (
                <TableRow key={l.model}>
                  <TableCell>{l.model}</TableCell>
                  <TableCell>{l.p50}ms</TableCell>
                  <TableCell>{l.p95}ms</TableCell>
                  {/* **样本数要显示。**「800ms」是 3 个样本还是 300 个，
                      含义完全不同 —— 少了它这张表就是在假装确定 */}
                  <TableCell className={l.samples < 10 ? "text-amber-600 dark:text-amber-400" : ""}>
                    {l.samples}
                    {l.samples < 10 && " · 数据不足"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
