import { useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import RequestDrawer from "./RequestDrawer";
import { triggers } from "./triggers";
import { BarChart, BarRows } from "./ui/Chart";
import { densify } from "./format";
import { usd, type Dashboard as Data } from "./types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="tw-body text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl tw-num">{value}</div>
      {hint && <div className="mt-0.5 tw-body text-neutral-400">{hint}</div>}
    </div>
  );
}

/**
 * 今天的账。
 *
 * 这一页的每一个数字都受那条约束：**绝不让估算值混进精确数字里
 * 假装准确。**所以成本是三个数并排，不是一个。
 */
export default function Dashboard({ tick }: { tick: number }) {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 点开的那一条。**抽屉是右侧覆盖的，不是跳页** —— 用户要能一边看
      详情一边对着列表里的别的行 */
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const x = await invoke<Data>("dashboard");
        if (alive) {
          setD(x);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(typeof e === "string" ? e : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  if (error) {
    return (
      <div className="p-5">
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
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
        <div className="flex items-baseline gap-3">
          <h2 className="tw-title font-semibold">今天</h2>
          <span className="tw-body text-neutral-400">从本地零点算起</span>
        </div>

        {nothingYet ? (
          // 空状态永远在回答「接下来该做什么」
          <p className="mt-3 rounded-lg border border-dashed border-input p-6 text-center tw-body text-neutral-500">
            今天还没有请求。把客户端指过来，数字会出现在这里。
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat
                label="花费"
                value={usd(s.cost_micros_exact)}
                hint={`按 ${s.pricing_date} 的价目表`}
              />
              {/* **估算值单独一格，带波浪号。**混进上面那个数里就是在
                  把一个不确定的东西说成确定的 */}
              {hasEstimate && (
                <Stat
                  label="其中估算"
                  value={`~${usd(s.cost_micros_estimated)}`}
                  hint="上游没给用量，或者价格来自别的平台"
                />
              )}
              <Stat
                label="请求"
                value={`${s.requests}`}
                hint={s.failed > 0 ? `${s.failed} 条失败` : undefined}
              />
              {/*
                **第三栏：订阅调用量。**订阅制的边际成本是零，按 API 价目表
                算出来的数字是纯虚构的 —— 所以它不进上面那个金额，而是单独
                显示 token 量。
              */}
              {s.subscription_requests > 0 && (
                <Stat
                  label="订阅调用"
                  value={`${s.subscription_requests}`}
                  hint={`${s.subscription_tokens.toLocaleString()} token · 不计入金额`}
                />
              )}
              {/*
                缓存省了多少。**算的是差额** —— 「如果这些 token
                没命中缓存，要多花多少」。对 Claude Code 用户，这通常是
                成本结构里最大的一块。
              */}
              {s.cache_saved_micros > 0 && (
                <Stat
                  label="缓存省下"
                  value={usd(s.cache_saved_micros)}
                  hint="命中缓存少花的钱"
                />
              )}
              {s.locally_answered > 0 && (
                <Stat
                  label="本地应答"
                  value={`${s.locally_answered}`}
                  hint="客户端探测，没发给上游"
                />
              )}
            </div>

            {/* **没有价格的那些要说出来。**不说的话，上面那个花费是偏低
                的，而用户没有任何线索知道少算了什么 */}
            {s.unpriced_requests > 0 && (
              <p className="mt-3 tw-body text-amber-700 dark:text-amber-400">
                <Tip text="这些请求用的模型不在价目表里 —— 上游自定义的模型名通常如此。在「配置 › 自定义价格」里给它填一个单价，它们就会计入合计。">
                  <span className="underline decoration-dotted underline-offset-2">
                    {s.unpriced_requests} 条请求算不出价钱
                  </span>
                </Tip>
              </p>
            )}

            {/*
              最近一段时间的请求量。**画的是节奏，不是金额** —— 金额已经
              在上面那几个数字里了，而「刚才发生了什么」是另一个问题。
            */}
            {/*
              最近 24 小时的花费趋势。**画的是钱，不是请求数** ——
              这是一个 ToC 的工具，用户打开它第一个想知道的是花了多少。
              请求数叠在同一根柱子上（淡色），因为「花得多」和「用得多」
              不总是一回事，而分成两张图会让人来回对照。
            */}
            <div className="mt-5">
              <div className="flex items-baseline gap-2">
                <h3 className="tw-head font-medium">最近 24 小时</h3>
                <span className="tw-label text-neutral-400">每格一小时</span>
              </div>
              <div className="mt-1.5">
                <BarChart
                  height={52}
                  barClass="fill-neutral-400 dark:fill-neutral-600"
                  subClass="fill-red-500/70"
                  empty="最近 24 小时没有请求。"
                  bars={densify(d.buckets ?? [], d.since_ms ?? 0, Date.now(), 3_600_000).map(
                    (b) => ({
                      at: b.at_ms,
                      // 主高度是花费，失败那部分单独叠一层 —— 一段红比
                      // 一个「失败 3 条」的数字更容易在余光里被发现
                      value: (b.cost_micros_exact + b.cost_micros_estimated) / 1000,
                      sub: b.failed > 0 ? 1 : 0,
                      label: `${new Date(b.at_ms).getHours()}:00　${usd(
                        b.cost_micros_exact + b.cost_micros_estimated,
                      )}　${b.requests} 条${b.failed ? `（${b.failed} 条失败）` : ""}${
                        b.unpriced_requests
                          ? `\n其中 ${b.unpriced_requests} 条算不出价钱，没有计入`
                          : ""
                      }`,
                    }),
                  )}
                />
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 tw-body">
              <dt className="text-muted-foreground">输入 / 输出</dt>
              <dd className="tw-num">
                {s.input_tokens.toLocaleString()} / {s.output_tokens.toLocaleString()} token
              </dd>
              <dt className="text-muted-foreground">缓存 读 / 写</dt>
              <dd className="tw-num">
                {s.cache_read_tokens.toLocaleString()} / {s.cache_write_tokens.toLocaleString()}{" "}
                token
              </dd>
            </dl>
          </>
        )}
      </section>

      {/*
        出站密钥检测攒下的证据。**只在真的发现过东西时出现** ——
        没发现的时候显示一句「一切正常」是在占地方，而这一块的
        全部说服力来自「它说的是已经发生在你身上的事」。
      */}
      {d.leaks.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="tw-title font-semibold text-amber-900 dark:text-amber-200">
            过去 7 天，有请求把密钥发了出去
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
            <h2 className="tw-title font-semibold">哪家更快</h2>
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
        钱花在哪儿。**横条不是饼图** —— 饼图比不出 12% 和 15%，而这张图
        的用途恰恰是排序和比例。
      */}
      {(d.by_model ?? []).length > 0 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="tw-title font-semibold">花在哪儿</h2>
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

      {d.history.length > 0 && (
        <section>
          <h2 className="tw-title font-semibold">历史</h2>
          <Table className="mt-2 tw-num">
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>上游</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>首字节</TableHead>
                <TableHead>token</TableHead>
                <TableHead>花费</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.history.map((r) => (
                <TableRow
                  key={r.id}
                  onClick={() => setOpen(r.id)} className="cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  <TableCell className="text-muted-foreground">
                    {new Date(r.at_ms).toLocaleTimeString()}
                  </TableCell>
                  <TableCell>{r.local ? <span className="text-neutral-400">{r.path}</span> : r.model}</TableCell>
                  <TableCell className="text-muted-foreground">{r.local ? "本地应答" : r.provider}</TableCell>
                  <TableCell>
                    {r.error ? (
                      <span className="text-red-600 dark:text-red-400" title={r.error}>
                        失败
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.status}</span>
                    )}
                  </TableCell>
                  <TableCell>{r.ttfb_ms != null ? `${r.ttfb_ms}ms` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.input_tokens != null
                      ? `${r.input_tokens.toLocaleString()} / ${(r.output_tokens ?? 0).toLocaleString()}`
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {r.billing === "subscription" ? (
                      // **「订阅」而不是 $0.00。**后者看起来像一个算出来
                      // 的结果，会让人误以为这次调用真的免费；「订阅」
                      // 表达的是「这笔账不在这个维度上」
                      <Tip text="这家是订阅制，边际成本为零">
                        <span className="text-muted-foreground">订阅</span>
                      </Tip>
                    ) : r.cost_micros == null ? (
                      // **「没有价格」不是 $0.00。**显示成 0 会让它悄悄
                      // 混进总额的心理预期里
                      <Tip text="这个模型不在价目表里">
                        <span className="text-neutral-400">—</span>
                      </Tip>
                    ) : r.cost_estimated ? (
                      <Tip text="估算值 —— 这个模型用的是兜底价，和实测有差">
                        <span className="text-amber-700 dark:text-amber-400">~{usd(r.cost_micros)}</span>
                      </Tip>
                    ) : (
                      usd(r.cost_micros)
                    )}
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
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {d.storage.level}
          {!d.storage.forwarding_affected && " —— 转发不受影响。"}
        </p>
      )}
    </div>
  );
}
