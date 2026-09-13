import { useCallback, useEffect, useState } from "react";
import { Tip } from "./ui/Tooltip";
import { invoke } from "@tauri-apps/api/core";
import type {
  AdoptResponse,
  BaselineResponse,
  McpOpRequest,
  McpTargetView,
  McpView,
  PlanView,
  ScanFinding,
  ScanResponse,
} from "./types";

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
export default function Security({
  alerts,
  onSeen,
}: {
  /** 监听到的、**新出现**的那些（§5.3）。它们已经在下面的完整列表里了，
   *  这里单独再说一遍是因为「刚刚变的」和「一直就有」是两个信号。 */
  alerts: ScanFinding[];
  onSeen: () => void;
}) {
  const [data, setData] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ScanFinding | null>(null);
  const [targets, setTargets] = useState<McpTargetView[]>([]);
  const [base, setBase] = useState<BaselineResponse | null>(null);
  const [pending, setPending] = useState<{ req: McpOpRequest; plan: PlanView } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [scan, ts, bl] = await Promise.all([
        invoke<ScanResponse>("scan_configs", { projects: [] }),
        invoke<McpTargetView[]>("mcp_targets"),
        invoke<BaselineResponse>("baseline"),
      ]);
      setData(scan);
      setTargets(ts);
      setBase(bl);
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /** 点了格子。**先算一份 diff**，不直接写 —— 和接管同一条纪律。 */
  async function ask(req: McpOpRequest) {
    setBusy(true);
    setError(null);
    try {
      setPending({ req, plan: await invoke<PlanView>("mcp_plan", { req }) });
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await invoke<AdoptResponse>("mcp_apply", { req: pending.req });
      setPending(null);
      await load();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <div className="p-5 tw-head text-neutral-500">{error ?? "扫描中…"}</div>;
  }

  const high = data.findings.filter((f) => f.level === "high").length;

  return (
    <div className="space-y-5 p-5">
      {error && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 tw-body text-neutral-500">
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
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {data.rules_warning}
        </div>
      )}

      {/* 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉 */}
      {data.unreadable.length > 0 && (
        <div className="tw-body text-amber-600 dark:text-amber-400">
          有 {data.unreadable.length} 份文件读不动，这次没扫到：{data.unreadable.join("、")}
        </div>
      )}

      {alerts.length > 0 && (
        <section className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <div className="flex items-center gap-2">
            <h2 className="tw-head font-medium text-red-900 dark:text-red-200">
              刚刚新出现的 · {alerts.length} 处
            </h2>
            <button
              className="ml-auto rounded px-2 py-0.5 tw-body text-red-700 dark:text-red-300"
              onClick={onSeen}
            >
              标记已读
            </button>
          </div>
          {/* 「一个用了半年的 skill 突然多了一段零宽字符」这个信号，
              比「这个文件里有可疑内容」强得多 */}
          <p className="mt-1 tw-body text-red-800 dark:text-red-300">
            这些是配置文件里<span className="font-medium">新</span>出现的，不是一直就在那儿的。
          </p>
          <ul className="mt-2 space-y-1 tw-body">
            {alerts.map((f, i) => (
              <li key={i}>
                <button className="text-left hover:underline" onClick={() => setOpen(f)}>
                  {f.title}
                  <span className="ml-2 text-red-700 dark:text-red-400">
                    {f.path.replace(/^.*\//, "")}:{f.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 tw-head font-medium">
          发现{data.findings.length > 0 && ` · ${data.findings.length} 处`}
          {high > 0 && <span className="ml-1 text-red-600 dark:text-red-400">（{high} 处高危）</span>}
        </h2>
        {data.findings.length === 0 ? (
          // §0.6：没风险的时候要说「安全」，而不是让这一块消失
          <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 tw-body text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            ✓ 没发现问题
            <Tip text="隐藏字符、提示注入、危险命令、过宽权限 —— 四类都查过了。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">查了四类</span>
            </Tip>
          </div>
        ) : (
          <ul className="space-y-1">
            {data.findings.map((f, i) => (
              <li key={i}>
                <button
                  className="flex w-full items-start gap-2 rounded border border-neutral-200 px-3 py-2 text-left tw-body hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
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

      {base && <Baseline b={base} />}

      <Matrix mcp={data.mcp} conflicting={data.conflicting} targets={targets} busy={busy} onAsk={ask} />

      {data.hooks.length > 0 && (
        <section>
          <h2 className="mb-1 tw-head font-medium">hook · {data.hooks.length}</h2>
          {/* 危险度第一：不需要模型参与就能拿到执行权 */}
          <p className="mb-2 tw-body text-neutral-500">
            hook 在工具调用前后直接执行 shell 命令
            <Tip text="这是唯一不需要模型参与就能拿到执行权的入口 —— 别的都要先说服模型调用某个工具。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">为什么单列</span>
            </Tip>
          </p>
          <ul className="space-y-1 tw-body">
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
          <h2 className="mb-1 tw-head font-medium">skill · {data.skills.length}</h2>
          {/* §7.12：skill 只看不搬 —— 跨客户端的格式还没有事实标准 */}
          <p className="mb-2 tw-body text-neutral-500">
            只列出来看，不做跨客户端搬动
            <Tip text="skill 的跨客户端格式还没有事实标准，搬过去大概率是一份对方读不懂的配置。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">为什么</span>
            </Tip>
          </p>
          <ul className="space-y-1 tw-body">
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
      {pending && (
        <McpConfirm
          plan={pending.plan}
          req={pending.req}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

/**
 * MCP 矩阵（§7.12）。
 *
 * M4 的简化版**只看不搬**：格子告诉你谁配了什么，同名不同配置标个记号。
 * 点格子执行复制是 §7.12 里更完整的那一版，等这一版用顺了再说。
 */
function Matrix({
  mcp,
  conflicting,
  targets,
  busy,
  onAsk,
}: {
  mcp: McpView[];
  conflicting: string[];
  targets: McpTargetView[];
  busy: boolean;
  onAsk: (req: McpOpRequest) => void;
}) {
  // 列 = 所有能写的位置 ∪ 已经配了东西的位置。
  // **不能写的也要出现在表里** —— 看得见是第一目标，只是它的格子点不动
  const clients = [
    ...new Set([...targets.map((t) => t.client), ...mcp.map((m) => m.client)]),
  ].sort();
  /**
   * 正在对比的那个同名服务器（§7.12）。
   *
   * **标一个记号只回答了「不一样」，没回答「哪儿不一样」** —— 而用户
   * 要做的决定恰恰是「以哪边为准」，那个决定需要看见差异。
   */
  const [compare, setCompare] = useState<string | null>(null);
  const canWrite = (c: string) => targets.find((t) => t.client === c)?.copyable ?? false;
  const whyNot = (c: string) => targets.find((t) => t.client === c)?.why_not ?? "这个客户端不在可写清单里";
  const names = [...new Set(mcp.map((m) => m.name))].sort();
  if (names.length === 0) {
    return (
      <section>
        <h2 className="mb-1 tw-head font-medium">MCP server</h2>
        <p className="tw-body text-neutral-500">这台机器上没有配置任何 MCP server。</p>
      </section>
    );
  }
  const at = (name: string, client: string) => mcp.find((m) => m.name === name && m.client === client);

  return (
    <section>
      <h2 className="mb-1 tw-head font-medium">MCP server · {names.length}</h2>
      <p className="mb-2 tw-body text-neutral-500">
        每一个都是能执行程序、或能取走上下文的入口。
        <Tip text="点空格子从已有它的客户端复制过来，点实心格子从这个客户端移除。两种都会先显示 diff 再写入。">
          <span className="underline decoration-dotted underline-offset-2">点格子可改</span>
        </Tip>
      </p>
      <div className="overflow-x-auto">
        <table className="tw-body">
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
                      <Tip text="同名，但各客户端里的配置不一样 —— 点开并排看差异">
                        <button
                          onClick={() => setCompare(compare === n ? null : n)}
                          className="mr-1 text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
                        >
                          ⚠
                        </button>
                      </Tip>
                    )}
                    {n}
                  </td>
                  {clients.map((c) => {
                    const m = at(n, c);
                    const writable = canWrite(c);
                    // 空格子从哪儿抄过来。多个来源时用第一个能抄的
                    const source = mcp.find((x) => x.name === n && canWrite(x.client));
                    const can = writable && (m ? true : !!source);
                    const title = !writable
                      ? whyNot(c)
                      : m
                        ? `从 ${c} 移除`
                        : source
                          ? `从 ${source.client} 复制过来`
                          : "没有能抄的来源";
                    return (
                      <td key={c} className="px-2 py-1 text-center">
                        <button
                          className={
                            "w-6 rounded " +
                            (can
                              ? "hover:bg-neutral-200 dark:hover:bg-neutral-700"
                              : "cursor-default opacity-60")
                          }
                          title={title}
                          disabled={!can || busy}
                          onClick={() =>
                            can &&
                            onAsk(
                              m
                                ? { op: "remove", name: n, to: c }
                                : { op: "copy", name: n, from: source!.client, to: c },
                            )
                          }
                        >
                          {!m ? (
                            <span className="text-neutral-300 dark:text-neutral-700">·</span>
                          ) : m.enabled ? (
                            "✓"
                          ) : (
                            // 关掉的还在配置里，一次编辑就能打开
                            <Tip text="配置里写着 enabled: false —— 它还列在这里，但不会被加载">
                              <span className="text-neutral-400">○</span>
                            </Tip>
                          )}
                        </button>
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

      {/*
        同名不同配置的并排对比（§7.12）。**标一个记号只回答了「不一样」，
        没回答「哪儿不一样」** —— 而用户要做的决定恰恰是「以哪边为准」。
      */}
      {compare && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 tw-body dark:border-amber-800 dark:bg-amber-950">
          <div className="flex items-baseline justify-between">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              <code>{compare}</code> 在各客户端里配得不一样
            </p>
            <button
              onClick={() => setCompare(null)}
              className="text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
            >
              收起
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {mcp
              .filter((m) => m.name === compare)
              .map((m) => {
                const peers = mcp.filter((x) => x.name === compare);
                // 只把**真的不一样**的字段标出来。全都标一遍等于没标
                const differs = (get: (x: McpView) => string) =>
                  new Set(peers.map(get)).size > 1;
                const cmd = (x: McpView) =>
                  x.url ? `远端 ${x.url}` : `${x.command} ${x.args.join(" ")}`.trim();
                const hi = (on: boolean) =>
                  on
                    ? "rounded bg-amber-200 px-1 dark:bg-amber-900/60"
                    : "";
                return (
                  <div key={m.client} className="rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-900 dark:bg-black/20">
                    <div className="font-medium">{m.client}</div>
                    <div className="mt-0.5 font-mono">
                      <span className={hi(differs(cmd))}>{cmd(m)}</span>
                    </div>
                    {(m.env_keys.length > 0 || differs((x) => x.env_keys.join(","))) && (
                      <div className="mt-0.5 text-neutral-600 dark:text-neutral-400">
                        环境变量{" "}
                        <span className={"font-mono " + hi(differs((x) => x.env_keys.join(",")))}>
                          {m.env_keys.length > 0 ? m.env_keys.join(" · ") : "（没有）"}
                        </span>
                        {/* **只有名字没有值** —— 值里常常就是密钥 */}
                      </div>
                    )}
                    <div className="mt-0.5 text-neutral-500">
                      <span className={hi(differs((x) => String(x.enabled)))}>
                        {m.enabled ? "已启用" : "已关闭"}
                      </span>
                      <span className="ml-2 font-mono tw-label">{m.source}</span>
                    </div>
                  </div>
                );
              })}
          </div>
          <p className="mt-2 text-amber-800 dark:text-amber-300">
            要统一：点矩阵里你想保留的那一格，复制到别的客户端。写入前会显示 diff。
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * 点了格子之后的确认框。
 *
 * **和接管走同一条纪律**（§7.12）：字段级合并、写前全文备份、展示 diff
 * 让用户确认。往客户端配置里写东西，风险和接管完全一样。
 */
function McpConfirm({
  plan,
  req,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: PlanView;
  req: McpOpRequest;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4 shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tw-head font-medium">
          {req.op === "copy" ? `把 ${req.name} 复制到 ${req.to}` : `从 ${req.to} 移除 ${req.name}`}
        </div>
        <div className="mt-1 tw-body text-neutral-500">
          要改 <code>{plan.path}</code>
        </div>
        {plan.noop ? (
          <div className="mt-3 tw-body">已经是这样了，什么都不用改。</div>
        ) : (
          <>
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-neutral-50 p-2 tw-label leading-relaxed dark:bg-neutral-950">
              {plan.after}
            </pre>
            <div className="mt-2 tw-body text-neutral-500">
              写入前整份备份，除这一项外一字节不动。
              {req.op === "copy" && (
                <span className="text-amber-700 dark:text-amber-400">
                  {" "}env 里可能带着密钥，会一并复制过去。
                </span>
              )}
            </div>
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded px-3 py-1 tw-body text-neutral-500" onClick={onCancel}>
            取消
          </button>
          {!plan.noop && (
            <button
              className="rounded bg-neutral-900 px-3 py-1 tw-body text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
              onClick={onConfirm}
              disabled={busy}
            >
              确认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 上游行为基线（§5.2 防线三）。
 *
 * > 某个中转站用了三个月一直正常，某天开始返回大量 bash 调用 ——
 * > 这是统计异常，值得告警。
 *
 * **报数字，不报结论。**「最近 24 小时 40%，之前 30 天 3%（样本
 * 120 / 4,200）」比「检测到异常」有用得多 —— 后者用户没法验证，也没法
 * 判断该不该管。样本不够的时候这一块什么都不说。
 */
function Baseline({ b }: { b: BaselineResponse }) {
  if (b.unavailable) {
    // **「不是没发现，是没看」**要说出来
    return (
      <section>
        <h2 className="mb-1 tw-head font-medium">上游行为</h2>
        <p className="tw-body text-neutral-500">
          观测层没启动，这段时间的请求没有记录
          <Tip text="没有记录就没有基线可比 —— 这不是「没发现异常」，是「没有看」。">
            <span className="ml-1 underline decoration-dotted underline-offset-2">所以没法比</span>
          </Tip>
        </p>
      </section>
    );
  }
  const withDrift = b.providers.filter((p) => p.drifts.length > 0);
  const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  return (
    <section>
      <h2 className="mb-1 tw-head font-medium">上游行为</h2>
      <p className="mb-2 tw-body text-neutral-500">
        最近 {b.recent_hours} 小时 对比 之前 {b.baseline_days} 天
        <Tip text="样本不够的上游不会出现在这里 —— 两边各至少 20 条才比，否则一次抖动就能算出「四倍」。">
          <span className="ml-1 underline decoration-dotted underline-offset-2">样本要求</span>
        </Tip>
      </p>
      {withDrift.length === 0 ? (
        // §0.6：没风险的时候要说「安全」，而不是让这一块消失
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 tw-body text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          ✓ 每个上游的行为都和之前一致
          {b.providers.length > 0 && (
            <span className="ml-1 text-emerald-700 dark:text-emerald-400">
              （比过的：{b.providers.map((p) => p.provider).join("、")}）
            </span>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {withDrift.map((p) => (
            <li
              key={p.provider}
              className="rounded border border-amber-200 bg-amber-50 px-3 py-2 tw-body dark:border-amber-900 dark:bg-amber-950"
            >
              <div className="font-medium">{p.provider} 的行为变了</div>
              {p.drifts.map((d) => (
                <div key={d.metric} className="mt-1">
                  {d.label}：<span className="font-medium">{pct(d.recent)}</span>
                  <span className="text-neutral-500">
                    ，之前是 {pct(d.baseline)}
                    {/* **样本量必须一起给** —— 没有它，比率是个没法判断
                        可信度的数字 */}
                    （样本 {d.recent_n} / {d.baseline_n}）
                  </span>
                </div>
              ))}
              {/* 数过形状的和总数不同时要说清楚 */}
              {p.recent_inspected < p.recent_total && (
                <div className="mt-1 text-neutral-500">
                  {p.recent_total} 条里数过形状的有 {p.recent_inspected} 条
                  <Tip text="其余那些发生在入站审查关着的时候 —— 那段时间没有数据，不是数出来是零。">
                    <span className="ml-1 underline decoration-dotted underline-offset-2">差额去哪了</span>
                  </Tip>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
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
        <div className="tw-head font-medium">{f.title}</div>
        <div className="mt-2 space-y-2 tw-body text-neutral-600 dark:text-neutral-400">
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
            只报告，不改动任何文件。打开上面的路径看过再决定。
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button className="rounded px-3 py-1 tw-body text-neutral-500" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
