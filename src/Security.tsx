import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { McpView, ScanFinding, ScanResponse } from "./types";

/**
 * 客户端配置面（DESIGN.md §5.3、§7.12）。
 *
 * 两件事放在一页，因为**它们是同一件事的两面**：扫描要知道去哪儿找，
 * 而清单正是那份地址簿。
 *
 * 三条纪律写在界面上：
 *
 * - **只报告，不自动删除。**这一页没有任何删除按钮。误报删掉用户的
 *   正常配置比漏报还糟 —— 它会摧毁信任，然后用户关掉整个功能。
 * - **查干净了要说「没发现问题」**，而不是让这一块消失（§0.6）。
 * - **不存任何状态。**每次打开现扫一遍，你看到的永远是磁盘上此刻的
 *   真实情况；没有「同步失效了」这种问题，因为压根没有同步状态。
 */
export default function Security() {
  const [data, setData] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ScanFinding | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await invoke<ScanResponse>("scan_configs", { projects: [] }));
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <div className="p-5 text-sm text-neutral-500">{error ?? "扫描中…"}</div>;
  }

  const high = data.findings.filter((f) => f.level === "high").length;

  return (
    <div className="space-y-5 p-5">
      {error && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span>
          扫了 {data.scanned} 份文件，规则来自{data.rules_origin}。
        </span>
        <button
          className="rounded border border-neutral-300 px-2 py-0.5 dark:border-neutral-700"
          onClick={() => void load()}
          disabled={busy}
        >
          {busy ? "扫描中…" : "重扫"}
        </button>
      </div>

      {data.rules_warning && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {data.rules_warning}
        </div>
      )}

      {/* 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉 */}
      {data.unreadable.length > 0 && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          有 {data.unreadable.length} 份文件读不动，这次没扫到：{data.unreadable.join("、")}
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium">
          发现{data.findings.length > 0 && ` · ${data.findings.length} 处`}
          {high > 0 && <span className="ml-1 text-red-600 dark:text-red-400">（{high} 处高危）</span>}
        </h2>
        {data.findings.length === 0 ? (
          // §0.6：没风险的时候要说「安全」，而不是让这一块消失
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            ✓ 没发现问题。隐藏字符、提示注入、危险命令、过宽权限四类都查过了。
          </div>
        ) : (
          <ul className="space-y-1">
            {data.findings.map((f, i) => (
              <li key={i}>
                <button
                  className="flex w-full items-start gap-2 rounded border border-neutral-200 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
                  onClick={() => setOpen(f)}
                >
                  <span
                    className={
                      f.level === "high"
                        ? "text-red-600 dark:text-red-400"
                        : f.level === "medium"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-neutral-500"
                    }
                  >
                    {f.level === "high" ? "✗" : f.level === "medium" ? "?" : "·"}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium">{f.title}</span>
                    <span className="ml-2 text-neutral-500">
                      {f.path.replace(/^.*\//, "")}:{f.line}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Matrix mcp={data.mcp} conflicting={data.conflicting} />

      {data.hooks.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-medium">hook · {data.hooks.length}</h2>
          {/* 危险度第一：不需要模型参与就能拿到执行权 */}
          <p className="mb-2 text-xs text-neutral-500">
            hook 在工具调用前后直接执行 shell 命令 —— 这是唯一不需要模型参与就能拿到执行权的入口。
          </p>
          <ul className="space-y-1 text-xs">
            {data.hooks.map((h, i) => (
              <li key={i} className="rounded border border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
                <span className="text-neutral-500">{h.event}</span>{" "}
                <code className="break-all">{h.command}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.skills.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-medium">skill · {data.skills.length}</h2>
          {/* §7.12：skill 只看不搬 —— 跨客户端的格式还没有事实标准 */}
          <p className="mb-2 text-xs text-neutral-500">
            只列出来看，不做跨客户端搬动 —— skill 的跨客户端格式还没有事实标准。
          </p>
          <ul className="space-y-1 text-xs">
            {data.skills.map((s, i) => (
              <li key={i} className="rounded border border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-neutral-500">{s.client}</span>
                {s.allowed_tools.length > 0 && (
                  <span className="ml-2 text-neutral-500">工具：{s.allowed_tools.join("、")}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && <Detail f={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * MCP 矩阵（§7.12）。
 *
 * M4 的简化版**只看不搬**：格子告诉你谁配了什么，同名不同配置标个记号。
 * 点格子执行复制是 §7.12 里更完整的那一版，等这一版用顺了再说。
 */
function Matrix({ mcp, conflicting }: { mcp: McpView[]; conflicting: string[] }) {
  const clients = [...new Set(mcp.map((m) => m.client))].sort();
  const names = [...new Set(mcp.map((m) => m.name))].sort();
  if (names.length === 0) {
    return (
      <section>
        <h2 className="mb-1 text-sm font-medium">MCP server</h2>
        <p className="text-xs text-neutral-500">这台机器上没有配置任何 MCP server。</p>
      </section>
    );
  }
  const at = (name: string, client: string) => mcp.find((m) => m.name === name && m.client === client);

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium">MCP server · {names.length}</h2>
      <p className="mb-2 text-xs text-neutral-500">
        每一个都是一个能执行程序、或者能收走你上下文的入口。这里只展示，不做增删。
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr className="text-neutral-500">
              <th className="px-2 py-1 text-left font-normal">名字</th>
              {clients.map((c) => (
                <th key={c} className="px-2 py-1 text-left font-normal">
                  {c}
                </th>
              ))}
              <th className="px-2 py-1 text-left font-normal">是什么</th>
            </tr>
          </thead>
          <tbody>
            {names.map((n) => {
              const any = mcp.find((m) => m.name === n)!;
              return (
                <tr key={n} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="px-2 py-1">
                    {conflicting.includes(n) && (
                      <span className="mr-1 text-amber-600 dark:text-amber-400" title="同名，但各客户端里的配置不一样">
                        ⚠
                      </span>
                    )}
                    {n}
                  </td>
                  {clients.map((c) => {
                    const m = at(n, c);
                    return (
                      <td key={c} className="px-2 py-1 text-center">
                        {!m ? (
                          <span className="text-neutral-300 dark:text-neutral-700">·</span>
                        ) : m.enabled ? (
                          "✓"
                        ) : (
                          // 关掉的还在配置里，一次编辑就能打开
                          <span className="text-neutral-400" title="配置里写着 enabled: false">
                            ○
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-neutral-500">
                    {/* **同名不同配置时，不能只显示其中一份。**挑一个显示
                        等于替用户选了个「正确答案」，而这一行的记号说的
                        恰恰是「没有正确答案，它们不一样」（§7.12） */}
                    {conflicting.includes(n)
                      ? mcp
                          .filter((m) => m.name === n)
                          .map((m) => (
                            <div key={m.client}>
                              <span className="text-neutral-400">{m.client}：</span>
                              <Shape m={m} />
                            </div>
                          ))
                      : <Shape m={any} />}
                    {any.env_keys.length > 0 && (
                      <div className="text-neutral-400">读环境变量：{any.env_keys.join("、")}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 一个 MCP server 是什么形态。远端和本机的风险不是一回事。 */
function Shape({ m }: { m: McpView }) {
  if (m.url) {
    return (
      <>
        远端 <code>{m.url}</code>
        {m.third_party && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">上下文会发到那边</span>
        )}
      </>
    );
  }
  return (
    <code className="break-all">
      {m.command} {m.args.join(" ")}
    </code>
  );
}

/** 一处发现的详情。**没有删除按钮** —— 删不删由用户自己去改文件（§5.3）。 */
function Detail({ f, onClose }: { f: ScanFinding; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium">{f.title}</div>
        <div className="mt-2 space-y-2 text-xs text-neutral-600 dark:text-neutral-400">
          <div>{f.detail}</div>
          <div>
            <code>
              {f.path}:{f.line}
            </code>
          </div>
          {/* 不可见字符已经换成可见记号，否则这一行看起来和正常行一样，
              用户会以为我们在误报 */}
          <pre className="overflow-x-auto rounded bg-neutral-50 p-2 dark:bg-neutral-950">{f.excerpt}</pre>
          <div className="text-neutral-500">
            我们只报告，不会替你改任何文件。要处理的话，打开上面那个路径自己看一眼再决定。
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="rounded px-3 py-1 text-xs text-neutral-500" onClick={onClose}>
            关掉
          </button>
        </div>
      </div>
    </div>
  );
}
