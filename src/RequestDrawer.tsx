import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usd, type BodyView, type RequestDetail } from "./types";

type Tab = "timeline" | "payload" | "usage";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-1">
      <span className="w-28 shrink-0 text-neutral-500">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}

/**
 * 一段 body。
 *
 * **system prompt 默认折叠。**Claude Code 的 system prompt 有几千 token，
 * 展开会淹没一切 —— 而用户点开这个抽屉是为了看**这一次**发生了什么
 * （§7 的详情抽屉）。
 */
function Body({ b, title }: { b: BodyView | null; title: string }) {
  const [open, setOpen] = useState(false);
  if (!b) {
    return (
      <div>
        <div className="text-xs font-medium">{title}</div>
        <p className="mt-1 text-xs text-neutral-500">
          没有存下来。可能是磁盘快满了（那时只记摘要），也可能是这条记录已经过了保留期。
        </p>
      </div>
    );
  }
  const big = b.text.length > 2000;
  const shown = open || !big ? b.text : b.text.slice(0, 2000);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-medium">{title}</span>
        <span className="text-xs text-neutral-400">
          {b.original_len.toLocaleString()} 字节
          {/* **截断了要说出来。**不说的话用户会以为请求本身就这么长 */}
          {b.truncated && " · 只存了开头"}
        </span>
        {big && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {open ? "折叠" : "展开全部"}
          </button>
        )}
      </div>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-neutral-100 p-2 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap dark:bg-neutral-900">
        {shown}
        {big && !open && "\n…"}
      </pre>
    </div>
  );
}

export default function RequestDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
        const x = await invoke<RequestDetail>("request_detail", { id });
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
  }, [id]);

  const r = d?.row;

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[min(38rem,90vw)] flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-950">
      <header className="flex items-baseline gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <span className="text-sm font-semibold">{r?.model || `第 ${id} 号请求`}</span>
        {r && (
          <span className="text-xs text-neutral-500">{new Date(r.at_ms).toLocaleString()}</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          关闭
        </button>
      </header>

      {error && (
        <p className="m-4 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      )}

      {d && r && (
        <>
          <nav className="flex gap-1 border-b border-neutral-200 px-4 py-2 text-xs dark:border-neutral-800">
            {(["timeline", "payload", "usage"] as const).map((t) => (
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
                {t === "timeline" ? "时间线" : t === "payload" ? "内容" : "用量"}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-auto p-4 text-xs">
            {tab === "timeline" && (
              <div className="space-y-1">
                {/* **TTFT 放在最显眼的位置。**对 AI 来说它才是体感的
                    一切 —— 一眼看出慢在网络还是慢在模型 */}
                <Row
                  label="首字节"
                  value={
                    r.ttfb_ms != null ? (
                      <span className="text-base">{r.ttfb_ms}ms</span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row label="总耗时" value={r.duration_ms != null ? `${r.duration_ms}ms` : "—"} />
                <Row
                  label="生成用时"
                  value={
                    r.duration_ms != null && r.ttfb_ms != null
                      ? `${r.duration_ms - r.ttfb_ms}ms`
                      : "—"
                  }
                />
                <Row label="上游" value={r.local ? "本地应答" : r.provider} />
                <Row label="客户端" value={r.client} />
                <Row label="路径" value={<span className="font-mono">{r.path}</span>} />
                <Row
                  label="状态"
                  value={
                    r.error ? (
                      <span className="text-red-600 dark:text-red-400">{r.error}</span>
                    ) : (
                      (r.status ?? "—")
                    )
                  }
                />
                <Row label="字节" value={r.bytes?.toLocaleString() ?? "—"} />
              </div>
            )}

            {tab === "payload" && (
              <div className="space-y-4">
                <Body b={d.request_body} title="请求" />
                <Body b={d.response_body} title="响应" />
                <p className="text-neutral-400">
                  这两段已经过脱敏：看起来像密钥的东西都打了码。
                </p>
              </div>
            )}

            {tab === "usage" && (
              <div className="space-y-1">
                {r.input_tokens == null ? (
                  // **没有 usage 不是「用了 0」**（§4.3）
                  <p className="text-neutral-500">
                    这家上游没有报用量。有些中转站会吞掉 usage 字段 —— 那时我们不知道这次调用
                    用了多少，也就算不出钱。
                  </p>
                ) : (
                  <>
                    <Row label="输入" value={r.input_tokens.toLocaleString()} />
                    <Row label="输出" value={(r.output_tokens ?? 0).toLocaleString()} />
                    <Row label="缓存读" value={(r.cache_read_tokens ?? 0).toLocaleString()} />
                    <Row label="缓存写" value={(r.cache_write_tokens ?? 0).toLocaleString()} />
                    <Row
                      label="花费"
                      value={
                        r.cost_micros == null ? (
                          // 「没有价格」和「花了 0 元」是两件事
                          <span className="text-neutral-500">
                            算不出来 —— 这个模型不在价目表里
                          </span>
                        ) : r.cost_estimated ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            ~{usd(r.cost_micros)} · 估算
                          </span>
                        ) : (
                          usd(r.cost_micros)
                        )
                      }
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
