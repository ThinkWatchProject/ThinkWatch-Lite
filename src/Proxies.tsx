import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tip } from "./ui/Tooltip";
import type { Overview, PatchOp } from "./types";

const KINDS: { id: string; label: string; what: string }[] = [
  {
    id: "socks5h",
    label: "SOCKS5h",
    what: "域名原样发给代理，由代理端解析 DNS。本地 DNS 不可信时这是唯一能用的一档。",
  },
  {
    id: "socks5",
    label: "SOCKS5",
    what: "本地解析 DNS，把 IP 发给代理。",
  },
  { id: "http", label: "HTTP", what: "" },
  { id: "https", label: "HTTPS", what: "" },
];

/**
 * 出站代理。
 *
 * **在此之前这一段完全没有入口。**上游表格里有一列「代理」,下拉的候选
 * 来自 `ov.proxies` —— 而那只是一个名字数组,代理本身没有任何界面能增删
 * 改。没手写过 `config.yaml` 的人,看到的是一个只有「直连」和「跟随系统」
 * 的下拉:**一个只能引用、无法创建的引用。**
 *
 * 密码这一栏是单向的:服务端只给「有没有认证」,不给内容 —— 这个视图会
 * 进日志、进诊断包、进用户贴出来的截图。所以界面上能设、能清,但设完就
 * 看不见了,和上游的 key 是同一条纪律。
 */
export default function Proxies({
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
  const [f, setF] = useState({ name: "", kind: "socks5h", addr: "", user: "", pass: "" });

  const proxies = ov.proxies ?? [];

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
    <section>
      <div className="flex items-baseline gap-3">
        <h2 className="tw-title font-semibold">代理</h2>
        <p className="tw-body text-neutral-500">
          声明一次，每个上游各自选用。
        </p>
        <button
          onClick={() => setAdding(true)}
          className="ml-auto rounded-md border border-neutral-300 px-2.5 py-1 tw-body dark:border-neutral-700"
        >
          新建
        </button>
      </div>

      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-neutral-300 p-3 dark:border-neutral-700">
          <div className="flex flex-wrap items-center gap-2 tw-body">
            <input
              autoFocus
              value={f.name}
              placeholder="名字，上游那边按它引用"
              onChange={(e) => setF({ ...f, name: e.target.value })}
              className="w-48 rounded border border-neutral-300 bg-transparent px-2 py-1 outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
              className="rounded border border-neutral-300 bg-transparent px-1.5 py-1 dark:border-neutral-700"
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <input
              value={f.addr}
              placeholder="127.0.0.1:1080"
              onChange={(e) => setF({ ...f, addr: e.target.value })}
              className="w-44 rounded border border-neutral-300 bg-transparent px-2 py-1 font-mono outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
          </div>
          {KINDS.find((k) => k.id === f.kind)?.what && (
            <p className="tw-body text-neutral-500">
              {KINDS.find((k) => k.id === f.kind)?.what}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 tw-body">
            <span className="text-neutral-500">认证（可不填）</span>
            <input
              value={f.user}
              placeholder="用户名"
              onChange={(e) => setF({ ...f, user: e.target.value })}
              className="w-32 rounded border border-neutral-300 bg-transparent px-2 py-1 outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <input
              type="password"
              value={f.pass}
              placeholder="密码"
              onChange={(e) => setF({ ...f, pass: e.target.value })}
              className="w-32 rounded border border-neutral-300 bg-transparent px-2 py-1 outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <Tip text="密码写进 config.yaml，和上游的 key 一样是明文。设完之后界面上就看不见它了 —— 这个页面会进日志和诊断包。">
              <span className="tw-label text-neutral-500 underline decoration-dotted underline-offset-2">
                写进配置文件
              </span>
            </Tip>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={busy === "new" || !f.name.trim() || !f.addr.trim()}
              onClick={async () => {
                if (proxies.some((p) => p.name === f.name.trim())) {
                  setErr(`已经有一个叫「${f.name.trim()}」的代理了`);
                  return;
                }
                const lines = [
                  `name: ${f.name.trim()}`,
                  `type: ${f.kind}`,
                  `addr: ${f.addr.trim()}`,
                ];
                if (f.user.trim() || f.pass) {
                  lines.push("auth:", `  user: ${f.user.trim()}`, `  pass: ${f.pass}`);
                }
                const ok = await patch(
                  [{ op: "append", path: "/proxies", item: lines.join("\n") }],
                  "new",
                );
                if (ok) {
                  setAdding(false);
                  setF({ name: "", kind: "socks5h", addr: "", user: "", pass: "" });
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
        </div>
      )}

      {proxies.length === 0 && !adding ? (
        <p className="mt-2 tw-body text-neutral-500">
          还没有代理。上游默认直连；要走代理先在这里建一个。
        </p>
      ) : (
        <table className="mt-3 w-full tw-body">
          <thead className="text-left text-neutral-500">
            <tr className="border-b border-neutral-200 dark:border-neutral-800">
              <th className="py-1.5 font-medium">名字</th>
              <th className="font-medium">类型</th>
              <th className="font-medium">地址</th>
              <th className="font-medium">认证</th>
              <th className="font-medium">在用</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {proxies.map((p) => (
              <tr
                key={p.name}
                className="border-b border-neutral-100 dark:border-neutral-900"
              >
                <td className="py-1.5 font-medium">{p.name}</td>
                <td className="font-mono text-neutral-500">{p.kind}</td>
                <td className="font-mono text-neutral-500">{p.addr}</td>
                <td className="text-neutral-500">{p.has_auth ? "有" : "—"}</td>
                <td className="text-neutral-500">
                  {p.used_by > 0 ? `${p.used_by} 家上游` : "没人用"}
                </td>
                <td className="text-right">
                  {/*
                    **还有上游在用就不给删。**删了之后那几家的 `proxy`
                    指向一个不存在的名字，配置整份加载失败 —— 网关起不来，
                    而用户看到的是「core 连续失败」，原因在三步之前。
                  */}
                  <Tip
                    text={
                      p.used_by > 0
                        ? `还有 ${p.used_by} 家上游在用它。先把它们改成别的，再删。`
                        : "删掉它。"
                    }
                  >
                    <button
                      disabled={busy === p.name || p.used_by > 0}
                      onClick={() =>
                        void patch([{ op: "remove", path: `/proxies/${p.name}` }], p.name)
                      }
                      className="rounded px-2 py-0.5 tw-label text-red-600 hover:underline disabled:opacity-30 dark:text-red-400"
                    >
                      删除
                    </button>
                  </Tip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {err && <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>}
    </section>
  );
}
