import { useState } from "react";
import { ActivityIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import type { L1Result, Overview, ProxyAuthInput, ProxyInput, ProxyView } from "@/types";
import { api } from "./api";
import { PROXY_KINDS, errorText } from "./labels";
import { FormItem, Segmented, StatusDot } from "./parts";

export type ProxyDialogMode = { kind: "create" } | { kind: "edit"; name: string };

/**
 * 新建与编辑出站代理。
 *
 * **编辑时认证不回显。**视图里没有用户名和密码 —— 用户名也是凭据的一半。
 * 不动认证就保持原样；点「更换」才填新的。
 */
export function ProxyDialog({
  mode,
  ov,
  configVersion,
  onClose,
  onSaved,
}: {
  mode: ProxyDialogMode;
  ov: Overview;
  configVersion: string | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const editing: ProxyView | null =
    mode.kind === "edit" ? ((ov.proxies ?? []).find((x) => x.name === mode.name) ?? null) : null;
  const [host0, port0] = splitAddr(editing?.addr ?? "");
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState(editing?.kind ?? "socks5h");
  const [host, setHost] = useState(host0);
  const [port, setPort] = useState(port0);
  const [auth, setAuth] = useState(editing?.has_auth ?? false);
  /** 编辑时点过「更换」没有 */
  const [replacing, setReplacing] = useState(!editing?.has_auth);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<L1Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function input(): ProxyInput {
    let a: ProxyAuthInput;
    if (!auth) a = { mode: "none" };
    else if (editing?.has_auth && !replacing) a = { mode: "keep" };
    else a = { mode: "set", user, pass };
    return { name, kind, addr: `${host.trim()}:${port.trim()}`, auth: a };
  }

  const missing =
    name.trim() === ""
      ? "填写名称"
      : host.trim() === "" || port.trim() === ""
        ? "填写地址与端口"
        : auth && (!editing?.has_auth || replacing) && user.trim() === ""
          ? "填写用户名"
          : null;

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testProxy({ proxy: input(), current: editing?.name }));
    } catch (e) {
      setResult({ target: name, ok: false, segments: [], total_ms: 0, error: errorText(e) });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const save = { proxy: input(), base_version: configVersion ?? undefined };
      if (editing) await api.updateProxy(editing.name, save);
      else await api.createProxy(save);
      onSaved(name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  if (mode.kind === "edit" && !editing) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{editing ? "编辑代理" : "新建代理"}</DialogTitle>
          <DialogDescription>
            {editing && editing.used_by.length > 0 ? (
              <>
                被{" "}
                {editing.used_by.map((u, i) => (
                  <span key={u}>
                    {i > 0 && "、"}
                    <span className="font-mono text-foreground">{u}</span>
                  </span>
                ))}{" "}
                使用
              </>
            ) : (
              "上游通过代理连接时，检测连接、链路测速与转发经过同一代理。"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FormItem label="名称" htmlFor="px-name">
            <Input
              id="px-name"
              className="font-mono"
              value={name}
              placeholder="例如 hk-socks"
              onChange={(e) => setName(e.target.value)}
            />
          </FormItem>
          <FormItem label="类型" desc={PROXY_KINDS.find((k) => k.id === kind)?.desc}>
            <Segmented
              value={kind}
              options={PROXY_KINDS.map((k) => ({ id: k.id, label: k.label }))}
              onChange={setKind}
            />
          </FormItem>
          <FormItem label="地址" htmlFor="px-host">
            <div className="flex items-center gap-2">
              <Input
                id="px-host"
                className="font-mono"
                value={host}
                placeholder="127.0.0.1"
                onChange={(e) => setHost(e.target.value)}
              />
              <span className="text-muted-foreground">:</span>
              <Input
                aria-label="端口"
                className="w-24 flex-none font-mono"
                inputMode="numeric"
                value={port}
                placeholder="7890"
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </FormItem>
          <label className="flex items-center gap-2.5 tw-body font-medium">
            <Switch checked={auth} onCheckedChange={setAuth} />
            需要认证
          </label>
          {auth &&
            (editing?.has_auth && !replacing ? (
              <FormItem label="用户名与密码" desc="认证信息不回显。更换后原认证信息将被替换。">
                <div className="flex items-center gap-2">
                  <Input readOnly value="已设置" className="text-muted-foreground" />
                  <Button variant="outline" onClick={() => setReplacing(true)}>
                    更换
                  </Button>
                </div>
              </FormItem>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <FormItem label="用户名" htmlFor="px-user">
                  <Input
                    id="px-user"
                    autoComplete="off"
                    className="font-mono"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                  />
                </FormItem>
                <FormItem label="密码" htmlFor="px-pass">
                  <Input
                    id="px-pass"
                    type="password"
                    autoComplete="off"
                    className="font-mono"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                  />
                </FormItem>
              </div>
            ))}
          <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border p-3">
            <Button variant="outline" size="sm" onClick={runTest} disabled={testing || missing != null}>
              {testing ? <Spinner /> : <ActivityIcon />}
              检测代理
            </Button>
            {result ? (
              result.ok ? (
                <StatusDot tone="ok">
                  连接正常 · {auth ? "认证通过 · " : ""}响应 {result.total_ms.toLocaleString()} ms
                </StatusDot>
              ) : (
                <StatusDot tone="bad">{result.error ?? "无法连接"}</StatusDot>
              )
            ) : (
              <span className="tw-label text-muted-foreground">
                完成代理握手与认证。不产生费用。
              </span>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={saving || missing != null}>
            {saving && <Spinner />}
            {editing ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** `host:port` 拆开。IPv6 带方括号的整段留在 host 里 */
function splitAddr(addr: string): [string, string] {
  const i = addr.lastIndexOf(":");
  if (i <= 0) return [addr, ""];
  return [addr.slice(0, i), addr.slice(i + 1)];
}
