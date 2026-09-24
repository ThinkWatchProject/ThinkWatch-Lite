import { useState } from "react";
import { ActivityIcon } from "lucide-react";
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
import { Segmented } from "@/ui/segmented";
import { StatusDot, StatusLabel } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import type { L1Result, Overview, ProxyAuthInput, ProxyInput, ProxyView } from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { api } from "./api";
import { PROXY_KINDS, errorText, l1ErrorText } from "./labels";
import { DialogError, FormItem } from "./parts";
import { proxyDialogText } from "./ProxyDialog.i18n";
import { plain } from "@/i18n/core.i18n";

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
  configVersion: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(proxyDialogText);
  const common = useText(commonText);
  const editing: ProxyView | null =
    mode.kind === "edit" ? (ov.proxies.find((x) => x.name === mode.name) ?? null) : null;
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
      ? t.enterName
      : host.trim() === "" || port.trim() === ""
        ? t.enterAddress
        : auth && (!editing?.has_auth || replacing) && user.trim() === ""
          ? t.enterUser
          : null;

  async function runTest() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testProxy({ proxy: input(), current: editing?.name }));
    } catch (e) {
      setResult({ target: name, ok: false, segments: [], total_ms: 0, error: plain(errorText(e)) });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const save = { proxy: input(), base_version: configVersion };
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
      {/* 点到对话框外面不关：填了一半的表单不该因为一次误点丢掉。Esc、×、取消照常 */}
      <DialogContent className="flex flex-col gap-4 sm:max-w-[500px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tw-title">{editing ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>
            {editing && editing.used_by.length > 0
              ? t.usedBy(
                  editing.used_by.map((u, i) => (
                    <span key={u}>
                      {i > 0 && t.sep}
                      <span className="font-mono text-foreground">{u}</span>
                    </span>
                  )),
                )
              : t.desc}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <FormItem label={t.name} htmlFor="px-name">
            <Input
              id="px-name"
              className="font-mono"
              value={name}
              placeholder={t.namePlaceholder}
              onChange={(e) => setName(e.target.value)}
            />
          </FormItem>
          <FormItem label={t.kind} desc={PROXY_KINDS.find((k) => k.id === kind)?.desc}>
            <Segmented
              value={kind}
              options={PROXY_KINDS.map((k) => ({ id: k.id, label: k.label }))}
              onChange={setKind}
            />
          </FormItem>
          <FormItem label={t.address} htmlFor="px-host">
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
                aria-label={t.port}
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
            {t.needsAuth}
          </label>
          {auth &&
            (editing?.has_auth && !replacing ? (
              <FormItem label={t.credentials} desc={t.credentialsDesc}>
                <div className="flex items-center gap-2">
                  <Input readOnly value={t.credentialsSet} className="text-muted-foreground" />
                  <Button variant="outline" onClick={() => setReplacing(true)}>
                    {t.replace}
                  </Button>
                </div>
              </FormItem>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <FormItem label={t.user} htmlFor="px-user">
                  <Input
                    id="px-user"
                    autoComplete="off"
                    className="font-mono"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                  />
                </FormItem>
                <FormItem label={t.pass} htmlFor="px-pass">
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
            <Button variant="outline" size="sm" onClick={runTest} pending={testing} disabled={missing != null}>
              {!testing && <ActivityIcon />}
              {t.check}
            </Button>
            {testing ? (
              <StatusLabel tone="pending" muted>
                {t.checking}
              </StatusLabel>
            ) : result ? (
              result.ok ? (
                <StatusLabel tone="ok" className="motion-fade">
                  {t.ok(auth, result.total_ms)}
                </StatusLabel>
              ) : (
                // 失败的原因可能很长（卡在哪一步、为什么）：折行写全，不截断
                <p className="flex min-w-0 flex-1 items-start gap-1.5 tw-body text-destructive motion-fade">
                  <StatusDot tone="error" className="mt-[7px]" />
                  <span className="min-w-0 break-words">{l1ErrorText(result)}</span>
                </p>
              )
            ) : (
              <span className="tw-label text-muted-foreground">{t.checkHint}</span>
            )}
          </div>
        </div>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button onClick={save} pending={saving} disabled={missing != null}>
            {editing ? common.save : t.create}
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
