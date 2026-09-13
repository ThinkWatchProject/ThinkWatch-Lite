import { useCallback, useEffect, useState } from "react";
import { Tip } from "./ui/Tooltip";
import { invoke } from "@tauri-apps/api/core";
import type { PriceRow, PricingView, UpdateOffer, UpdatePreview } from "./types";

/**
 * 自定义价格（§4.3.0 的第三层）。
 *
 * **中转站的价格和官方不同，而没有任何公开数据集会收录它们** —— 这一层
 * 是必需的，而在此之前它只能靠用户手写 `~/.thinkwatch/pricing.yaml`。
 *
 * # 这一页什么时候出现
 *
 * **有算不出价钱的请求时才展开。**用户不会主动想起要配价格 —— 只有
 * 「最近 7 天有 37 条请求算不出钱，用的是这两个模型」这种具体证据才会
 * （§0.6：高级功能的触发条件要绑在「这个问题存不存在」上，不绑在数量上）。
 * 没有这个问题时它就是一行折叠起来的小字，说一句「都能算出价钱」。
 *
 * # 单位
 *
 * **每百万 token 的美元，和厂商定价页上印的一样。**让用户填 `0.000003`
 * 是在要求他做一次换算，而换算是会错的 —— 差一个数量级的价格，比没有
 * 价格更糟，因为它看起来是个确定的数字。
 */
export default function Pricing() {
  const [data, setData] = useState<PricingView | null>(null);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  /**
   * 「检查价格更新」走到哪一步了（§4.3.0、§12）。
   *
   * **三步，不是一步。**一步意味着「检查」和「写入」是同一次点击，
   * 而那正是「静默下载」的定义 —— §12 承诺零上传，那也意味着零静默
   * 下载。用户要先看见「要连哪儿、多大」，再看见「变了什么」，才轮到
   * 「写进去」。
   */
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [step, setStep] = useState<"idle" | "offering" | "fetching" | "applying">("idle");

  const load = useCallback(async () => {
    try {
      const d = await invoke<PricingView>("pricing");
      setData(d);
      setRows(d.rows);
      setErr(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      setErr(typeof e === "string" ? e : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;
  const dirty = JSON.stringify(rows) !== JSON.stringify(data.rows);
  const problem = data.unpriced_recent > 0;

  async function save() {
    setBusy(true);
    try {
      const d = await invoke<PricingView>("save_pricing", { rows });
      setData(d);
      setRows(d.rows);
      setErr(null);
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-neutral-200 p-3 tw-body dark:border-neutral-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="tw-title font-semibold">自定义价格</h2>
          {problem ? (
            // **具体证据，不是功能介绍**（§0.6）
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              最近 7 天有 {data.unpriced_recent} 条请求算不出价钱
              {data.unpriced_models.length > 0 && (
                <>
                  ，用的是{" "}
                  <span className="font-mono">{data.unpriced_models.slice(0, 3).join("、")}</span>
                  {data.unpriced_models.length > 3 ? " 等" : ""}
                </>
              )}
              。填上单价，成本栏就能算出来了。
            </p>
          ) : (
            <p className="mt-1 text-neutral-500">
              经过的请求都能算出价钱。内置价目表是 {data.snapshot_date} 那份快照。
            </p>
          )}
        </div>
        <button
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {open ? "收起" : rows.length > 0 ? `${rows.length} 条自定义` : "加一条"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-neutral-500">
            单价按<span className="font-medium">每百万 token 的美元</span>填，和厂商定价页一致。
            <Tip text="留空上游对所有上游生效；填了上游则只有那一家按这个价算。">
              <span className="ml-1 underline decoration-dotted underline-offset-2">上游这一列</span>
            </Tip>
          </p>
          <table className="w-full text-left tw-num">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className="py-1 font-medium">上游</th>
                <th className="font-medium">模型</th>
                <th className="font-medium">输入 $/M</th>
                <th className="font-medium">输出 $/M</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className="py-1">
                    <Cell
                      value={r.provider ?? ""}
                      placeholder="（所有）"
                      onChange={(v) =>
                        setRows(rows.map((x, j) => (j === i ? { ...x, provider: v || null } : x)))
                      }
                    />
                  </td>
                  <td>
                    <Cell
                      mono
                      value={r.model}
                      placeholder="模型名"
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, model: v } : x)))}
                    />
                    {/* **「覆盖」和「补一个」是两件事** —— 前者要让用户
                        知道他在推翻一个已有的价 */}
                    {r.overrides_builtin && (
                      <span className="ml-1 tw-label text-neutral-400">覆盖内置</span>
                    )}
                  </td>
                  <td>
                    <Num
                      value={r.input}
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, input: v } : x)))}
                    />
                  </td>
                  <td>
                    <Num
                      value={r.output}
                      onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, output: v } : x)))}
                    />
                  </td>
                  <td className="text-right">
                    <Tip text="删掉这一条自定义价格">
                      <button
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        className="text-neutral-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </Tip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    provider: null,
                    // 有算不出价的模型时直接填上第一个 —— 用户不用自己抄
                    model: data.unpriced_models[0] ?? "",
                    input: 0,
                    output: 0,
                    overrides_builtin: false,
                  },
                ])
              }
              className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              加一条
            </button>
            <button
              onClick={save}
              disabled={busy || !dirty}
              className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {busy ? "保存中…" : "保存"}
            </button>
            {dirty && <span className="text-neutral-500">有未保存的改动</span>}
          </div>
          <p className="text-neutral-500">
            写进 <code>pricing.yaml</code>，和 <code>config.yaml</code> 放在一起。手改那个文件也可以，它只是一份普通 YAML。
          </p>
        </div>
      )}

      {/*
        检查价格更新（§4.3.0 第二层）。**绝不在启动时后台偷偷拉** ——
        §12 承诺了零上传，那也意味着零静默下载。
      */}
      <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
        {!offer && !preview && (
          <div className="flex items-center gap-2">
            <button
              disabled={step !== "idle"}
              onClick={async () => {
                setStep("offering");
                try {
                  setOffer(await invoke<UpdateOffer>("update_offer"));
                  setErr(null);
                } catch (e) {
                  setErr(typeof e === "string" ? e : String(e));
                } finally {
                  setStep("idle");
                }
              }}
              className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              {step === "offering" ? "查询中…" : "检查价格更新"}
            </button>
            <span className="text-neutral-500">
              内置的是 {data.snapshot_date} 那份。不会自动检查。
            </span>
          </div>
        )}

        {offer && !preview && (
          <div className="space-y-1.5">
            {/* **先说要连哪儿、多大。**这是零静默下载里最容易被省掉的一半 */}
            <p className="text-neutral-600 dark:text-neutral-400">
              要访问：<code className="font-mono">{offer.url}</code>
            </p>
            <p className="text-neutral-500">
              大小 {offer.bytes ? `${(offer.bytes / 1024 / 1024).toFixed(1)} MB` : "对面没说"}
              ；下载后先显示变更，确认才写入。
            </p>
            <div className="flex gap-2">
              <button
                disabled={step !== "idle"}
                onClick={async () => {
                  setStep("fetching");
                  try {
                    setPreview(await invoke<UpdatePreview>("update_fetch"));
                    setErr(null);
                  } catch (e) {
                    setErr(typeof e === "string" ? e : String(e));
                  } finally {
                    setStep("idle");
                  }
                }}
                className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {step === "fetching" ? "下载中…" : "下载并对比"}
              </button>
              <button
                onClick={() => setOffer(null)}
                className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                算了
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div className="space-y-1.5">
            <p className="text-neutral-600 dark:text-neutral-400">
              拉回来 {preview.models} 个带价的模型，
              {preview.changes.length === 0 ? (
                <span className="font-medium">和现在这份没有差别</span>
              ) : (
                <>
                  其中 <span className="font-medium">{preview.changes.length}</span> 个和现在不一样
                </>
              )}
              。
            </p>
            {preview.changes.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border border-neutral-200 dark:border-neutral-800">
                <table className="w-full text-left tw-num">
                  <tbody>
                    {preview.changes.map((c) => (
                      <tr key={c.model} className="border-b border-neutral-100 last:border-0 dark:border-neutral-900">
                        <td className="px-2 py-0.5 font-mono">{c.model}</td>
                        <td className="px-2 text-neutral-500">
                          {c.old_input === null ? (
                            "新增"
                          ) : (
                            <>
                              入 {(c.old_input * 1e6).toFixed(2)} → {(c.new_input * 1e6).toFixed(2)}
                              ，出 {((c.old_output ?? 0) * 1e6).toFixed(2)} →{" "}
                              {(c.new_output * 1e6).toFixed(2)}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex gap-2">
              <button
                disabled={step !== "idle"}
                onClick={async () => {
                  setStep("applying");
                  try {
                    const d = await invoke<PricingView>("update_apply", { token: preview.token });
                    setData(d);
                    setRows(d.rows);
                    setPreview(null);
                    setOffer(null);
                    setErr(null);
                  } catch (e) {
                    setErr(typeof e === "string" ? e : String(e));
                  } finally {
                    setStep("idle");
                  }
                }}
                className="rounded bg-neutral-900 px-2 py-1 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
              >
                {step === "applying" ? "写入中…" : "确认更新"}
              </button>
              <button
                onClick={() => {
                  setPreview(null);
                  setOffer(null);
                }}
                className="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                不更新
              </button>
            </div>
            <p className="text-neutral-500">
              你的自定义价格不受影响，更新只换底下那份公共价目表。
            </p>
          </div>
        )}
      </div>

      {err && <p className="mt-2 text-amber-700 dark:text-amber-400">{err}</p>}
    </section>
  );
}

function Cell({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      // macOS 会把首字母大写，而模型名是大小写敏感的（§9.7）
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className={
        "w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 " +
        "hover:border-neutral-300 focus:border-neutral-400 focus:outline-none " +
        "dark:hover:border-neutral-700 dark:focus:border-neutral-600 " +
        (mono ? "font-mono" : "")
      }
    />
  );
}

/** 数字格。**空串不等于 0** —— 但保存时要是个数，所以空的按 0 走。 */
function Num({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      value={text}
      inputMode="decimal"
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 text-right font-mono hover:border-neutral-300 focus:border-neutral-400 focus:outline-none dark:hover:border-neutral-700 dark:focus:border-neutral-600"
    />
  );
}
