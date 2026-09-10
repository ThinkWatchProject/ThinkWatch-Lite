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
  const { rows, locallyAnswered, rejected, configVersion, alerts, rotated, clearRotated, clearAlerts } =
    useRequests();
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
              {/* 配置面上出现了新东西 —— 挂个角标，直到他去看过（§5.3） */}
              {t === "security" && alerts.length > 0 && (
                <span className="ml-1 rounded-full bg-red-600 px-1 text-[10px] text-white">
                  {alerts.length}
                </span>
              )}
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

      {/*
        token 端点换发了新的 refresh token（§3.6）。

        **现在一切正常，这正是要现在说的理由**：本进程内已经用上新的了，
        症状要等到下一次重启才出现，而那时没人会想到是几天前的一次轮换。

        第一句先说「现在没事」，因为不说的话这条提示看起来像故障；第二句
        才说要做什么。可以关掉 —— 用户改完配置之后它不该还挂在那儿。
      */}
      {rotated.length > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-2.5 text-xs dark:border-amber-800 dark:bg-amber-950">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {rotated.map((r) => r.provider).join("、")} 的 token
                端点换发了新的凭据，当前转发正常。
              </p>
              <p className="mt-1 text-amber-800 dark:text-amber-300">
                但 config.yaml 里那个 refresh token 已经作废了 ——
                <span className="font-medium">重启之前要把它更新掉</span>
                ，否则重启之后这家会一直 401。会反复换发的服务器建议改用{" "}
                <code className="rounded bg-amber-100 px-1 py-0.5 font-mono dark:bg-amber-900/40">
                  key: {"{ exec: [...] }"}
                </code>
                ，让你自己的命令去管这件事。
              </p>
            </div>
            <button
              onClick={clearRotated}
              className="shrink-0 rounded border border-amber-300 px-2 py-1 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              改好了
            </button>
          </div>
        </div>
      )}

      {tab === "sessions" ? (
        <Sessions />
      ) : tab === "dashboard" ? (
        <Dashboard tick={dashTick} />
      ) : tab === "clients" ? (
        <Clients />
      ) : tab === "security" ? (
        <Security alerts={alerts} onSeen={clearAlerts} />
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
                  <td>
                    {r.provider}
                    {/* **看不见的安全功能会被用户关掉**，因为他们会怀疑
                        是脱敏搞坏了功能（§5.1）。所以脱敏发生了就要在
                        列表这一层看得见，而不是藏在详情里 */}
                    {r.redacted && r.redacted.length > 0 && (
                      <span
                        className="ml-1 rounded bg-neutral-200 px-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                        title={
                          "发出去之前换掉了：" +
                          r.redacted.map((x) => `${x.what} ×${x.count}`).join("、") +
                          "\n模型回显时会自动换回来。"
                        }
                      >
                        已脱敏 {r.redacted.reduce((a, x) => a + x.count, 0)}
                      </span>
                    )}
                    {/* 方言互转（§4.1.2）。**转了就要看得见，丢了字段
                        更要看得见** —— 「扩展思考开了却没生效」这个症状
                        在客户端那头完全无从下手，只有这里知道原因 */}
                    {r.translated && (
                      <span
                        className={
                          "ml-1 rounded px-1 text-[10px] " +
                          (r.translated.dropped.length > 0
                            ? "bg-amber-500 text-white"
                            : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300")
                        }
                        title={
                          `请求从 ${r.translated.from} 方言转成了 ${r.translated.to} 再发出去。` +
                          (r.translated.dropped.length > 0
                            ? `\n\n目标方言里没有对应物、只能丢掉的字段：${r.translated.dropped.join("、")}`
                            : "\n没有字段被丢掉。")
                        }
                      >
                        {r.translated.dropped.length > 0
                          ? `已转换 · 丢了 ${r.translated.dropped.length} 项`
                          : "已转换"}
                      </span>
                    )}
                    {r.flagged?.some((f) => f.high) && (
                      <span
                        className={
                          "ml-1 rounded px-1 text-[10px] " +
                          (r.flagged.some((f) => f.blocked)
                            ? "bg-red-600 text-white"
                            : "bg-amber-500 text-white")
                        }
                        title={r.flagged
                          .filter((f) => f.high)
                          .map((f) => `${f.tool}：${f.why}\n${f.excerpt}`)
                          .join("\n\n")}
                      >
                        {r.flagged.some((f) => f.blocked) ? "已拦截" : "可疑调用"}
                      </span>
                    )}
                  </td>
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
