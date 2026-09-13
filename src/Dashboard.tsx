import { useEffect, useState } from "react";
import { Tip } from "./ui/Tooltip";
import { invoke } from "@tauri-apps/api/core";
import RequestDrawer from "./RequestDrawer";
import Sparkline from "./Sparkline";
import { triggers } from "./triggers";
import { usd, type Dashboard as Data } from "./types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="tw-body text-neutral-500">{label}</div>
      <div className="mt-0.5 text-xl tw-num">{value}</div>
      {hint && <div className="mt-0.5 tw-body text-neutral-400">{hint}</div>}
    </div>
  );
}

/**
 * 今天的账。
 *
 * 这一页的每一个数字都受 §4.3 那条约束：**绝不让估算值混进精确数字里
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
        // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
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
  if (!d) return <p className="p-5 tw-body text-neutral-500">读取中…</p>;

  const s = d.summary;
  const t = triggers(null, d);
  const hasEstimate = s.cost_micros_estimated > 0;
  // §0.6：条件不满足就**不出现**，不是折叠。一个还没有任何数据的成本
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
          // 空状态永远在回答「接下来该做什么」（§7.13）
          <p className="mt-3 rounded-lg border border-dashed border-neutral-300 p-6 text-center tw-body text-neutral-500 dark:border-neutral-700">
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
                  把一个不确定的东西说成确定的（§4.3） */}
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
                显示 token 量（§4.3.1）。
              */}
              {s.subscription_requests > 0 && (
                <Stat
                  label="订阅调用"
                  value={`${s.subscription_requests}`}
                  hint={`${s.subscription_tokens.toLocaleString()} token · 不计入金额`}
                />
              )}
              {/*
                缓存省了多少（§4.4）。**算的是差额** —— 「如果这些 token
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
                的，而用户没有任何线索知道少算了什么（§4.3） */}
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
            <div className="mt-4">
              <Sparkline rows={d.history} now={Date.now()} />
            </div>

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 tw-body">
              <dt className="text-neutral-500">输入 / 输出</dt>
              <dd className="tw-num">
                {s.input_tokens.toLocaleString()} / {s.output_tokens.toLocaleString()} token
              </dd>
              <dt className="text-neutral-500">缓存 读 / 写</dt>
              <dd className="tw-num">
                {s.cache_read_tokens.toLocaleString()} / {s.cache_write_tokens.toLocaleString()}{" "}
                token
              </dd>
            </dl>
          </>
        )}
      </section>

      {/*
        出站密钥检测攒下的证据（§5.0）。**只在真的发现过东西时出现** ——
        没发现的时候显示一句「一切正常」是在占地方（§0.6），而这一块的
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
                  // 把泄漏搬了个家（§9.7）
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
        「哪家上游慢」的下一步是换上游 —— 合成一张表两个都答不好（§4.6）。
        只有一家上游时不显示：那时这张表说的是「它就是这么快」。
      */}
      {t.comparison && d.latency_by_provider.length > 1 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="tw-title font-semibold">哪家更快</h2>
            <span className="tw-body text-neutral-400">首字节，按上游分</span>
          </div>
          <table className="mt-2 w-full text-left tw-body tw-num">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-2 font-medium">上游</th>
                <th className="font-medium">通常（P50）</th>
                <th className="font-medium">最糟（P95）</th>
                <th className="font-medium">样本</th>
              </tr>
            </thead>
            <tbody>
              {d.latency_by_provider.map((l) => (
                <tr key={l.model} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-1.5">{l.model}</td>
                  <td>{l.p50}ms</td>
                  <td>{l.p95}ms</td>
                  <td className={l.samples < 10 ? "text-amber-600 dark:text-amber-400" : ""}>
                    {l.samples}
                    {l.samples < 10 && " · 数据不足"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* 延迟排行只在有得比的时候才有意义 —— 一家上游一个模型的时候，
          这张表说的是「它就是这么快」，那已经写在上面了 */}
      {d.latency.length > 1 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="tw-title font-semibold">延迟</h2>
            {/* 用分位数不用平均值：AI 延迟是长尾分布，平均值会被极端值
                拉偏（§4.6） */}
            <span className="tw-body text-neutral-400">首字节，按模型分</span>
          </div>
          <table className="mt-2 w-full text-left tw-body tw-num">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-2 font-medium">模型</th>
                <th className="font-medium">通常（P50）</th>
                <th className="font-medium">最糟（P95）</th>
                <th className="font-medium">样本</th>
              </tr>
            </thead>
            <tbody>
              {d.latency.map((l) => (
                <tr key={l.model} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-1.5">{l.model}</td>
                  <td>{l.p50}ms</td>
                  <td>{l.p95}ms</td>
                  {/* **样本数要显示。**「800ms」是 3 个样本还是 300 个，
                      含义完全不同 —— 少了它这张表就是在假装确定 */}
                  <td className={l.samples < 10 ? "text-amber-600 dark:text-amber-400" : ""}>
                    {l.samples}
                    {l.samples < 10 && " · 数据不足"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {d.history.length > 0 && (
        <section>
          <h2 className="tw-title font-semibold">历史</h2>
          <table className="mt-2 w-full text-left tw-body tw-num">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-2 font-medium">时间</th>
                <th className="font-medium">模型</th>
                <th className="font-medium">上游</th>
                <th className="font-medium">状态</th>
                <th className="font-medium">首字节</th>
                <th className="font-medium">token</th>
                <th className="font-medium">花费</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setOpen(r.id)}
                  className="cursor-pointer border-b border-neutral-100 hover:bg-neutral-100 dark:border-neutral-900 dark:hover:bg-neutral-900"
                >
                  <td className="py-1.5 text-neutral-500">
                    {new Date(r.at_ms).toLocaleTimeString()}
                  </td>
                  <td>{r.local ? <span className="text-neutral-400">{r.path}</span> : r.model}</td>
                  <td className="text-neutral-500">{r.local ? "本地应答" : r.provider}</td>
                  <td>
                    {r.error ? (
                      <span className="text-red-600 dark:text-red-400" title={r.error}>
                        失败
                      </span>
                    ) : (
                      <span className="text-neutral-500">{r.status}</span>
                    )}
                  </td>
                  <td>{r.ttfb_ms != null ? `${r.ttfb_ms}ms` : "—"}</td>
                  <td className="text-neutral-500">
                    {r.input_tokens != null
                      ? `${r.input_tokens.toLocaleString()} / ${(r.output_tokens ?? 0).toLocaleString()}`
                      : "—"}
                  </td>
                  <td>
                    {r.billing === "subscription" ? (
                      // **「订阅」而不是 $0.00。**后者看起来像一个算出来
                      // 的结果，会让人误以为这次调用真的免费；「订阅」
                      // 表达的是「这笔账不在这个维度上」（§4.3.1）
                      <Tip text="这家是订阅制，边际成本为零">
                        <span className="text-neutral-500">订阅</span>
                      </Tip>
                    ) : r.cost_micros == null ? (
                      // **「没有价格」不是 $0.00。**显示成 0 会让它悄悄
                      // 混进总额的心理预期里（§4.3）
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}

      {/* 存储状态。**正常时不显示** —— §0.6：没问题的时候不该占地方 */}
      {d.storage && d.storage.level !== "正常" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {d.storage.level}
          {!d.storage.forwarding_affected && " —— 转发不受影响。"}
        </p>
      )}
    </div>
  );
}
