import { useCallback, useEffect, useState } from "react";
import { Tip } from "./ui/Tooltip";
import { invoke } from "@tauri-apps/api/core";
import { usd, type SessionDetail, type SessionView, type TurnView } from "./types";

/**
 * 会话页（DESIGN.md §7.9）。
 *
 * **孤立地看单个请求，看不出任何有用的东西。**Claude Code 的一次任务是
 * 几十到上百个请求，携带不断增长的上下文。这一页要能回答的是
 * 「我那次重构花了多少、为什么」，而不是「第 47 个请求耗时多少毫秒」。
 *
 * 成本仍然是三态的（§4.3）：没有价格的轮次单独报数，**不当成 0 加进
 * 总额**。一个会撒谎的成本面板不如没有。
 */
export default function Sessions() {
  const [rows, setRows] = useState<SessionView[] | null>(null);
  const [open, setOpen] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await invoke<SessionView[]>("sessions"));
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      setError(typeof e === "string" ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!rows) return <div className="p-5 tw-head text-neutral-500">{error ?? "读取中…"}</div>;

  if (rows.length === 0) {
    // 空状态永远在回答「接下来该做什么」（§7.13）
    return (
      <div className="p-5">
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <p className="tw-head text-neutral-600 dark:text-neutral-400">还没有会话。</p>
          <p className="mt-2 tw-body text-neutral-500">
            按「同一段对话」把请求聚起来。正常用一阵子之后会出现在这里。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5">
      {error && <div className="mb-3 tw-body text-amber-600 dark:text-amber-400">{error}</div>}
      <table className="w-full tw-body">
        <thead className="text-neutral-500">
          <tr>
            <th className="px-2 py-1 text-left font-normal">开始</th>
            <th className="px-2 py-1 text-left font-normal">客户端</th>
            <th className="px-2 py-1 text-right font-normal">轮次</th>
            <th className="px-2 py-1 text-right font-normal">时长</th>
            <th className="px-2 py-1 text-right font-normal">上下文峰值</th>
            <th className="px-2 py-1 text-right font-normal">缓存省下</th>
            <th className="px-2 py-1 text-right font-normal">花费</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={s.id}
              className="cursor-pointer border-t border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
              onClick={async () => {
                try {
                  setOpen(await invoke<SessionDetail>("session_detail", { id: s.id }));
                } catch (e) {
                  setError(typeof e === "string" ? e : String(e));
                }
              }}
            >
              <td className="px-2 py-1">{when(s.started_ms)}</td>
              <td className="px-2 py-1">{s.client}</td>
              <td className="px-2 py-1 text-right">
                {/* 轮次和失败数之间要有间隔 —— 挨着写会读成「181 失败」 */}
                <span>{s.turns}</span>
                {s.errors > 0 && (
                  <span className="ml-2 text-red-600 dark:text-red-400">{s.errors} 失败</span>
                )}
              </td>
              <td className="px-2 py-1 text-right">{dur(s.ended_ms - s.started_ms)}</td>
              <td className="px-2 py-1 text-right">{tokens(s.peak_input_tokens)}</td>
              <td className="px-2 py-1 text-right text-emerald-700 dark:text-emerald-400">
                {s.cache_saved_micros > 0 ? usd(s.cache_saved_micros) : "—"}
              </td>
              <td className="px-2 py-1 text-right">
                <Cost s={s} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && <Detail d={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * 一次会话的花费。
 *
 * **三态**（§4.3）：有价格的加起来，没价格的单独说，一轮都没有价格时
 * 不显示 $0 —— 那是在撒谎。
 */
function Cost({ s }: { s: SessionView }) {
  const priced = s.turns - s.unpriced_turns;
  if (priced === 0) {
    return <Tip text="这次会话里没有一轮拿到了价格"><span className="text-neutral-500">没有价格</span></Tip>;
  }
  return (
    <>
      {usd(s.cost_micros)}
      {s.unpriced_turns > 0 && (
        <Tip text="这几轮的模型不在价目表里，没有计入合计">
          <span className="ml-1 text-neutral-500">+{s.unpriced_turns} 轮无价</span>
        </Tip>
      )}
    </>
  );
}

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function dur(ms: number) {
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分`;
  return `${(ms / 3_600_000).toFixed(1)} 小时`;
}

function tokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

/** 一次会话的细节：上下文增长曲线 + 每轮的成本瀑布。 */
function Detail({ d, onClose }: { d: SessionDetail; onClose: () => void }) {
  const { session: s, turns } = d;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tw-head font-medium">
          {when(s.started_ms)} 的会话 · {s.turns} 轮 · {dur(s.ended_ms - s.started_ms)}
        </div>
        <div className="mt-1 tw-body text-neutral-500">
          {s.models.join("、")} · 输入 {tokens(s.input_tokens)} / 输出 {tokens(s.output_tokens)} ·
          缓存读 {tokens(s.cache_read_tokens)}
        </div>

        <Growth turns={turns} />
        <Waterfall turns={turns} />
      </div>
    </div>
  );
}

/**
 * 上下文增长曲线。**一眼看出哪次任务的上下文失控了**（§7.9）。
 *
 * 用条形而不是折线：轮次是离散的，而「第 12 轮突然翻倍」正是要找的
 * 那个东西 —— 折线会把那一跳平滑掉一部分。
 */
function Growth({ turns }: { turns: TurnView[] }) {
  const max = Math.max(1, ...turns.map((t) => t.input_tokens ?? 0));
  return (
    <section className="mt-4">
      <div className="tw-body text-neutral-500">上下文增长（每轮的输入 token）</div>
      <div className="mt-1 flex h-16 items-end gap-px">
        {turns.map((t) => {
          const v = t.input_tokens ?? 0;
          const cached = t.cache_read_tokens ?? 0;
          return (
            <div
              key={t.id}
              className="flex-1 bg-neutral-200 dark:bg-neutral-700"
              style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
              title={`${tokens(v)} token${cached > 0 ? `，其中 ${tokens(cached)} 是缓存命中` : ""}`}
            >
              {/* 缓存命中的那一段单独染色 —— 看出哪一轮打断了缓存 */}
              <div
                className="w-full bg-emerald-400 dark:bg-emerald-600"
                style={{ height: `${v > 0 ? (cached / v) * 100 : 0}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 tw-label text-neutral-400">
        绿色是缓存命中的部分。峰值 {tokens(max)} token。
      </div>
    </section>
  );
}

/** 每轮的成本瀑布 —— 找出那个 8 万 token 的文件读取（§7.9）。 */
function Waterfall({ turns }: { turns: TurnView[] }) {
  const max = Math.max(1, ...turns.map((t) => t.cost_micros ?? 0));
  return (
    <section className="mt-4">
      <div className="tw-body text-neutral-500">每轮花费</div>
      <ul className="mt-1 space-y-0.5">
        {turns.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 tw-label">
            <span className="w-6 text-right text-neutral-400">{i + 1}</span>
            <span className="w-14 text-neutral-500">{t.model.replace(/^claude-/, "")}</span>
            <span className="h-2 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
              <span
                className="block h-2 rounded bg-neutral-400 dark:bg-neutral-500"
                style={{ width: `${((t.cost_micros ?? 0) / max) * 100}%` }}
              />
            </span>
            <span className="w-16 text-right">
              {/* **没有价格就说没有价格，不写 $0** */}
              {t.cost_micros == null ? (
                <span className="text-neutral-400">无价</span>
              ) : (
                usd(t.cost_micros)
              )}
            </span>
            {t.error && <span className="text-red-600 dark:text-red-400">失败</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
