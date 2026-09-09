import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usd, type Dashboard as Data } from "./types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 text-xl tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-400">{hint}</div>}
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
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      </div>
    );
  }
  if (!d) return <p className="p-5 text-xs text-neutral-500">读取中…</p>;

  const s = d.summary;
  const hasEstimate = s.cost_micros_estimated > 0;
  const nothingYet = s.requests === 0 && s.locally_answered === 0;

  return (
    <div className="space-y-8 p-5">
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">今天</h2>
          <span className="text-xs text-neutral-400">从本地零点算起</span>
        </div>

        {nothingYet ? (
          // 空状态永远在回答「接下来该做什么」（§7.13）
          <p className="mt-3 rounded-lg border border-dashed border-neutral-300 p-6 text-center text-xs text-neutral-500 dark:border-neutral-700">
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
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                另有 {s.unpriced_requests} 条请求算不出价钱 —— 它们的模型不在价目表里（中转站
                自己起的名字通常是这样）。想让它们也算进来的话，在 pricing.yaml 里写上单价。
              </p>
            )}

            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
              <dt className="text-neutral-500">输入 / 输出</dt>
              <dd className="tabular-nums">
                {s.input_tokens.toLocaleString()} / {s.output_tokens.toLocaleString()} token
              </dd>
              <dt className="text-neutral-500">缓存 读 / 写</dt>
              <dd className="tabular-nums">
                {s.cache_read_tokens.toLocaleString()} / {s.cache_write_tokens.toLocaleString()}{" "}
                token
              </dd>
            </dl>
          </>
        )}
      </section>

      {d.latency.length > 0 && (
        <section>
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-semibold">延迟</h2>
            {/* 用分位数不用平均值：AI 延迟是长尾分布，平均值会被极端值
                拉偏（§4.6） */}
            <span className="text-xs text-neutral-400">首字节，按模型分</span>
          </div>
          <table className="mt-2 w-full text-left text-xs tabular-nums">
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
          <h2 className="text-sm font-semibold">历史</h2>
          <table className="mt-2 w-full text-left text-xs tabular-nums">
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
                <tr key={r.id} className="border-b border-neutral-100 dark:border-neutral-900">
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
                    {r.cost_micros == null ? (
                      // **「没有价格」不是 $0.00。**显示成 0 会让它悄悄
                      // 混进总额的心理预期里（§4.3）
                      <span className="text-neutral-400" title="这个模型不在价目表里">
                        —
                      </span>
                    ) : r.cost_estimated ? (
                      <span className="text-amber-700 dark:text-amber-400" title="估算值">
                        ~{usd(r.cost_micros)}
                      </span>
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

      {/* 存储状态。**正常时不显示** —— §0.6：没问题的时候不该占地方 */}
      {d.storage && d.storage.level !== "正常" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {d.storage.level}
          {!d.storage.forwarding_affected && " —— 转发不受影响。"}
        </p>
      )}
    </div>
  );
}
