import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tip } from "@/ui/tip";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import type { Overview, PatchOp } from "./types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

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
        <p className="tw-body text-muted-foreground">
          声明一次，每个上游各自选用。
        </p>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => setAdding(true)}>
          新建
        </Button>
      </div>

      {adding && (
        <div className="mt-3 space-y-2 rounded-md border border-input p-3">
          <div className="flex flex-wrap items-center gap-2 tw-body">
            <Input
              className="w-48"
              autoFocus
              value={f.name}
              placeholder="名字，上游那边按它引用"
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
            <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v })}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {KINDS.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              className="w-44 font-mono"
              value={f.addr}
              placeholder="127.0.0.1:1080"
              onChange={(e) => setF({ ...f, addr: e.target.value })}
            />
          </div>
          {KINDS.find((k) => k.id === f.kind)?.what && (
            <p className="tw-body text-muted-foreground">
              {KINDS.find((k) => k.id === f.kind)?.what}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 tw-body">
            <span className="text-muted-foreground">认证（可不填）</span>
            <Input
              className="w-32"
              value={f.user}
              placeholder="用户名"
              onChange={(e) => setF({ ...f, user: e.target.value })}
            />
            <Input
              className="w-32"
              type="password"
              value={f.pass}
              placeholder="密码"
              onChange={(e) => setF({ ...f, pass: e.target.value })}
            />
            <Tip text="密码写进 config.yaml，和上游的 key 一样是明文。设完之后界面上就看不见它了 —— 这个页面会进日志和诊断包。">
              <span className="tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
                写进配置文件
              </span>
            </Tip>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
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
            >
              建
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {proxies.length === 0 && !adding ? (
        <p className="mt-2 tw-body text-muted-foreground">
          还没有代理。上游默认直连；要走代理先在这里建一个。
        </p>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead>名字</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>地址</TableHead>
              <TableHead>认证</TableHead>
              <TableHead>在用</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proxies.map((p) => (
              <TableRow
                key={p.name}
              >
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{p.kind}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{p.addr}</TableCell>
                <TableCell className="text-muted-foreground">{p.has_auth ? "有" : "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {p.used_by > 0 ? `${p.used_by} 家上游` : "没人用"}
                </TableCell>
                <TableCell className="text-right">
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
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={busy === p.name || p.used_by > 0}
                      onClick={() =>
                        void patch([{ op: "remove", path: `/proxies/${p.name}` }], p.name)
                      }>
                      删除
                    </Button>
                  </Tip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {err && <p className="mt-2 tw-body text-red-600 dark:text-red-400">{err}</p>}
    </section>
  );
}
