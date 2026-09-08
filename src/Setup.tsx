import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModelList, ProbeResponse, SetupResponse } from "./types";

/**
 * 首次运行（DESIGN.md §7.6）。全程不该超过三分钟。
 *
 * 只问三样：名字、base_url、key —— 而名字还能从 URL 猜。协议不问，
 * 猜不出来也不问，因为对绝大多数中转站「按 Anthropic 转发」就是对的。
 * 这是 §0.6 那条纪律在引导流程上的样子：**能少问一个就少问一个**。
 */
export default function Setup({ onDone }: { onDone: (r: SetupResponse) => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 从 URL 猜一个名字。用户几乎不会想改它，但留着能改。
  const guessedName = (() => {
    try {
      const h = new URL(baseUrl).hostname;
      return h.replace(/^api\./, "").split(".")[0] || "upstream";
    } catch {
      return "upstream";
    }
  })();

  async function doProbe() {
    setBusy(true);
    setError(null);
    setProbe(null);
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      const r = await invoke<ProbeResponse>("probe_upstream", { baseUrl, key });
      setProbe(r);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doSetup() {
    setBusy(true);
    setError(null);
    try {
      const r = await invoke<SetupResponse>("setup_first_provider", {
        name: guessedName,
        baseUrl,
        key,
      });
      onDone(r);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canProbe = baseUrl.trim() !== "" && key.trim() !== "" && !busy;

  return (
    <div className="mx-auto max-w-lg px-6 py-12">
      <h1 className="text-lg font-semibold">加第一个上游</h1>
      <p className="mt-1 text-xs text-neutral-500">
        只要一个地址和一把密钥。其余都有默认值，之后想改随时能改。
      </p>

      <label className="mt-6 block">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">接口地址</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value.trim())}
          placeholder="https://api.anthropic.com"
          // macOS 会把首字母自动大写、自动更正 —— 那会毁掉一个 key 或
          // 一个 URL，而表现是「明明是对的却认证失败」（§9.7）。
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">密钥</span>
        <input
          value={key}
          // 粘贴时带前后空格是高频手滑，这里直接吃掉
          onChange={(e) => setKey(e.target.value.trim())}
          placeholder="sk-..."
          type="password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={doProbe}
          disabled={!canProbe}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy && !probe ? "测试中…" : "测试连接"}
        </button>
        <span className="text-xs text-neutral-500">不花钱，可以随便点</span>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {probe && !probe.ok && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {probe.error}
        </div>
      )}

      {probe?.ok && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950">
          <p className="font-medium text-emerald-800 dark:text-emerald-200">
            通了 · {probe.latency_ms}ms
          </p>
          <ModelNote list={probe.models} />
          <button
            onClick={doSetup}
            disabled={busy}
            className="mt-3 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
          >
            用它
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 模型清单的结果说人话。
 *
 * **三种"没有列表"要分开说**，因为它们该让用户做的事不一样：上游没这个
 * 接口 → 知道就行；我们没认出格式 → 这是我们的 bug，值得反馈；真的空
 * → 大概率账号有问题。塌成一句"这家不提供模型列表"会把后两种都说成
 * 第一种，而那在第二种情况下是**编的**。
 */
function ModelNote({ list }: { list: ModelList }) {
  const base = "mt-1 text-emerald-700 dark:text-emerald-300";
  switch (list.kind) {
    case "listed":
      return (
        <p className={base}>
          报出 {list.models.length} 个模型，比如 {list.models.slice(0, 3).join("、")}
        </p>
      );
    case "not_implemented":
      return (
        <p className={base}>
          这家没有模型列表接口（HTTP {list.status}）—— 很常见，转发不受影响。
          <br />
          代价是按模型筛选、模型清单这些功能对它用不了。
        </p>
      );
    case "unrecognized":
      // 这条要显眼，而且要说清楚是**我们**没认出来。用户看到它应该想到
      // "去提个 issue"，而不是"这家上游有问题"。
      return (
        <div className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">它返回了模型列表，但我们没认出格式。</p>
          <p className="mt-1">
            转发不受影响，但模型相关的功能对它用不了。
            <b>这是我们的解析缺口，不是这家上游的问题</b> —— 把下面这段贴给我们就能修。
          </p>
          <pre className="mt-1.5 overflow-x-auto rounded bg-amber-100 p-1.5 font-mono text-[10px] dark:bg-amber-900">
            {list.sample}
          </pre>
        </div>
      );
    case "empty":
      return (
        <p className={base}>
          它说自己一个模型都没有。转发能通，但这通常意味着账号还没开通权限。
        </p>
      );
  }
}
