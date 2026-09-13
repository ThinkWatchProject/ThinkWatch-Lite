import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usd, type SpeedQuote, type SpeedResult } from "./types";

/**
 * L3 模型测速。**这一层会花钱**（§4.6）。
 *
 * 所以它是三步而不是一步：填模型 → **看报价** → 点确认。中间那一步
 * 不能省 —— 触发前必须显示预估消耗，而不是点了才知道。
 */
export default function SpeedTest({ models }: { models: string[] }) {
  const [model, setModel] = useState(models[0] ?? "claude-sonnet-4-5");
  const [quote, setQuote] = useState<SpeedQuote | null>(null);
  const [results, setResults] = useState<SpeedResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      setQuote(await invoke<SpeedQuote>("speed_quote", { model }));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResults(await invoke<SpeedResult[]>("speed_run", { model }));
      setQuote(null);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="flex items-baseline gap-3">
        <h2 className="tw-title font-semibold">模型测速</h2>
        {/* **说清这一下花钱。**L1 那一栏写的是「不花钱」，两句话必须
            一样醒目，否则用户会以为所有测速都一样 */}
        <span className="tw-body text-amber-700 dark:text-amber-400">
          会真的调用模型，花钱
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="claude-sonnet-4-5"
          list="tw-models"
          className="w-72 rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono tw-body dark:border-neutral-700"
        />
        <datalist id="tw-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button
          onClick={ask}
          disabled={busy || !model.trim()}
          className="rounded-md border border-neutral-300 px-2 py-1 tw-body disabled:opacity-40 dark:border-neutral-700"
        >
          {busy && !quote ? "算账中…" : "看看要花多少"}
        </button>
      </div>

      {/* **报价。**这一步不能省（§4.6） */}
      {quote && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 tw-body dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            即将测速 · {model}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-amber-800 dark:text-amber-300">
            {quote.items.map((i) => (
              <li key={i.provider}>
                {i.provider} · 输入 {i.input_tokens} / 输出最多 {i.max_output_tokens} token ·{" "}
                {i.note}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-amber-900 dark:text-amber-200">
            {/* **有一项算不出来就不给总计。**给一个看起来完整的数字，
                用户会以为那就是全部代价 */}
            合计{" "}
            {quote.total_micros != null ? (
              <span className="font-medium">{usd(quote.total_micros)}</span>
            ) : (
              <span>算不出来 —— 有上游的模型不在价目表里</span>
            )}
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              · 按 {quote.pricing_date} 的价目表
            </span>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={run}
              disabled={busy}
              className="rounded bg-amber-600 px-2 py-1 text-white disabled:opacity-40"
            >
              {busy ? "测速中…" : "确认，开始测速"}
            </button>
            <button
              onClick={() => setQuote(null)}
              className="rounded border border-amber-400 px-2 py-1 text-amber-900 dark:border-amber-700 dark:text-amber-200"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {results && (
        <table className="mt-3 w-full text-left tw-body tw-num">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-2 font-medium">上游</th>
              <th className="font-medium">建连</th>
              {/* TTFT 才是这一层唯一值得测的东西 */}
              <th className="font-medium">首 token</th>
              <th className="font-medium">总计</th>
              <th className="font-medium">实际消耗</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.provider} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5">{r.provider}</td>
                {r.error ? (
                  <td colSpan={4} className="text-red-600 dark:text-red-400">
                    {r.error}
                  </td>
                ) : (
                  <>
                    <td>{r.connect_ms}ms</td>
                    <td className="font-medium">
                      {r.ttft_ms != null ? `${r.ttft_ms}ms` : "—"}
                    </td>
                    <td>{r.total_ms}ms</td>
                    {/* **实际消耗和预估对照。**有些上游会附加 system
                        prompt，那时实际比预估多（§4.6） */}
                    <td className="text-neutral-500">
                      {r.input_tokens != null
                        ? `${r.input_tokens} / ${r.output_tokens ?? 0}`
                        : "上游没报"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
