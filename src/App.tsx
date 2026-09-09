import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRequests } from "./useRequests";
import Setup from "./Setup";
import Connect from "./Connect";
import Config from "./Config";
import Clients from "./Clients";
import Security from "./Security";
import Sessions from "./Sessions";
import Dashboard from "./Dashboard";
import type { CoreStatus, Overview, SetupResponse } from "./types";

/** core 的状态字符串来自 Rust 侧的 CoreState，见 supervisor/mod.rs。 */
function describeCore(raw: string): { text: string; tone: "ok" | "warn" | "bad" } {
  if (raw.startsWith("running:")) return { text: "运行中", tone: "ok" };
  if (raw === "starting") return { text: "启动中", tone: "warn" };
  if (raw.startsWith("restarting:")) {
    const [, attempt] = raw.split(":");
    return { text: `重启中（第 ${attempt} 次）`, tone: "warn" };
  }
  // 安全模式必须显眼：这时候网关不转发了，用户所有的 AI 客户端都在瞎。
  if (raw === "safe_mode") return { text: "安全模式 · 网关未运行", tone: "bad" };
  return { text: "已停止", tone: "bad" };
}

export default function App() {
  const { rows, locallyAnswered, rejected, configVersion } = useRequests();
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [core, setCore] = useState("stopped");
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [tab, setTab] = useState<"requests" | "sessions" | "dashboard" | "clients" | "security" | "config">("requests");
  /** Dashboard 每两秒跟着状态轮询一起刷。它查的是库，不是实时流 */
  const [dashTick, setDashTick] = useState(0);
  const [ov, setOv] = useState<Overview | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        // Tauri 的 invoke 用**字符串** reject，不是 Error（§9.7）——
        // `e instanceof Error` 永远是 false，所以按字符串处理。
        const s = await invoke<CoreStatus>("core_status");
        if (alive) {
          setStatus(s);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(typeof e === "string" ? e : String(e));
      }
      try {
        const o = await invoke<Overview>("overview");
        if (alive) setOv(o);
      } catch {
        /* 概览拿不到不该盖掉上面那条更有用的错误 */
      }
      if (alive) setDashTick((t) => t + 1);
      try {
        const c = await invoke<string>("core_state");
        if (alive) setCore(c);
      } catch {
        /* core_state 不该失败；失败了也不该盖掉上面那条更有用的错误 */
      }
    };
    tick();
    const h = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(h);
    };
    // configVersion 变了就立刻再拉一次 —— 不然用户在编辑器里改完，
    // 界面上最多要等两秒才跟上，而那两秒里他会以为没生效（§3.8）。
  }, [configVersion]);

  const c = describeCore(core);

  // 引导：还没有上游就走 §7.6 的五步。判据是 status.providers，不是一个
  // 单独的「引导完了没」标志 —— 那种标志会和真实状态漂移，然后出现
  // 「明明配好了却还在引导」或者反过来。
  if (status && status.providers === 0 && !setup) {
    return <Setup onDone={setSetup} />;
  }
  // 刚配完：等第一个请求。
  //
  // **收到之后不要立刻切走** —— 那一声「它真的在工作了」是整个引导的
  // 收尾，也是这类工具最难的一关（让用户相信流量真的经过我们了）。
  // 切换交给用户点，不要替他做。
  if (setup) {
    return (
      <Connect
          setup={setup}
          seen={rows.length > 0 || locallyAnswered > 0}
          onEnter={() => setSetup(null)}
        />
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header
        className="flex items-center gap-4 border-b border-neutral-200 px-5 py-3 dark:border-neutral-800"
        data-tauri-drag-region
      >
        <span className="pl-16 font-semibold">ThinkWatch Lite</span>
        <span
          className={
            "flex items-center gap-1.5 text-xs " +
            (c.tone === "ok"
              ? "text-emerald-600 dark:text-emerald-400"
              : c.tone === "warn"
                ? "text-amber-600 dark:text-amber-400"
                : "text-red-600 dark:text-red-400")
          }
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          {c.text}
        </span>
        {status?.gateway_addr && (
          <code className="text-xs text-neutral-500">{status.gateway_addr}</code>
        )}
        <nav className="ml-auto flex gap-1 text-xs">
          {(["requests", "sessions", "dashboard", "clients", "security", "config"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "rounded px-2 py-1 " +
                (tab === t
                  ? "bg-neutral-200 dark:bg-neutral-800"
                  : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")
              }
            >
              {t === "requests" ? "请求" : t === "sessions" ? "会话" : t === "dashboard" ? "统计" : t === "clients" ? "客户端" : t === "security" ? "安全" : "配置"}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      {/*
        配置没通过校验。**这条要一直挂着，直到下一次成功换入**（§3.8）——
        一闪而过的提示等于没提示：用户在编辑器里保存完，眼睛还在编辑器上。

        第一句先说「还在按旧配置转发」，因为那是他最想知道的：会不会断。
      */}
      {rejected && (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-2.5 text-xs dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            配置没能生效，还在按上一份转发。
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            {rejected.stage}错误
            {rejected.line != null && `（第 ${rejected.line} 行）`}：{rejected.message}
          </p>
          {rejected.excerpt && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-amber-100 px-2 py-1 font-mono text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {rejected.line}│ {rejected.excerpt}
            </pre>
          )}
        </div>
      )}

      {tab === "sessions" ? (
        <Sessions />
      ) : tab === "dashboard" ? (
        <Dashboard tick={dashTick} />
      ) : tab === "clients" ? (
        <Clients />
      ) : tab === "security" ? (
        <Security />
      ) : tab === "config" ? (
        ov ? (
          <Config ov={ov} configVersion={configVersion} />
        ) : (
          <p className="p-5 text-xs text-neutral-500">读取配置中…</p>
        )
      ) : (
      <main className="p-5">
        {rows.length === 0 ? (
          // 空状态永远在回答「接下来该做什么」（§7.13）。
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              还没有请求经过。
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              把客户端指到{" "}
              <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                http://{status?.gateway_addr ?? "127.0.0.1:8788"}
              </code>
              ，用配置里那把 tw- 开头的密钥。
              <br />
              第一个请求进来时，它会出现在这里。
            </p>
            {locallyAnswered > 0 && (
              // **这句话信息量很大**：客户端已经连上了，只是还没发过真实
              // 请求。没有它，用户会以为整条链路都不通（§4.8）。
              <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-300">
                已经本地应答了 {locallyAnswered} 次客户端探测 —— 客户端连上了，而这些探测一分钱没花。
              </p>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-2 font-medium">状态</th>
                <th className="font-medium">客户端</th>
                <th className="font-medium">上游</th>
                <th className="font-medium">路径</th>
                <th className="font-medium">首字节</th>
                <th className="font-medium">耗时</th>
                <th className="font-medium">字节</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="py-1.5">
                    {r.state === "in_flight" ? (
                      <span className="text-amber-600 dark:text-amber-400">进行中</span>
                    ) : r.state === "failed" ? (
                      <span className="text-red-600 dark:text-red-400" title={r.error}>
                        失败
                      </span>
                    ) : (
                      <span className="text-neutral-500">{r.status}</span>
                    )}
                  </td>
                  <td>{r.client}</td>
                  <td>{r.provider}</td>
                  <td className="text-neutral-500">{r.path}</td>
                  <td>{r.ttfbMs != null ? `${r.ttfbMs}ms` : "—"}</td>
                  <td>{r.durationMs != null ? `${r.durationMs}ms` : "—"}</td>
                  <td>{r.bytes != null ? r.bytes : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {locallyAnswered > 0 && rows.length > 0 && (
          <p className="mt-3 text-xs text-neutral-500">
            另有 {locallyAnswered} 次客户端探测被本地应答，没有发给任何上游。
          </p>
        )}
      </main>
      )}
    </div>
  );
}
