import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRequests } from "./useRequests";
import type { CoreStatus } from "./types";

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
  const rows = useRequests();
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [core, setCore] = useState("stopped");
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  const c = describeCore(core);

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
        <span className="ml-auto text-xs text-neutral-500">
          {status ? `${status.providers} 个上游 · ${status.clients} 个客户端` : ""}
        </span>
      </header>

      {error && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

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
      </main>
    </div>
  );
}
