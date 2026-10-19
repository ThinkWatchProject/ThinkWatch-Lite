import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogConfirm,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { SecretInput } from "@/ui/secret-input";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { FormRow, FormRows } from "@/settings/form";
import type { SyncEncryptionAction, SyncView } from "@/types";
import { syncApi } from "./api";
import { syncDialogsText } from "./dialogs.i18n";
import { NewPassphrase, type RowOf } from "./Fields";
import { syncFieldsText } from "./fields.i18n";
import { passphraseProblem, PASSPHRASE_MIN } from "./target";

const row: RowOf = ({ id, label, htmlFor, hint, control }) => (
  <FormRow key={id} label={label} htmlFor={htmlFor} hint={hint}>
    {control}
  </FormRow>
);

/**
 * 加密：开启（设一个新口令）、关闭（要当前口令）、更改口令（当前的和新的）。方案 6.3。
 * 三件事都由 core 重新上传或重新加密，这里只收口令。
 */
export function EncryptionDialog({
  action,
  onClose,
  onDone,
}: {
  action: SyncEncryptionAction;
  onClose: () => void;
  onDone: (v: SyncView) => void;
}) {
  const t = useText(syncDialogsText);
  const ft = useText(syncFieldsText);
  const common = useText(commonText);
  const [current, setCurrent] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCurrent = action !== "enable";
  const needsNew = action !== "disable";
  const p = needsNew ? passphraseProblem(a, b) : null;
  const missing =
    needsCurrent && current === ""
      ? t.enterCurrent
      : p === "short"
        ? ft.passphraseShort(PASSPHRASE_MIN)
        : p === "mismatch"
          ? ft.passphraseMismatch
          : null;
  const title = action === "enable" ? t.enableTitle : action === "disable" ? t.disableTitle : t.changeTitle;
  const desc = action === "enable" ? t.enableDesc : action === "disable" ? t.disableDesc : t.changeDesc;
  const verb = action === "enable" ? t.enable : action === "disable" ? t.disable : t.change;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      // 开启时 `passphrase` 是新口令；关闭时是当前口令；更改时当前的和新的各一个
      const v = await syncApi.encryption(
        action,
        action === "enable" ? a : current,
        action === "change" ? a : null,
      );
      onDone(v);
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <form
          id="sync-encryption"
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing && !busy) void run();
          }}
        >
          <FormRows>
            {needsCurrent && (
              <FormRow label={t.current} htmlFor="sync-current">
                <div className="w-80">
                  <SecretInput id="sync-current" value={current} disabled={busy} onChange={(e) => setCurrent(e.target.value)} />
                </div>
              </FormRow>
            )}
            {needsNew && (
              <NewPassphrase
                id="sync-new"
                a={a}
                b={b}
                onA={setA}
                onB={setB}
                labels={action === "change" ? { a: t.fresh, b: t.freshAgain } : undefined}
                disabled={busy}
                row={row}
              />
            )}
          </FormRows>
        </form>
        <Banner layout="inline" tone="error" show={error !== null} title={t.failed}>
          {error}
        </Banner>
        <DialogFooter className="items-center">
          {missing && <span className="tw-label text-muted-foreground sm:mr-auto">{missing}</span>}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            type="submit"
            form="sync-encryption"
            variant={action === "disable" ? "destructive" : "default"}
            pending={busy}
            disabled={busy || missing !== null}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 口令在别的设备上改了（`locked`）：输入新口令接着同步 */
export function UnlockDialog({ onClose, onDone }: { onClose: () => void; onDone: (v: SyncView) => void }) {
  const t = useText(syncDialogsText);
  const ft = useText(syncFieldsText);
  const common = useText(commonText);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      onDone(await syncApi.unlock(pass));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.unlockTitle}</DialogTitle>
          <DialogDescription>{t.unlockDesc}</DialogDescription>
        </DialogHeader>
        <form
          id="sync-unlock"
          onSubmit={(e) => {
            e.preventDefault();
            if (pass && !busy) void run();
          }}
        >
          <FormRows>
            <FormRow label={ft.passphrase} htmlFor="sync-unlock-pass">
              <div className="w-80">
                <SecretInput id="sync-unlock-pass" value={pass} disabled={busy} onChange={(e) => setPass(e.target.value)} />
              </div>
            </FormRow>
          </FormRows>
        </form>
        <Banner layout="inline" tone="error" show={error !== null} title={t.failed}>
          {error}
        </Banner>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button type="submit" form="sync-unlock" pending={busy} disabled={busy || pass === ""}>
            {t.unlock}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 停止同步（方案 6.11）。「停止同步」只动这台设备；「停止同步并删除同步数据」另需确认 ——
 * 它删掉的是所有设备共用的那一份，别的设备随后也停下。
 */
export function StopDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useText(syncDialogsText);
  const common = useText(commonText);
  const [purging, setPurging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(purge: boolean) {
    setBusy(true);
    setError(null);
    try {
      await syncApi.disable(purge);
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{purging ? t.purgeTitle : t.stopTitle}</AlertDialogTitle>
          <AlertDialogDescription>{purging ? t.purgeDesc : t.stopDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <Banner layout="inline" tone="error" show={error !== null}>
          {error}
        </Banner>
        <AlertDialogFooter className="items-center">
          {!purging && (
            <Button
              variant="ghost"
              className="text-destructive sm:mr-auto"
              disabled={busy}
              onClick={() => {
                setError(null);
                setPurging(true);
              }}
            >
              {t.stopPurge}
            </Button>
          )}
          <AlertDialogCancel disabled={busy}>{common.cancel}</AlertDialogCancel>
          {purging ? (
            <AlertDialogConfirm variant="destructive" pending={busy} onConfirm={() => void run(true)}>
              {t.purge}
            </AlertDialogConfirm>
          ) : (
            <AlertDialogConfirm pending={busy} onConfirm={() => void run(false)}>
              {t.stop}
            </AlertDialogConfirm>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 不同步的上游：勾选。**只改表单里的草稿**，和这一节别的项一起点「保存」才写进配置。
 */
export function ExcludeDialog({
  upstreams,
  value,
  onClose,
  onDone,
}: {
  upstreams: readonly string[];
  value: readonly string[];
  onClose: () => void;
  onDone: (next: string[]) => void;
}) {
  const t = useText(syncDialogsText);
  const common = useText(commonText);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(value));
  // 配置里写着一个已经没有的上游：照样列出来，可以取消
  const all = [...upstreams, ...value.filter((v) => !upstreams.includes(v))];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-4 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.excludeTitle}</DialogTitle>
          <DialogDescription>{t.excludeDesc}</DialogDescription>
        </DialogHeader>
        {all.length === 0 ? (
          <p className="tw-body text-muted-foreground">{t.noUpstreams}</p>
        ) : (
          <div className="min-h-0 overflow-y-auto rounded-lg border border-border">
            {all.map((name) => (
              <label
                key={name}
                className="flex h-9 cursor-pointer items-center gap-2.5 border-b border-border px-3 tw-body last:border-b-0 hover:bg-muted/40"
              >
                <Checkbox
                  checked={picked.has(name)}
                  onCheckedChange={(c) =>
                    setPicked((s) => {
                      const next = new Set(s);
                      if (c === true) next.add(name);
                      else next.delete(name);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 truncate">{name}</span>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            onClick={() => {
              onDone(all.filter((n) => picked.has(n)));
              onClose();
            }}
          >
            {t.done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
