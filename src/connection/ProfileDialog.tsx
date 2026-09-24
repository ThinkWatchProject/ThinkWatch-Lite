import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { FormRow, FormRows } from "@/settings/form";
import { clientGateway, connApi, type ConnectError, type Invalid, type Profile, type ServerInfo } from "./api";
import { connText } from "./connection.i18n";
import { code, describeError } from "./describe";

/** 密钥：64 位十六进制。和 Rust 那边 `secrets::normalize` 同一条规矩 */
const KEY_RE = /^[0-9a-fA-F]{64}$/;

/**
 * 添加、编辑一条远程连接（设计稿 ③）。
 *
 * **编辑时密钥不回显。**它存在这台电脑上，界面拿不回来：显示「已保存」，点
 * 「更换」才填新的；不换就沿用。
 *
 * 「保存并切换」**先试连**，没通过就停在这里显示原因，不存也不切。通过了才存，
 * 然后交给切换确认（④）—— 那一步要说哪些客户端还指着本机。
 */
export function ProfileDialog({
  editing,
  isCurrent,
  onClose,
  onSaved,
}: {
  /** 编辑的那一条；新建时是 null */
  editing: Profile | null;
  /** 编辑的是当前连着的那一条：没有「保存并切换」，存完就按新的地址重连 */
  isCurrent: boolean;
  onClose: () => void;
  /** 存好了。`andSwitch`：点的是「保存并切换」，带着刚才试连的结果 */
  onSaved: (p: Profile, andSwitch: ServerInfo | null) => void;
}) {
  const t = useText(connText);
  const common = useText(commonText);
  const [name, setName] = useState(editing?.name ?? "");
  const [host, setHost] = useState(editing?.host ?? "");
  const [port, setPort] = useState(editing?.port != null ? String(editing.port) : "");
  /** 编辑时点过「更换」没有 */
  const [replacing, setReplacing] = useState(editing === null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | "switch" | null>(null);
  const [result, setResult] = useState<
    { ok: true; info: ServerInfo } | { ok: false; error: ConnectError } | null
  >(null);
  const [invalid, setInvalid] = useState<Invalid | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portNum = Number(port.trim());
  const portOk = /^\d+$/.test(port.trim()) && portNum >= 1 && portNum <= 65535;
  const keyOk = !replacing || KEY_RE.test(key.trim());
  /** 还差什么。页脚左边那一句，和别的对话框一个样 */
  const missing =
    name.trim() === ""
      ? t.enterName
      : host.trim() === ""
        ? t.enterHost
        : !portOk
          ? t.badPort
          : replacing && key.trim() === ""
            ? t.enterKey
            : !keyOk
              ? t.badKey
              : null;
  /** Rust 那边查出来的（重名、地址格式） */
  const refusals: Record<string, string> = {
    "name:taken": t.nameTaken,
    "name:empty": t.enterName,
    "host:invalid": t.badHost,
    "port:invalid": t.badPort,
    "key:invalid": t.badKey,
    "key:empty": t.enterKey,
  };
  const refused = invalid && (refusals[`${invalid.field}:${invalid.reason}`] ?? t.badHost);

  function input() {
    return {
      id: editing?.id ?? null,
      name: name.trim(),
      host: host.trim(),
      port: portNum,
      key: replacing ? key.trim() : null,
    };
  }

  // 改了哪一格，上一次的结果就不作数了
  function touched<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setResult(null);
      setInvalid(null);
    };
  }

  async function test(): Promise<ServerInfo | null> {
    setResult(null);
    const r = await connApi.test(input());
    if (r.result === "ok") {
      setResult({ ok: true, info: r.info });
      return r.info;
    }
    setResult({ ok: false, error: r.error });
    return null;
  }

  async function run(kind: "test" | "save" | "switch") {
    setBusy(kind);
    setError(null);
    try {
      let info: ServerInfo | null = null;
      if (kind !== "save") {
        info = await test();
        if (!info || kind === "test") return;
      }
      const saved = await connApi.save(input());
      if (saved.result === "invalid") {
        setInvalid(saved.invalid);
        return;
      }
      onSaved(saved.profile, kind === "switch" ? info : null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const hint = missing ?? refused;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{editing ? t.editTitle : t.addTitle}</DialogTitle>
          <DialogDescription>{t.dialogDesc}</DialogDescription>
        </DialogHeader>

        <FormRows>
          <FormRow label={t.name} htmlFor="conn-name">
            <Input
              id="conn-name"
              className="w-60"
              value={name}
              placeholder={t.namePlaceholder}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid?.field === "name" || undefined}
              onChange={(e) => touched(setName)(e.target.value)}
            />
          </FormRow>
          <FormRow label={t.host} htmlFor="conn-host" hint={t.hostHint}>
            <Input
              id="conn-host"
              className="w-60 font-mono"
              value={host}
              placeholder="192.168.1.20"
              spellCheck={false}
              autoComplete="off"
              aria-invalid={invalid?.field === "host" || undefined}
              onChange={(e) => touched(setHost)(e.target.value)}
            />
          </FormRow>
          <FormRow label={t.port} htmlFor="conn-port" hint={t.portHint(code)}>
            <Input
              id="conn-port"
              className="w-24 font-mono tabular-nums"
              inputMode="numeric"
              value={port}
              placeholder="8789"
              aria-invalid={(port !== "" && !portOk) || undefined}
              onChange={(e) => touched(setPort)(e.target.value)}
            />
          </FormRow>
          <FormRow label={t.key} htmlFor="conn-key" hint={t.keyHint(code)}>
            {replacing ? (
              <Input
                id="conn-key"
                type="password"
                className="w-full font-mono"
                value={key}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={(key !== "" && !keyOk) || undefined}
                onChange={(e) => touched(setKey)(e.target.value)}
              />
            ) : (
              <div className="flex w-full items-center gap-2">
                <Input id="conn-key" readOnly value={t.keySaved} className="text-muted-foreground" />
                <Button variant="outline" onClick={() => setReplacing(true)}>
                  {t.replaceKey}
                </Button>
              </div>
            )}
          </FormRow>
        </FormRows>

        <TestResult result={result} host={host.trim()} testing={busy === "test" || busy === "switch"} />

        {error && <p className="tw-body text-destructive">{error}</p>}

        <DialogFooter className="items-center">
          {/* 测试在左边，和保存那一组分开：它不改任何东西 */}
          <Button
            variant="outline"
            className="sm:mr-auto"
            disabled={busy !== null || missing !== null}
            onClick={() => void run("test")}
          >
            {t.test}
          </Button>
          {hint && <span className="tw-label text-muted-foreground">{hint}</span>}
          <Button variant="ghost" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            variant={isCurrent ? "default" : "outline"}
            disabled={busy !== null || missing !== null}
            onClick={() => void run("save")}
          >
            {busy === "save" && <Spinner />}
            {common.save}
          </Button>
          {!isCurrent && (
            <Button disabled={busy !== null || missing !== null} onClick={() => void run("switch")}>
              {busy === "switch" && <Spinner />}
              {t.saveAndSwitch}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 试连的结果：成功一行，失败两行（发生了什么、下一步） */
export function TestResult({
  result,
  host,
  testing,
}: {
  result: { ok: true; info: ServerInfo } | { ok: false; error: ConnectError } | null;
  /** 连的是哪个主机。网关地址按它写，见 `clientGateway` */
  host?: string;
  testing: boolean;
}) {
  const t = useText(connText);
  if (testing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 tw-body text-muted-foreground">
        <Spinner />
        {t.connecting}…
      </div>
    );
  }
  if (!result) return null;
  if (result.ok) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 tw-body">
        <CheckIcon className="size-4 shrink-0 text-success" />
        {t.testOk(
          result.info.core_version,
          host ? clientGateway(host, result.info.gateway_addr) : result.info.gateway_addr,
        )}
      </div>
    );
  }
  const d = describeError(result.error);
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2.5 tw-body",
        "border-destructive/30 bg-destructive/5",
      )}
    >
      <XIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="font-medium text-destructive">{d.title}</p>
        <p className="mt-0.5 text-muted-foreground">{d.next}</p>
      </div>
    </div>
  );
}
