import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import ConfigTextMode from "./ConfigText";
import type { ConfigText, ConfigVersion, L1Result, Overview, PatchOp } from "./types";

/**
 * 一个能改的字段。
 *
 * **失焦才提交，而且值没变就什么都不做。**每敲一个键就发一次 patch 会
 * 在历史里堆满噪音，而历史是回滚的依据（§3.8）。
 *
 * 提交时带上 `version` —— 那是乐观并发的凭据。用户在编辑器里同时改了
 * 什么，界面无从知道，所以永远不覆盖。
 */
function EditableCell({
  value,
  path,
  version,
  onSaved,
  mono,
}: {
  value: string;
  path: string;
  version: string | null;
  onSaved: (err: string | null) => void;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  // 外面换了版本（别人改了文件）就跟着走 —— 否则用户会盯着一个已经
  // 不存在的值发呆
  useEffect(() => setDraft(value), [value]);

  async function commit() {
    if (draft === value || busy) return;
    if (!version) {
      onSaved("还没读到配置版本，稍等一下再试");
      setDraft(value);
      return;
    }
    setBusy(true);
    try {
      const ops: PatchOp[] = [{ op: "replace", path, value: draft }];
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      await invoke("patch_config", { ops, baseVersion: version });
      onSaved(null);
    } catch (e) {
      // **失败时把草稿退回原值。**留着一个没保存成功的值，用户下次
      // 看这一行会以为它已经生效了。
      setDraft(value);
      onSaved(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <input
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        // Esc 放弃这次编辑
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className={
        "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 " +
        "hover:border-neutral-300 focus:border-neutral-400 focus:outline-none " +
        "disabled:opacity-50 dark:hover:border-neutral-700 dark:focus:border-neutral-600 " +
        (mono ? "font-mono" : "")
      }
    />
  );
}

/**
 * 一次 L1 测速的结果。
 *
 * **每一段单独一行，不画一根合成的进度条。**「建连 292ms」说不出任何
 * 该修的东西，而「DNS 5ms / TCP 3ms / TLS 283ms」一眼能看出问题在哪
 * 一层（§4.6）。
 */
function SpeedRows({ r }: { r: L1Result }) {
  return (
    <div className="mt-1.5 space-y-0.5 text-xs">
      {r.segments.map((seg) => (
        <div key={seg.name} className="flex gap-3 text-neutral-500">
          <span className="w-32 shrink-0">{seg.name}</span>
          <span className="font-mono tabular-nums">{seg.ms} ms</span>
        </div>
      ))}
      {r.ok && (
        <div className="flex gap-3">
          <span className="w-32 shrink-0 text-neutral-500">建连总计</span>
          <span className="font-mono tabular-nums font-medium">{r.total_ms} ms</span>
        </div>
      )}
      {r.error && (
        <p className="text-amber-700 dark:text-amber-400">{r.error}</p>
      )}
      {/* 缺一段一定要有话交代，否则看起来像 bug */}
      {r.notes?.map((n) => (
        <p key={n} className="text-neutral-400">· {n}</p>
      ))}
    </div>
  );
}

/**
 * 上游与规则。
 *
 * **按 §0.6 的触发条件显示**：只有一个 provider 的用户不会看到「故障
 * 转移」「分组」这些词 —— 那些概念对他确实不存在。但**模型路由一直在**，
 * 因为一个上游就有几十个模型，那个问题从第一天就存在。
 */
export default function Config({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const multi = ov.providers.length >= 2;
  const [cfg, setCfg] = useState<ConfigText | null>(null);
  const [history, setHistory] = useState<ConfigVersion[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /**
   * 表单还是文本。**默认表单** —— 大多数改动是改一个值，而文本模式要求
   * 用户知道 YAML 长什么样（§0.6：默认值不该要求用户额外懂什么）。
   */
  const [mode, setMode] = useState<"form" | "text">("form");
  const [reloadKey, setReloadKey] = useState(0);

  // 每次配置换了版本就重新拉一遍 —— 手里那份的 version 过期之后，
  // 下一次编辑会撞 409，而用户看不出为什么
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await invoke<ConfigText>("get_config");
        if (alive) setCfg(c);
        const h = await invoke<ConfigVersion[]>("config_history");
        if (alive) setHistory(h);
      } catch (e) {
        if (alive) setSaveError(typeof e === "string" ? e : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [configVersion, reloadKey]);
  const [speed, setSpeed] = useState<Record<string, L1Result>>({});
  const [testing, setTesting] = useState<string | null>(null);

  // 测速零成本，所以点了就跑，不弹确认框 —— **要确认的是 L3**（§4.6），
  // 那一层会真的调用模型。这里连一个 token 都不产生。
  async function test(provider?: string) {
    setTesting(provider ?? "*");
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      const rs = await invoke<L1Result[]>("speed_test", { provider, proxy: null });
      setSpeed((prev) => {
        const next = { ...prev };
        for (const r of rs) next[r.target] = r;
        return next;
      });
    } catch (e) {
      // 连不上控制面时也要落到界面上，而不是只进控制台
      const msg = typeof e === "string" ? e : String(e);
      setSpeed((prev) => ({
        ...prev,
        [provider ?? "*"]: {
          target: provider ?? "*",
          ok: false,
          segments: [],
          total_ms: 0,
          error: msg,
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  if (mode === "text") {
    return (
      <div className="space-y-3 p-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">配置文件</h2>
          <button
            onClick={() => setMode("form")}
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            回到表单
          </button>
        </div>
        {cfg ? (
          <ConfigTextMode doc={cfg} onSaved={() => setReloadKey((k) => k + 1)} />
        ) : (
          <p className="text-xs text-neutral-500">读取中…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 p-5">
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">上游</h2>
          {multi && (
            <button
              onClick={() => test(undefined)}
              disabled={testing !== null}
              className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
            >
              {testing === "*" ? "测速中…" : "全部测一遍"}
            </button>
          )}
          {/* 说清这一下不花钱。**不说的话，谨慎的用户就不会点** —— 而
              这是排查线路问题最直接的一个动作 */}
          <span className="text-xs text-neutral-400">只握手，不发请求，不花钱</span>
          <button
            onClick={() => setMode("text")}
            className="ml-auto text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            改文件
          </button>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {showHistory ? "收起历史" : `历史（${history.length}）`}
          </button>
        </div>

        {/* 保存失败要说出来。**尤其是 409** —— 它不是「你写错了」，是
            「有人抢先改了」，正确的反应是刷新再改（§3.8） */}
        {saveError && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            没能保存：{saveError}
          </p>
        )}

        {showHistory && (
          <div className="mt-2 rounded-md border border-neutral-200 dark:border-neutral-800">
            {history.length === 0 && (
              <p className="px-3 py-2 text-xs text-neutral-500">
                还没有历史版本。第一次改配置之后就有了。
              </p>
            )}
            {history.map((v) => (
              <div
                key={v.version}
                className="flex items-baseline gap-3 border-b border-neutral-100 px-3 py-1.5 text-xs last:border-b-0 dark:border-neutral-900"
              >
                <span className="font-mono text-neutral-500">{v.version.slice(7)}</span>
                <span className="text-neutral-500">{v.origin}</span>
                <span className="text-neutral-400">
                  {new Date(v.at_ms).toLocaleString()}
                </span>
                {v.current ? (
                  // 不标出来的话，用户会以为第一条是「上一版」然后回滚到自己身上
                  <span className="ml-auto text-emerald-600 dark:text-emerald-400">现在这版</span>
                ) : (
                  <button
                    onClick={async () => {
                      setSaveError(null);
                      try {
                        await invoke("rollback_config", { version: v.version });
                      } catch (e) {
                        setSaveError(typeof e === "string" ? e : String(e));
                      }
                    }}
                    className="ml-auto text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    回到这版
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-2 font-medium">名字</th>
              <th className="font-medium">地址</th>
              <th className="font-medium">协议</th>
              <th className="font-medium">密钥</th>
              <th className="font-medium">代理</th>
              {/* 只有一家的时候熔断是旁路的，显示健康列没有意义 */}
              {multi && <th className="font-medium">状态</th>}
              <th className="font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {ov.providers.map((p) => (
              <tr key={p.name} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 font-medium">{p.name}</td>
                <td className="text-neutral-500">
                  <EditableCell
                    mono
                    value={p.base_url}
                    path={`/providers/${p.name}/base_url`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                  />
                </td>
                <td className="text-neutral-500">
                  {/* 猜不出协议不是错误 —— 但要说清按什么转发 */}
                  {p.protocol ?? <span title="按 Anthropic 转发">未知</span>}
                </td>
                {/* 来源，不是值 */}
                <td className="font-mono text-neutral-500">{p.key_source}</td>
                <td className="text-neutral-500">{p.proxy}</td>
                {multi && (
                  <td>
                    {p.health === "ok" ? (
                      <span className="text-emerald-600 dark:text-emerald-400">正常</span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400" title="连续失败后暂时不派请求过去，冷却后自动恢复">
                        熔断中
                      </span>
                    )}
                  </td>
                )}
                <td className="text-right">
                  <button
                    onClick={() => test(p.name)}
                    disabled={testing !== null}
                    className="text-neutral-500 underline underline-offset-2 hover:text-neutral-900 disabled:opacity-50 dark:hover:text-neutral-100"
                  >
                    {testing === p.name ? "测速中…" : "测一下"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* 结果放在表下面而不是挤进单元格：分段有三到四行，塞进表格会把
            每一行都撑高，而大多数时候它们并不存在 */}
        {ov.providers.map((p) => {
          const r = speed[p.name];
          if (!r) return null;
          return (
            <div
              key={p.name}
              className="mt-3 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
            >
              <div className="flex items-baseline gap-2 text-xs">
                <span>{r.ok ? "✅" : "❌"}</span>
                <span className="font-medium">{p.name}</span>
                {r.via && <span className="text-neutral-500">经 {r.via}</span>}
              </div>
              <SpeedRows r={r} />
            </div>
          );
        })}
        {speed["*"]?.error && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{speed["*"].error}</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold">路由规则</h2>
        <p className="mt-1 text-xs text-neutral-500">
          从上往下匹配，第一条命中的说了算。
        </p>
        <ol className="mt-2 space-y-1.5">
          {ov.routes.map((r, i) => (
            <li
              key={r.name}
              className="flex items-baseline gap-3 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
            >
              <span className="w-4 shrink-0 text-neutral-400">{i + 1}</span>
              <span className="font-medium">{r.name}</span>
              <span className="text-neutral-500">
                {r.conditions.length === 0 ? (
                  // 兜底规则要标出来。少了它，用户会以为「没有兜底」
                  // 而反复调试一条其实一直在生效的规则。
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-800">
                    兜底
                  </span>
                ) : (
                  r.conditions.join(" 且 ")
                )}
              </span>
              <span className="ml-auto font-mono text-neutral-500">→ {r.to}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* §0.6：分组这个概念只在真的有组的时候出现 */}
      {ov.groups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">策略组</h2>
          <ul className="mt-2 space-y-1.5">
            {ov.groups.map((g) => (
              <li
                key={g.name}
                className="rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-neutral-500">{g.kind}</span>
                  <span className="ml-auto font-mono text-neutral-500">
                    {g.providers.join(" → ")}
                  </span>
                </div>
                {g.hurts_cache && (
                  // 这句必须在界面上直说：它决定了用户的账单（§3.4）。
                  // 缓存命中与否成本差 5 到 10 倍，而为了省 20% 的单价
                  // 丢掉 90% 的缓存折扣，是一笔怎么算都不划算的账。
                  <p className="mt-1.5 text-amber-700 dark:text-amber-400">
                    ⚠ 这个策略会让 prompt cache 失效，长会话的成本会明显上升。
                    需要它的话记得开会话粘滞。
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">监听与访问</h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-neutral-500">地址</dt>
          <dd className="font-mono">
            {ov.listen.bind} : {ov.listen.port}
          </dd>
          <dt className="text-neutral-500">客户端密钥</dt>
          <dd className="font-mono">
            {ov.clients.map((c) => `${c.name} ${c.key}`).join("，")}
          </dd>
          {ov.listen.exposed && (
            <>
              <dt className="text-neutral-500">来源白名单</dt>
              <dd className="font-mono">{ov.listen.allow_from.join("，") || "（全放行）"}</dd>
            </>
          )}
        </dl>
        {ov.listen.exposed && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            网关监听在非本机地址上，局域网里的其他机器能连过来。密钥校验此时是强制的。
          </p>
        )}
      </section>
    </div>
  );
}
