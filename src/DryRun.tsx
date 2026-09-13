import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DryRunResult } from "./types";

/**
 * 路由试算（DESIGN.md §3.4）。
 *
 * 它回答的不是「会走到哪儿」，而是**「为什么没走我以为的那条」** ——
 * 后者才是用户真正在问的问题，所以每条没命中的规则也要列出来，并说清
 * 它卡在哪个条件上。
 *
 * **只算，不发任何请求**，也不改任何东西。
 */
export default function DryRun({ models }: { models: string[] }) {
  const [model, setModel] = useState(models[0] ?? "claude-sonnet-4-5");
  const [cache, setCache] = useState(false);
  const [tools, setTools] = useState(false);
  const [image, setImage] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [kTokens, setKTokens] = useState(8);
  const [r, setR] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setR(
        await invoke<DryRunResult>("dry_run", {
          req: {
            model,
            cache,
            tools,
            image,
            thinking,
            input_tokens: kTokens * 1000,
            dialect: "anthropic",
            stream: true,
            client: "",
            intent: "",
            tool_count: tools ? 5 : 0,
            max_tokens: null,
          },
        }),
      );
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="tw-title font-semibold">试算一条请求</h2>
      <p className="mt-1 tw-body text-neutral-500">
        假设现在来这样一个请求，看它会走到哪儿、为什么没走别的那条。只是算一下，不会发出去。
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 tw-body">
        <input
          className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="模型名"
          list="dryrun-models"
        />
        <datalist id="dryrun-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <label className="flex items-center gap-1">
          上下文
          <input
            type="number"
            className="w-16 rounded border border-neutral-300 px-1 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            value={kTokens}
            min={0}
            onChange={(e) => setKTokens(Number(e.target.value))}
          />
          k
        </label>
        {(
          [
            ["带缓存", cache, setCache],
            ["带工具", tools, setTools],
            ["带图片", image, setImage],
            ["扩展思考", thinking, setThinking],
          ] as const
        ).map(([label, v, set]) => (
          <label key={label} className="flex items-center gap-1">
            <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} />
            {label}
          </label>
        ))}
        <button
          className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? "算…" : "试算"}
        </button>
      </div>

      {error && <div className="mt-2 tw-body text-amber-600 dark:text-amber-400">{error}</div>}
      {r && <Result r={r} />}
    </section>
  );
}

function Result({ r }: { r: DryRunResult }) {
  return (
    <div className="mt-3 rounded-md border border-neutral-200 p-3 tw-body dark:border-neutral-800">
      {r.outcome === "deny" ? (
        <div>
          <span className="text-red-600 dark:text-red-400">会被拒绝</span> —— 规则「{r.rule}」：
          {r.reason}
        </div>
      ) : r.outcome === "no_match" ? (
        <div className="text-amber-600 dark:text-amber-400">{r.reason}</div>
      ) : (
        <div>
          命中「<span className="font-medium">{r.rule}</span>」
          {r.via_group && <> · 经过组「{r.via_group}」</>}
          <div className="mt-1">
            会依次试：
            {r.candidates.map((c, i) => (
              <span key={c}>
                {i > 0 && " → "}
                <span
                  className={
                    // **熔断是当下的事实，不是静态结论。**不说出来的话，
                    // 用户会拿着一个对的答案去查一个错的现象
                    r.circuit_open.includes(c) ? "text-amber-600 line-through dark:text-amber-400" : ""
                  }
                >
                  {c}
                </span>
              </span>
            ))}
            {r.circuit_open.length > 0 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                （划掉的现在正熔断着，这一刻会被跳过）
              </span>
            )}
          </div>
          {r.hurts_cache && (
            // 要直说 —— 它决定账单（§3.4）
            <div className="mt-1 text-amber-600 dark:text-amber-400">
              这个组是负载均衡，会让 prompt cache 不稳定。
            </div>
          )}
          {r.set.length > 0 && (
            <div className="mt-1">
              还会改写：
              {r.set.map((s) => (
                <div key={s} className="ml-2">
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* **「为什么没走我以为的那条」才是用户在问的问题。** */}
      <details className="mt-2">
        <summary className="cursor-pointer text-neutral-500">逐条看规则怎么判的</summary>
        <ul className="mt-1 space-y-0.5">
          {r.trace.map((t) => (
            <li key={t.name} className="flex gap-2">
              <span
                className={
                  t.verdict === "matched"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-neutral-400"
                }
              >
                {t.verdict === "matched" ? "✓" : t.verdict === "phase_two" ? "…" : "·"}
              </span>
              <span className="w-40 shrink-0">{t.name}</span>
              <span className="text-neutral-500">{t.why ?? "命中"}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
