import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tip } from "./ui/Tooltip";
import { Dialog } from "./ui/Dialog";
import type { Overview, PatchOp, RouteView } from "./types";

/**
 * 路由。
 *
 * **一条路由是一组按顺序求值的规则,一把密钥绑一条。**默认路由是
 * 「没绑定时走的那条」,不是「所有人都要过的那条」—— 这个区别是整个
 * 模型的支点:前者意味着求值永远只看一张规则表。
 *
 * 在此之前这一页只能看不能建:`to` 能通过策略组的下拉改,而 `when` 的
 * 十三个条件、`set`、`deny`、`guard` 全部只读,新建一条规则更无从谈起。
 * **一个只能查看的路由页,等于没有路由这个功能。**
 */
export default function Routes({
  ov,
  configVersion,
  onChanged,
}: {
  ov: Overview;
  configVersion: string | null;
  onChanged: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<RouteView | null>(null);
  const [addRuleTo, setAddRuleTo] = useState<string | null>(null);

  const routes = ov.routes ?? [];
  const defaultRoute = ov.default_route ?? "默认";
  const targets = [
    ...ov.groups.map((g) => [g.name, `${g.name}（组）`] as const),
    ...ov.providers.map((p) => [p.name, p.name] as const),
  ];

  async function patch(ops: PatchOp[], tag: string) {
    if (!configVersion) {
      setErr("还没读到配置版本，稍等一下再试");
      return false;
    }
    setBusy(tag);
    setErr(null);
    try {
      await invoke("patch_config", { ops, baseVersion: configVersion });
      onChanged();
      return true;
    } catch (e) {
      setErr(typeof e === "string" ? e : String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-5">
      {/*
        默认路由单独一块,因为它在模型里就是单独的一个字段
        （顶层的 `default_route`）—— 不是某条路由身上的标志。
      */}
      <section className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-baseline gap-3">
          <h3 className="tw-head">默认路由</h3>
          <select
            value={defaultRoute}
            disabled={busy === "default"}
            onChange={(e) =>
              void patch(
                [{ op: "replace", path: "/default_route", value: e.target.value }],
                "default",
              )
            }
            className="rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 tw-body disabled:opacity-50 dark:border-neutral-700"
          >
            {routes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
          <p className="tw-body text-neutral-500">
            没绑路由的密钥走这条。<b>不是所有人都要过的那条。</b>
          </p>
        </div>
      </section>

      <section>
        <div className="flex items-baseline gap-3">
          <h2 className="tw-title font-semibold">路由</h2>
          <p className="tw-body text-neutral-500">
            一条路由里，从上往下匹配，第一条命中的决定去向。
          </p>
          <button
            onClick={() => setAdding(true)}
            className="ml-auto rounded-md border border-neutral-300 px-2.5 py-1 tw-body dark:border-neutral-700"
          >
            新建路由
          </button>
        </div>

        {adding && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-neutral-300 p-2 dark:border-neutral-700">
            <input
              autoFocus
              value={newName}
              placeholder="路由名，比如 长上下文"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAdding(false);
              }}
              className="flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 tw-body outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <button
              disabled={busy === "new" || !newName.trim()}
              onClick={async () => {
                const n = newName.trim();
                if (routes.some((r) => r.name === n)) {
                  setErr(`已经有一条叫「${n}」的路由了`);
                  return;
                }
                // **新路由带一条兜底规则。**空路由是个合法但没用的状态：
                // 绑上它的密钥会一条规则都匹配不到，请求全部失败，而
                // 配置看起来是好的。
                const first = targets[0]?.[0];
                if (!first) {
                  setErr("还没有任何上游 —— 先去「网关」加一个。");
                  return;
                }
                const ok = await patch(
                  [
                    {
                      op: "append",
                      path: "/routes",
                      item: `name: ${n}\nrules:\n  - name: 兜底\n    to: ${first}`,
                    },
                  ],
                  "new",
                );
                if (ok) {
                  setAdding(false);
                  setNewName("");
                }
              }}
              className="rounded-md bg-neutral-900 px-2.5 py-1 tw-body text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              建
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-md px-2.5 py-1 tw-body text-neutral-500"
            >
              取消
            </button>
          </div>
        )}

        <div className="mt-3 space-y-3">
          {routes.map((r) => (
            <div
              key={r.name}
              className="rounded-lg border border-neutral-200 dark:border-neutral-800"
            >
              <div className="flex items-baseline gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
                <span className="tw-head">{r.name}</span>
                {r.default && (
                  <span className="rounded bg-neutral-200 px-1.5 tw-label dark:bg-neutral-800">
                    默认
                  </span>
                )}
                <span className="tw-label text-neutral-500">
                  {/*
                    绑了这条的密钥。默认路由这里通常是空的 —— 走它的人是
                    「没绑」,不是「绑了它」。把这件事说出来,否则空白读起来
                    像是「没人用」。
                  */}
                  {r.clients.length > 0
                    ? `${r.clients.join("、")} 绑了它`
                    : r.default
                      ? "没绑路由的密钥走它"
                      : "还没有密钥绑它"}
                </span>
                <button
                  onClick={() => setAddRuleTo(r.name)}
                  className="ml-auto rounded px-2 py-0.5 tw-label text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  加规则
                </button>
                <Tip
                  text={
                    r.default
                      ? "默认路由删不了 —— 没绑路由的密钥要走它。先把默认换成别的。"
                      : r.clients.length > 0
                        ? `还有 ${r.clients.length} 把密钥绑着它，删了它们会退回默认路由。`
                        : "删掉这条路由。"
                  }
                >
                  <button
                    disabled={r.default}
                    onClick={() => setConfirmDelete(r)}
                    className="rounded px-2 py-0.5 tw-label text-red-600 hover:underline disabled:opacity-30 dark:text-red-400"
                  >
                    删除
                  </button>
                </Tip>
              </div>

              {addRuleTo === r.name && (
                <NewRule
                  route={r.name}
                  targets={targets}
                  busy={busy === `rule-${r.name}`}
                  onCancel={() => setAddRuleTo(null)}
                  onCreate={async (item) => {
                    const ok = await patch(
                      [{ op: "append", path: `/routes/${r.name}/rules`, item }],
                      `rule-${r.name}`,
                    );
                    if (ok) setAddRuleTo(null);
                  }}
                />
              )}

              <ol className="divide-y divide-neutral-100 dark:divide-neutral-900">
                {r.rules.map((rule, i) => (
                  <li
                    key={rule.name}
                    className="flex items-baseline gap-3 px-3 py-1.5 tw-body"
                  >
                    <span className="w-4 shrink-0 text-neutral-400">{i + 1}</span>
                    <span className="font-medium">{rule.name}</span>
                    <span className="text-neutral-500">
                      {rule.conditions.length === 0 ? (
                        // 兜底规则要标出来。少了它，用户会以为「没有兜底」
                        // 而反复调试一条其实一直在生效的规则。
                        <span className="rounded bg-neutral-200 px-1.5 py-0.5 dark:bg-neutral-800">
                          兜底
                        </span>
                      ) : (
                        rule.conditions.join(" 且 ")
                      )}
                    </span>
                    <span className="ml-auto font-mono text-neutral-500">
                      → {rule.to}
                    </span>
                    <button
                      disabled={busy === `rule-${r.name}`}
                      onClick={() =>
                        void patch(
                          [{ op: "remove", path: `/routes/${r.name}/rules/${rule.name}` }],
                          `rule-${r.name}`,
                        )
                      }
                      className="rounded px-1.5 tw-label text-red-600 hover:underline disabled:opacity-30 dark:text-red-400"
                    >
                      删
                    </button>
                  </li>
                ))}
                {r.rules.length === 0 && (
                  <li className="px-3 py-2 tw-body text-amber-700 dark:text-amber-400">
                    这条路由一条规则都没有。绑上它的密钥会匹配不到任何规则，请求全部失败。
                  </li>
                )}
              </ol>
            </div>
          ))}
        </div>

        {err && <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>}
      </section>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        danger
        title={`删掉路由「${confirmDelete?.name}」？`}
        description={
          confirmDelete && confirmDelete.clients.length > 0
            ? `${confirmDelete.clients.join("、")} 绑着它，删掉之后它们会退回默认路由。`
            : "这条路由没有密钥绑着，删掉不影响任何请求。"
        }
        footer={
          <>
            <button
              onClick={() => setConfirmDelete(null)}
              className="rounded-md border border-neutral-300 px-3 py-1 tw-body dark:border-neutral-700"
            >
              取消
            </button>
            <button
              onClick={() => {
                const r = confirmDelete;
                setConfirmDelete(null);
                if (!r) return;
                // 先解绑，再删路由 —— **一次写入**。反过来的话，中间那一刻
                // 配置里有一把绑着不存在路由的密钥，而那是加载不了的。
                const ops: PatchOp[] = [
                  ...r.clients.map(
                    (c): PatchOp => ({
                      op: "replace",
                      path: `/clients/${c}/route`,
                      value: null,
                    }),
                  ),
                  { op: "remove", path: `/routes/${r.name}` },
                ];
                void patch(ops, r.name);
              }}
              className="rounded-md bg-red-600 px-3 py-1 tw-body text-white"
            >
              删除
            </button>
          </>
        }
      />
    </div>
  );
}

/**
 * 加一条规则。
 *
 * **只放最常用的三个条件**（模型、是否带工具、输入长度）。`when` 一共
 * 十三个维度，全铺开是一张没人读得完的表 —— 而剩下那些在文本模式里写
 * 一行就完事。这里要解决的是「新建一条规则」这件事本身不可能，不是
 * 「每个条件都得有个控件」。
 */
function NewRule({
  route,
  targets,
  busy,
  onCancel,
  onCreate,
}: {
  route: string;
  targets: readonly (readonly [string, string])[];
  busy: boolean;
  onCancel: () => void;
  onCreate: (item: string) => void;
}) {
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [tools, setTools] = useState(false);
  const [tokens, setTokens] = useState("");
  const [to, setTo] = useState(targets[0]?.[0] ?? "");

  function build(): string {
    const when: string[] = [];
    if (model.trim()) when.push(`model: "${model.trim()}"`);
    if (tools) when.push("tools: true");
    if (tokens.trim()) when.push(`input_tokens: "${tokens.trim()}"`);
    const lines = [`name: ${name.trim()}`];
    if (when.length > 0) lines.push(`when: { ${when.join(", ")} }`);
    lines.push(`to: ${to}`);
    return lines.join("\n");
  }

  return (
    <div className="space-y-2 border-b border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex flex-wrap items-center gap-2 tw-body">
        <input
          autoFocus
          value={name}
          placeholder="规则名，比如 超长上下文降级"
          onChange={(e) => setName(e.target.value)}
          className="min-w-52 flex-1 rounded border border-neutral-300 bg-transparent px-2 py-1 outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <span className="text-neutral-500">去向</span>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 dark:border-neutral-700"
        >
          {targets.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 tw-body">
        <span className="text-neutral-500">当</span>
        <input
          value={model}
          placeholder="模型 glob，比如 claude-opus-*"
          onChange={(e) => setModel(e.target.value)}
          className="w-52 rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <input
          value={tokens}
          placeholder="输入长度，比如 >200k"
          onChange={(e) => setTokens(e.target.value)}
          className="w-40 rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono outline-none focus:border-neutral-500 dark:border-neutral-700"
        />
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={tools}
            onChange={(e) => setTools(e.target.checked)}
          />
          带工具调用
        </label>
        <Tip text="三个条件都留空就是一条兜底规则 —— 它会命中这条路由里所有还没被上面的规则拦下的请求。每条路由都该有一条。">
          <span className="tw-label text-neutral-500 underline decoration-dotted underline-offset-2">
            都留空 = 兜底
          </span>
        </Tip>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-neutral-200/60 px-2 py-1 font-mono tw-label text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          {route} ／ {build().replace(/\n/g, "  ")}
        </code>
        <button
          disabled={busy || !name.trim() || !to}
          onClick={() => onCreate(build())}
          className="rounded-md bg-neutral-900 px-2.5 py-1 tw-body text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          加上
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 tw-body text-neutral-500"
        >
          取消
        </button>
      </div>
    </div>
  );
}
