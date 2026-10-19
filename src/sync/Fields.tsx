import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { SecretInput } from "@/ui/secret-input";
import { Segmented } from "@/ui/segmented";
import { cn } from "@/lib/utils";
import { notify } from "@/ui/notify";
import { useText } from "@/i18n";
import { syncFieldsText } from "./fields.i18n";
import { syncApi } from "./api";
import { TARGET_KINDS, type TargetDraft, type TargetKind } from "./target";

/** 一行怎么画：设置里是名目在左、控件在右的一行，向导里是两列表单的一行 */
export type RowOf = (p: { id: string; label: ReactNode; htmlFor?: string; hint?: ReactNode; control: ReactNode }) => ReactNode;

/**
 * 同步位置的几格：类型，和这种类型要填的那几项；WebDAV 和 S3 另有「代理」。
 *
 * `dense`：设置页里一行一项、控件 28px；向导的表单里 32px。`remote`：连着远程 core，文件夹
 * 是服务器上的路径，不给「选择…」（这台电脑上选出来的路径对服务器没有意义）。
 */
export function TargetFields({
  draft,
  onChange,
  proxies,
  remote,
  disabled,
  dense = false,
  row,
}: {
  draft: TargetDraft;
  onChange: (patch: Partial<TargetDraft>) => void;
  /** 能选的代理（名字） */
  proxies: readonly string[];
  remote: boolean;
  disabled?: boolean;
  dense?: boolean;
  row: RowOf;
}) {
  const t = useText(syncFieldsText);
  const width = dense ? "w-72" : "w-80";
  const text = (k: keyof TargetDraft, opts: { mono?: boolean; placeholder?: string; w?: string } = {}) => (
    <Input
      id={`sync-${k}`}
      variant={dense ? "sm" : "default"}
      className={cn(opts.w ?? width, opts.mono && "font-mono")}
      value={draft[k]}
      placeholder={opts.placeholder}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(e) => onChange({ [k]: e.target.value })}
    />
  );
  const secret = (k: "pass" | "secret_access_key") => (
    // 设置里一行一项的控件是 28px：输入框那一圈（`input-group`）跟着收
    <div className={cn(width, dense && "[&_[data-slot=input-group]]:h-7 [&_[data-slot=input-group]]:rounded-[min(var(--radius-md),10px)]")}>
      <SecretInput
        id={`sync-${k}`}
        className="font-mono"
        value={draft[k]}
        disabled={disabled}
        onChange={(e) => onChange({ [k]: e.target.value })}
      />
    </div>
  );

  async function pick() {
    try {
      const path = await syncApi.pickFolder();
      if (path) onChange({ path });
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <>
      {row({
        id: "type",
        label: t.location,
        control: (
          <Segmented<TargetKind>
            label={t.location}
            value={draft.type}
            disabled={disabled}
            options={TARGET_KINDS.map((k) => ({ id: k, label: t.kinds[k] }))}
            onChange={(type) => onChange({ type })}
          />
        ),
      })}
      {draft.type === "folder" &&
        row({
          id: "path",
          label: t.folder,
          htmlFor: "sync-path",
          hint: remote ? t.folderRemoteHint : t.folderHint,
          control: (
            <span className="inline-flex items-center gap-2">
              {text("path", { mono: true, w: remote ? width : dense ? "w-56" : "w-64" })}
              {!remote && (
                <Button
                  type="button"
                  variant="outline"
                  size={dense ? "sm" : "default"}
                  disabled={disabled}
                  onClick={() => void pick()}
                >
                  {t.pick}
                </Button>
              )}
            </span>
          ),
        })}
      {draft.type === "webdav" && (
        <>
          {row({
            id: "url",
            label: t.url,
            htmlFor: "sync-url",
            control: text("url", { mono: true, placeholder: "https://dav.jianguoyun.com/dav/ThinkWatch" }),
          })}
          {row({ id: "user", label: t.user, htmlFor: "sync-user", control: text("user") })}
          {row({ id: "pass", label: t.pass, htmlFor: "sync-pass", hint: t.passHint, control: secret("pass") })}
        </>
      )}
      {draft.type === "s3" && (
        <>
          {row({
            id: "endpoint",
            label: t.endpoint,
            htmlFor: "sync-endpoint",
            control: text("endpoint", { mono: true, placeholder: "https://s3.amazonaws.com" }),
          })}
          {row({
            id: "region",
            label: t.region,
            htmlFor: "sync-region",
            hint: t.regionHint,
            control: text("region", { mono: true, placeholder: "us-east-1", w: "w-40" }),
          })}
          {row({ id: "bucket", label: t.bucket, htmlFor: "sync-bucket", control: text("bucket", { mono: true }) })}
          {row({
            id: "prefix",
            label: t.prefix,
            htmlFor: "sync-prefix",
            hint: t.prefixHint,
            control: text("prefix", { mono: true, placeholder: "ThinkWatch/" }),
          })}
          {row({
            id: "access_key_id",
            label: t.accessKeyId,
            htmlFor: "sync-access_key_id",
            control: text("access_key_id", { mono: true }),
          })}
          {row({
            id: "secret_access_key",
            label: t.secretAccessKey,
            htmlFor: "sync-secret_access_key",
            control: secret("secret_access_key"),
          })}
        </>
      )}
      {draft.type !== "folder" &&
        row({
          id: "proxy",
          label: t.proxy,
          htmlFor: "sync-proxy",
          control: (
            <NativeSelect
              id="sync-proxy"
              size={dense ? "sm" : "default"}
              className="w-48"
              value={draft.proxy}
              disabled={disabled}
              onChange={(e) => onChange({ proxy: e.target.value })}
            >
              <NativeSelectOption value="direct">{t.direct}</NativeSelectOption>
              <NativeSelectOption value="system">{t.system}</NativeSelectOption>
              {/* 配置里写着一个已经删掉的代理：照样列出来，不显示成直连 */}
              {draft.proxy !== "direct" && draft.proxy !== "system" && !proxies.includes(draft.proxy) && (
                <NativeSelectOption value={draft.proxy}>{draft.proxy}</NativeSelectOption>
              )}
              {proxies.map((p) => (
                <NativeSelectOption key={p} value={p}>
                  {p}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ),
        })}
    </>
  );
}

/** 两次输入的新口令。`id` 区分同一页上的几组 */
export function NewPassphrase({
  id,
  a,
  b,
  onA,
  onB,
  hint,
  labels,
  disabled,
  row,
}: {
  id: string;
  a: string;
  b: string;
  onA: (v: string) => void;
  onB: (v: string) => void;
  /** 第二格下面那一行 */
  hint?: ReactNode;
  /** 两格的名目。缺省「同步口令」「再次输入」；改口令时是「新口令」 */
  labels?: { a: ReactNode; b: ReactNode };
  disabled?: boolean;
  row: RowOf;
}) {
  const t = useText(syncFieldsText);
  return (
    <>
      {row({
        id: `${id}-a`,
        label: labels?.a ?? t.passphrase,
        htmlFor: `${id}-a`,
        control: (
          <div className="w-80">
            <SecretInput id={`${id}-a`} value={a} disabled={disabled} onChange={(e) => onA(e.target.value)} />
          </div>
        ),
      })}
      {row({
        id: `${id}-b`,
        label: labels?.b ?? t.passphraseAgain,
        htmlFor: `${id}-b`,
        hint,
        control: (
          <div className="w-80">
            <SecretInput id={`${id}-b`} value={b} disabled={disabled} onChange={(e) => onB(e.target.value)} />
          </div>
        ),
      })}
    </>
  );
}
