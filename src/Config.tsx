import { useRef, useState } from "react";
import AddUpstream from "./AddUpstream";
import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import ConfigTextMode from "./ConfigText";
import Pricing from "./Pricing";
import SpeedTest from "./SpeedTest";
import { triggers } from "./triggers";
import DryRun from "./DryRun";
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
  /**
   * 输入法正在组字。
   *
   * **§9.7 那条数据丢失就在这儿**：cc-switch 报过一个 12 字符的值被
   * 膨胀成 1396 字符 —— 受控组件在输入法还持有 composition range 时
   * 把 state 写回 DOM。我们是 Tauri（WebKit）+ 中文用户 + 配置输入框，
   * 三个条件全中。
   *
   * 更阴的是 **WebKit 在窗口切换时不发 `compositionend`** —— 用户输到
   * 一半点了别的窗口，那个事件永远不来。所以 `blur` 里要强制收尾。
   */
  const composing = useRef(false);
  // 外面换了版本（别人改了文件）就跟着走 —— 否则用户会盯着一个已经
  // 不存在的值发呆
  useEffect(() => setDraft(value), [value]);

  async function commit() {
    // 组字中不提交 —— 中间态提交上去的是一段还没成形的文本
    if (composing.current || draft === value || busy) return;
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
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
      }}
      onBlur={(e) => {
        // WebKit 窗口切换时不发 `compositionend`，这里强制收尾
        composing.current = false;
        setDraft(e.currentTarget.value);
        void commit();
      }}
      // **macOS 会把 API key 的首字母大写。**一行属性的事，不写就是
      // 一类稳定复现的「key 明明是对的却认证失败」（§9.7）
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
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
 * 一个下拉改一个标量字段。
 *
 * **和 `EditableCell` 走同一条路**（`patch_config` + 乐观并发），只是
 * 输入形状不同 —— 枚举字段让用户手打，打错一个字母就是一次静默的
 * 「配了没生效」。
 */
function SelectCell({
  value,
  options,
  path,
  version,
  onSaved,
  onDone,
}: {
  value: string;
  /** `[写进 YAML 的值, 显示给人看的字]` */
  options: [string, string][];
  path: string;
  version: string | null;
  onSaved: (err: string | null) => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <select
      value={value}
      disabled={busy}
      onChange={async (e) => {
        if (!version) {
          onSaved("还没读到配置版本，稍等一下再试");
          return;
        }
        const v = e.target.value;
        setBusy(true);
        try {
          await invoke("patch_config", {
            // 空串写成 null —— 「没写这个字段」和「写了个空值」是两回事，
            // 而前者才是「按默认/自动判」的意思
            ops: [{ op: "replace", path, value: v === "" ? null : v }],
            baseVersion: version,
          });
          onSaved(null);
          onDone?.();
        } catch (err) {
          onSaved(typeof err === "string" ? err : String(err));
        } finally {
          setBusy(false);
        }
      }}
      className={
        "rounded border border-transparent bg-transparent px-1 py-0.5 " +
        "hover:border-neutral-300 focus:border-neutral-400 focus:outline-none " +
        "disabled:opacity-50 dark:hover:border-neutral-700 dark:focus:border-neutral-600"
      }
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
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
  section = "gateway",
  ov,
  configVersion,
  rejectedLine,
  onProviderAdded,
}: {
  /**
   * 这一次渲染哪一域。
   *
   * IA 上「路由」和「网关」是源列表里两个并列的面,实现上还是同一个
   * 组件 —— 因为策略组那一节和 `SelectCell`、配置版本、以及跳去文本
   * 模式那条路都缠在一起,硬拆会弄坏正在工作的东西。**这是分面的第一
   * 步,不是终点**:组件真正拆开是下一步的事,拆之前这个参数不该被当成
   * 一个可以随便加值的开关。
   *
   * 文本模式两个面共用 —— 它编辑的是整份文件,本来就不分域。
   */
  section?: "gateway" | "routing";
  ov: Overview;
  configVersion: string | null;
  /** 最近一次校验失败指到的行号（§3.8）。文本模式会把它滚进视野 */
  rejectedLine?: number | null;
  /** 加完第一个上游之后让外面立刻重拉概览，不等那两秒的轮询 */
  onProviderAdded: () => void;
}) {
  // 触发条件全在一个地方（§0.6）—— 散在各个组件里的
  // `providers.length >= 2` 回答不了那条反面判据
  const t = triggers(ov, null);
  useEffect(() => {
    void invoke<boolean>("autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);
  const multi = t.health;
  const [cfg, setCfg] = useState<ConfigText | null>(null);
  const [history, setHistory] = useState<ConfigVersion[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 开机自启。**出厂是关的** —— null 表示还没读到，别在读到之前先画一个
  // 勾或不勾出来：那一瞬间画错的话，用户会以为是自己之前设的。
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [autostartErr, setAutostartErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  /**
   * 表单还是文本。**默认表单** —— 大多数改动是改一个值，而文本模式要求
   * 用户知道 YAML 长什么样（§0.6：默认值不该要求用户额外懂什么）。
   */
  const [mode, setMode] = useState<"form" | "text">("form");
  /**
   * 跳到文本模式时要定位的名字（§7.10）。
   *
   * 表单和文本**是同一份文件的两种视图**，不是两个割裂的东西 —— 而让
   * 用户建立这个心智最有效的一下，就是他点「在文件里看」时那一段真的
   * 被选中了。
   */
  const [focus, setFocus] = useState<string | null>(null);
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
            onClick={() => {
              setFocus(null);
              setMode("form");
            }}
            className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            回到表单
          </button>
        </div>
        {cfg ? (
          <ConfigTextMode
            doc={cfg}
            focus={focus}
            rejectedLine={rejectedLine ?? null}
            onJumpToForm={(name) => {
              // 回表单并把那一行滚进视野。**两个方向都要通** ——
              // 只通一半的话，用户会觉得这两个视图还是两个东西
              setFocus(null);
              setMode("form");
              setTimeout(() => {
                document
                  .querySelector(`[data-row="${CSS.escape(name)}"]`)
                  ?.scrollIntoView({ block: "center" });
              }, 0);
            }}
            onSaved={() => setReloadKey((k) => k + 1)}
          />
        ) : (
          <p className="text-xs text-neutral-500">读取中…</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 p-5">
      {section === "gateway" && (
      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-semibold">上游</h2>
          {t.comparison && (
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
        {/*
          一个上游都没有时，这一节是「加第一个」而不是一张空表头。
          原来这件事是一个全屏的首次运行页面做的 —— 把人挡在产品外面，
          而那时候网关已经在跑了。配置就该在配置的地方。
        */}
        {ov.providers.length === 0 ? (
          <div className="mt-3">
            <AddUpstream onDone={onProviderAdded} />
          </div>
        ) : (
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-2 font-medium">名字</th>
              <th className="font-medium">地址</th>
              <th className="font-medium">协议</th>
              <th className="font-medium">密钥</th>
              <th className="font-medium">代理</th>
              <th className="font-medium">计费</th>
              <th className="font-medium">信任</th>
              {/* 只有一家的时候熔断是旁路的，显示健康列没有意义 */}
              {multi && <th className="font-medium">状态</th>}
              <th className="font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {ov.providers.map((p) => (
              <tr key={p.name} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 font-medium" data-row={p.name}>
                  {p.name}
                  <button
                    title="在配置文件里看这一段"
                    onClick={() => {
                      setFocus(p.name);
                      setMode("text");
                    }}
                    className="ml-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    ↗
                  </button>
                </td>
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
                  {/*
                    猜不出协议不是错误 —— 但要能改。自动判错的时候，
                    这一格就是修它的地方，而原来只能去改 YAML。
                  */}
                  <SelectCell
                    value={p.protocol ?? ""}
                    options={[
                      ["", "自动（按 Anthropic 转发）"],
                      ["anthropic", "anthropic"],
                      ["openai-chat", "openai-chat"],
                      ["openai-responses", "openai-responses"],
                      ["gemini", "gemini"],
                    ]}
                    path={`/providers/${p.name}/protocol`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {/* 来源，不是值 */}
                <td className="font-mono text-neutral-500">{p.key_source}</td>
                <td className="text-neutral-500">
                  <SelectCell
                    value={p.proxy}
                    options={[
                      ["direct", "直连"],
                      ["system", "跟随系统"],
                      ...(ov.proxies ?? []).map((x) => [x, x] as [string, string]),
                    ]}
                    path={`/providers/${p.name}/proxy`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {/*
                  计费方式：它同时决定成本栏怎么显示（§4.3.1）和
                  `cheapest` 怎么排（§3.5）—— 订阅制的边际成本是零。
                */}
                <td className="text-neutral-500">
                  <SelectCell
                    value={p.billing ?? ""}
                    options={[
                      ["", "自动判"],
                      ["per-token", "按量"],
                      ["subscription", "订阅"],
                      ["unknown", "未知"],
                    ]}
                    path={`/providers/${p.name}/billing`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
                {/*
                  信任级别（§5.2）。**没显式写过的时候要说清是自动判的**
                  —— 否则用户会以为这一格改不动，或者以为是他自己设的。
                */}
                <td className="text-neutral-500">
                  <SelectCell
                    value={p.trust_explicit ? (p.trust === "官方" ? "official" : "untrusted") : ""}
                    options={[
                      ["", `自动判（现在是${p.trust ?? "不受信任"}）`],
                      ["official", "官方"],
                      ["untrusted", "不受信任"],
                    ]}
                    path={`/providers/${p.name}/trust`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                </td>
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
        )}
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
      )}

      {/* L3 测速。**放在 L1 下面，两句成本说明并排** —— 用户要能一眼
          看出「那个不花钱、这个花钱」（§4.6） */}
      <SpeedTest models={[]} />

      {section === "routing" && (
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

      )}

      {/* 「为什么没走我以为的那条」和「走了哪条」是同一个问题的两面 */}
      {section === "routing" && <DryRun models={[]} />}

      {/* §0.6：分组这个概念只在真的有组的时候出现 */}
      {section === "routing" && ov.groups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">策略组</h2>
          <ul className="mt-2 space-y-1.5">
            {ov.groups.map((g) => (
              <li
                key={g.name}
                data-row={g.name}
                className="rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{g.name}</span>
                  <button
                    title="在配置文件里看这一段"
                    onClick={() => {
                      setFocus(g.name);
                      setMode("text");
                    }}
                    className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                  >
                    ↗
                  </button>
                  <SelectCell
                    value={
                      { 按顺序: "fallback", 手动选: "select", 轮流: "load-balance", 选最快: "url-test", 选最便宜: "cheapest" }[
                        g.kind
                      ] ?? "fallback"
                    }
                    options={[
                      ["fallback", "按顺序"],
                      ["select", "手动选"],
                      ["load-balance", "轮流"],
                      ["url-test", "选最快"],
                      ["cheapest", "选最便宜"],
                    ]}
                    path={`/groups/${g.name}/type`}
                    version={cfg?.version ?? null}
                    onSaved={setSaveError}
                    onDone={() => setReloadKey((k) => k + 1)}
                  />
                  <span className="ml-auto font-mono text-neutral-500">
                    {g.providers.join(" → ")}
                  </span>
                </div>
                {/*
                  **`select` 组要能在这儿切。**§3.5 说这个策略就是
                  「UI 上点选」，而切不了的话它等于一个只能改 YAML
                  才能用的功能。

                  选中之后其余的仍然留着做故障转移 —— 手动选一家不等于
                  放弃容错，所以这里说的是「优先」而不是「只用」。
                */}
                {g.kind === "手动选" && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-neutral-500">优先用</span>
                    <select
                      value={g.selected ?? ""}
                      onChange={async (e) => {
                        if (!cfg?.version) {
                          setSaveError("还没读到配置版本，稍等一下再试");
                          return;
                        }
                        try {
                          await invoke("patch_config", {
                            ops: [
                              {
                                op: "replace",
                                path: `/groups/${g.name}/selected`,
                                value: e.target.value,
                              },
                            ],
                            baseVersion: cfg.version,
                          });
                          setSaveError(null);
                          setReloadKey((k) => k + 1);
                        } catch (err) {
                          setSaveError(typeof err === "string" ? err : String(err));
                        }
                      }}
                      className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
                    >
                      {g.providers.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    <span className="text-neutral-500">
                      其余的仍然是它的故障转移备选
                    </span>
                  </div>
                )}
                {/*
                  **会话粘滞要摆在明面上，因为它直接决定账单。**
                  关掉它，一次长会话每轮跳一家，prompt cache 全部失效，
                  而缓存命中与否成本差 5 到 10 倍（§3.5）。
                */}
                {g.kind === "轮流" && (
                  <label className="mt-1.5 flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                    <input
                      type="checkbox"
                      checked={g.session_affinity ?? true}
                      onChange={async (e) => {
                        if (!cfg?.version) {
                          setSaveError("还没读到配置版本，稍等一下再试");
                          return;
                        }
                        try {
                          await invoke("patch_config", {
                            ops: [
                              {
                                op: "replace",
                                path: `/groups/${g.name}/session_affinity`,
                                value: e.target.checked,
                              },
                            ],
                            baseVersion: cfg.version,
                          });
                          setSaveError(null);
                          setReloadKey((k) => k + 1);
                        } catch (err) {
                          setSaveError(typeof err === "string" ? err : String(err));
                        }
                      }}
                    />
                    会话粘滞（同一次对话固定走同一家）
                  </label>
                )}
                {g.hurts_cache && (
                  // 这句必须在界面上直说：它决定了用户的账单（§3.4）。
                  // 缓存命中与否成本差 5 到 10 倍，而为了省 20% 的单价
                  // 丢掉 90% 的缓存折扣，是一笔怎么算都不划算的账。
                  <p className="mt-1.5 text-amber-700 dark:text-amber-400">
                    ⚠ 这个策略会让 prompt cache 失效，长会话的成本会明显上升。
                    {g.kind === "轮流" ? "把上面那个粘滞打开就好。" : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {section === "gateway" && (
        <section>
          <h2 className="text-sm font-semibold">启动</h2>
          <label className="mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={autostart === true}
              disabled={autostart === null}
              onChange={async (e) => {
                const want = e.target.checked;
                setAutostartErr(null);
                // 先乐观地画上，失败再弹回去 —— 但**以后端返回的实际
                // 状态为准**，不是以这里传出去的那个为准。注册可能失败
                // （只读的 LaunchAgents 目录、权限），那时勾必须弹回去。
                setAutostart(want);
                try {
                  setAutostart(await invoke<boolean>("set_autostart", { on: want }));
                } catch (err) {
                  setAutostart(!want);
                  setAutostartErr(typeof err === "string" ? err : String(err));
                }
              }}
            />
            <span>
              <span className="text-neutral-800 dark:text-neutral-200">开机时自动启动</span>
              <span className="mt-0.5 block text-neutral-500">
                {/*
                  说清「默认是关的」和「勾了会发生什么」。一个装完就往
                  登录项里写东西的工具，用户第一次发现它是在系统设置里
                  看到一个自己没同意过的条目 —— 所以这里出厂不勾，而且
                  要讲清勾上之后系统设置里会多出什么。
                */}
                默认不开。勾上会在「系统设置 › 通用 › 登录项」里注册一条，
                开机后只有菜单栏多一个图标，不会弹窗口。
              </span>
            </span>
          </label>
          {autostartErr && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">
              {autostartErr}
            </p>
          )}
        </section>
      )}

      {section === "gateway" && (
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
      )}

      <Pricing />

      <Diagnostics />

      <Uninstall />
    </div>
  );
}

/**
 * 诊断包（§11 的 M6+）。
 *
 * 遇到问题时一次性交出「我这儿是什么情况」，省掉来回问一轮（版本？配置？
 * 哪家上游？）—— 而每一趟都可能问漏。
 *
 * **里面的东西全部脱敏过，但仍然要求用户自己看一眼再交出去。**我们是个
 * 看得见所有 API key 的网关，这一步值得多花十秒（§9.7）。
 */
function Diagnostics() {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-sm font-semibold">诊断包</h2>
      <p className="mt-1 text-xs text-neutral-500">
        版本、上游、熔断状态、最近的失败、脱敏之后的配置原文，攒成一个 Markdown 文件。
        不含请求体和响应体 —— 它们最有用也最危险。
      </p>
      <button
        className="mt-2 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setPath(await invoke<string>("save_diagnostics"));
          } catch (e) {
            // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
            setError(typeof e === "string" ? e : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "攒着…" : "生成"}
      </button>
      {error && <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">{error}</div>}
      {path && (
        <div className="mt-2 text-xs">
          写好了：<code className="break-all">{path}</code>
          <div className="mt-1 text-neutral-500">
            里面的密钥和地址都打过码了，但**交出去之前请自己扫一眼**。
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 完全卸载（§7.15 第二层的第三个入口）。
 *
 * **macOS 上删除应用没有卸载钩子。**拖进废纸篓就是拖进废纸篓，我们没有
 * 任何机会做清理 —— 而那时五个客户端的 `base_url` 全都指向一个已经没有
 * 东西在听的端口，所有 AI 客户端同时失效，用户很可能已经忘了是什么改的。
 *
 * 所以这个入口必须存在，而且要在他还没删应用的时候就看得见。
 *
 * 顺序是**先还原、再注销自启、最后才提删数据** —— 反过来的话，中途失败
 * 会留下一个「客户端还指着一个不在的端口」的状态，而那正是这一整节要
 * 防的事。
 */
function Uninstall() {
  const [step, setStep] = useState<"idle" | "ask" | "done">("idle");
  const [drop, setDrop] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (step === "done") {
    return (
      <section className="rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800">
        <h2 className="text-sm font-semibold">卸载完成</h2>
        <ul className="mt-2 space-y-0.5 text-neutral-600 dark:text-neutral-400">
          {log.map((l, i) => (
            <li key={i}>· {l}</li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-neutral-200 p-3 text-xs dark:border-neutral-800">
      <h2 className="text-sm font-semibold">完全卸载</h2>
      {step === "idle" ? (
        <div className="mt-1.5 flex items-start justify-between gap-4">
          <p className="text-neutral-500">
            把所有接管过的客户端改回原样、注销开机自启。
            <span className="font-medium">直接把应用拖进废纸篓不会做这些</span>
            —— 那时客户端会指着一个没有东西在听的端口。
          </p>
          <button
            onClick={() => setStep("ask")}
            className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >
            卸载…
          </button>
        </div>
      ) : (
        <div className="mt-1.5 space-y-2">
          <p className="text-neutral-600 dark:text-neutral-400">要做这几件事：</p>
          <ul className="space-y-0.5 text-neutral-600 dark:text-neutral-400">
            <li>· 把所有接管过的客户端改回接管之前的样子</li>
            <li>· 注销开机自启</li>
          </ul>
          <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={drop} onChange={(e) => setDrop(e.target.checked)} />
            {/* **默认不删。**请求历史和成本记录是用户自己的东西，而
                「删了才发现还想看」是不可逆的 */}
            连同数据目录一起删掉（请求历史、成本记录、配置备份）
          </label>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setLog(await invoke<string[]>("uninstall", { dropData: drop }));
                  setStep("done");
                } catch (e) {
                  setLog([typeof e === "string" ? e : String(e)]);
                  setStep("done");
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded bg-amber-600 px-2 py-1 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              确认卸载
            </button>
            <button
              onClick={() => setStep("idle")}
              className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
