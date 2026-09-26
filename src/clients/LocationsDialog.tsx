import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
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
import { Skeleton } from "@/ui/skeleton";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ClientLocations, LocationChange, LocationEdit, LocationRole } from "@/types";
import { ClientMark, ConfirmAction, Tile, focusSelf, useDialogFocus } from "@/keys/parts";
import { api } from "./api";
import { clientsText } from "./clients.i18n";

/**
 * 一个客户端的配置位置：接管改的文件、MCP 管理读写的文件、安全扫描看的文件夹。客户端页
 * 和 MCP 页的「更改路径…」都打开它。
 *
 * **几处跟着同一个目录一起换**（Claude Code 的 `CLAUDE_CONFIG_DIR`、Codex 的 `CODEX_HOME`
 * 挪的是整个目录）：改其中一处，保存之前把跟着换的几处一起列出来，确认之后一起生效 ——
 * 从哪一处改起都一样。同一个文件的几项在同一行（Codex 的 `config.toml` 既是接管的也是
 * MCP 的）；一次只改一处，改了一处其余几处先不能改。
 *
 * 默认位置写在每一处下面，有不在默认位置的时给「恢复默认」，同样一起列出来再生效。
 * 接管着的不能改：接管的文件会跟着换，而接管记录在原来那个文件旁边。写得对不对由 Rust
 * 那一侧核对。
 */
export function LocationsDialog({
  client,
  onClose,
  onSaved,
}: {
  client: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  const dialogFocus = useDialogFocus();
  const [view, setView] = useState<ClientLocations | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 改前提示：跟着换的几处，和确认之后要交的那一改（空是全部回到默认位置） */
  const [confirm, setConfirm] = useState<{ edit: LocationEdit | null; changes: LocationChange[] } | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .locations(client)
      .then((v) => {
        if (!alive) return;
        setView(v);
        setValues(v.rows.map((r) => r.path));
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [client]);

  const rows = view?.rows ?? [];
  /** 正在改的那一处 */
  const edited = rows.findIndex((r, i) => (values[i] ?? r.path).trim() !== r.path);
  const locked = view?.adopted ?? false;
  const empty = edited >= 0 && values[edited]!.trim() === "";
  const moved = rows.some((r) => r.path !== r.default);
  const label = (roles: LocationRole[]) => roles.map((r) => t.locRole[r]).join(t.locJoin);

  /** 算出跟着换的几处。不止一项要换就先提示；只有这一项的直接生效 */
  async function propose(edit: LocationEdit | null) {
    setBusy(true);
    setError(null);
    try {
      const changes = await api.planLocations(client, edit);
      if (changes.length === 0) {
        onClose();
      } else if (changes.flatMap((c) => c.roles).length > 1) {
        setConfirm({ edit, changes });
      } else {
        await api.setLocations(client, edit);
        onSaved();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!confirm) return;
    setApplying(true);
    try {
      await api.setLocations(client, confirm.edit);
      onSaved();
    } catch (e) {
      setConfirm(null);
      setError(errorText(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="flex flex-col gap-4 sm:max-w-xl" {...dialogFocus}>
          <DialogHeader className="flex-row items-center gap-3">
            <Tile className="size-9 rounded-lg [&_svg]:size-[18px]">
              <ClientMark id={client} name={view?.name ?? client} size={18} />
            </Tile>
            <div className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle>{t.locTitle(view?.name ?? "")}</DialogTitle>
              <DialogDescription>{t.locDesc}</DialogDescription>
            </div>
          </DialogHeader>

          {locked && (
            <Banner layout="inline" tone="warning">
              {t.locAdopted}
            </Banner>
          )}

          {view === null && error === null ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {rows.map((r, i) => (
                <div key={r.roles.join()} className="flex flex-col gap-1.5">
                  <label htmlFor={`loc-${i}`} className="tw-body font-medium">
                    {label(r.roles)}
                  </label>
                  <Input
                    id={`loc-${i}`}
                    className="font-mono"
                    value={values[i] ?? r.path}
                    placeholder={r.default}
                    // 一次只改一处：其余几处由它推出来
                    disabled={locked || busy || (edited >= 0 && edited !== i)}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => {
                      const next = [...values];
                      next[i] = e.target.value;
                      setValues(next);
                      setError(null);
                    }}
                  />
                  <p className="tw-label break-all text-muted-foreground">
                    {r.dir ? t.locDefaultFolder(r.default) : t.locDefaultFile(r.default)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <Banner layout="inline" tone="error" show={error !== null}>
            {error}
          </Banner>

          <DialogFooter className="items-center">
            {moved && !locked && edited < 0 && (
              <Button variant="outline" className="sm:mr-auto" disabled={busy} onClick={() => void propose(null)}>
                {t.locRestore}
              </Button>
            )}
            {empty && <span className="mr-auto tw-label text-muted-foreground">{t.enterPath}</span>}
            <Button variant="outline" disabled={busy} onClick={onClose}>
              {common.cancel}
            </Button>
            <Button
              pending={busy}
              disabled={locked || edited < 0 || empty}
              onClick={() => void propose({ role: rows[edited]!.roles[0]!, path: values[edited]!.trim() })}
            >
              {common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirm && (
        <AlertDialog open onOpenChange={(o) => !o && !applying && setConfirm(null)}>
          <AlertDialogContent onOpenAutoFocus={focusSelf} className="sm:max-w-xl">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.edit ? t.locConfirmTitle : t.locRestoreTitle}</AlertDialogTitle>
              <AlertDialogDescription>{t.locConfirmBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
              {confirm.changes.map((c) => (
                <li key={c.roles.join()} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="tw-body font-medium">{label(c.roles)}</span>
                  <span className="tw-label break-all font-mono text-muted-foreground line-through">{c.from}</span>
                  <span className="tw-label break-all font-mono">{c.to}</span>
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={applying}>{common.cancel}</AlertDialogCancel>
              <ConfirmAction pending={applying} onConfirm={() => void apply()}>
                {t.locConfirm}
              </ConfirmAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
