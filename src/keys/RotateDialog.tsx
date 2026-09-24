import { useState } from "react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { ClientView, DetectedClient, KeyRotation } from "@/types";
import { api } from "./api";
import { errorText } from "./labels";
import { ConfirmAction, CopyButton, focusSelf, useDialogFocus } from "./parts";
import { rotateDialogText } from "./RotateDialog.i18n";

/**
 * 更换一把密钥。
 *
 * **先说代价，再做事。**原密钥立即失效；如果这把钥匙是某个被接管的客户端
 * 在用的，新值会一并写进它的配置，而那个客户端多半要重新启动才会
 * 读到 —— 这句话必须在用户按下去之前说，不是之后。
 *
 * 按下「更换」之后对话框留着、按钮转圈；结果（新值、同步到了哪里、哪里没同步上）
 * 在同一个位置换成结果页。
 */
export function RotateDialog({
  target,
  clients,
  version,
  onClose,
  onRotated,
}: {
  target: ClientView;
  clients: DetectedClient[];
  /** 写配置时带的版本号 */
  version: { get: () => string };
  onClose: () => void;
  /** 换好了：配置的新版本 */
  onRotated: (version: string) => void;
}) {
  const t = useText(rotateDialogText);
  const dialogFocus = useDialogFocus();
  const common = useText(commonText);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<KeyRotation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const owner = clients.find((c) => c.id === target.client);
  const adopted = !!owner?.adopted_at_ms;
  const needsRestart = owner?.takes_effect === "on_restart";

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.rotateKey(target.name, version.get());
      setDone(r);
      onRotated(r.version);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const name = <span className="font-mono text-foreground">{target.name}</span>;
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-lg" {...dialogFocus}>
          <DialogHeader>
            <DialogTitle>{t.doneTitle}</DialogTitle>
            <DialogDescription>
              {done.synced.length > 0 ? t.synced(name, done.synced.map((s) => s.name)) : t.shown(name)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="tw-label text-muted-foreground">{t.newKey}</p>
                <p className="truncate font-mono tw-body select-text">{done.key}</p>
              </div>
              <CopyButton
                onCopy={() =>
                  api.copyKey(target.name).catch((e: unknown) => {
                    setError(errorText(e));
                    throw e;
                  })
                }
              />
            </div>
            {/* 做完之后再说一遍该做什么：前一屏是决定要不要做 */}
            {done.synced
              .filter((s) => s.takes_effect === "on_restart")
              .map((s) => (
                <Banner key={s.client} layout="inline" tone="warning" title={t.restart(s.name)}>
                  {t.stillOld}
                </Banner>
              ))}
            {done.failed.map((f) => (
              <Banner key={f.client} layout="inline" tone="error" title={t.writeFailed(f.name)}>
                {t.enterManually(coreText(f.error).replace(/[。.]$/, ""), f.name)}
              </Banner>
            ))}
            {done.synced.length === 0 && done.failed.length === 0 && (
              <p className="tw-label text-muted-foreground">{t.updateElsewhere}</p>
            )}
            <Banner show={error !== null} layout="inline" tone="error">
              {error}
            </Banner>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>{t.done}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent onOpenAutoFocus={focusSelf}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title(target.name)}</AlertDialogTitle>
          <AlertDialogDescription>{t.description(adopted && owner ? owner.name : null)}</AlertDialogDescription>
        </AlertDialogHeader>
        {adopted && owner && needsRestart && (
          <Banner layout="inline" tone="warning" title={t.needsRestart(owner.name)}>
            {t.readsAtStart(owner.name)}
          </Banner>
        )}
        {target.default && (
          <Banner layout="inline" tone="warning" title={t.isDefault}>
            {t.defaultClients}
          </Banner>
        )}
        <Banner show={error !== null} layout="inline" tone="error">
          {error}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{common.cancel}</AlertDialogCancel>
          <ConfirmAction pending={busy} onConfirm={() => void rotate()}>
            {adopted ? t.rotateAndSync : t.rotate}
          </ConfirmAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
