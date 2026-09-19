import { useState } from "react";
import { CircleAlertIcon, CopyIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ClientView, DetectedClient, KeyRotated } from "@/types";
import { api } from "./api";
import { errorText } from "./labels";
import { rotateDialogText } from "./RotateDialog.i18n";

/**
 * 更换一把密钥。
 *
 * **先说代价，再做事。**原密钥立即失效；如果这把钥匙是某个被接管的客户端
 * 在用的，core 会把新值一并写进它的配置，而那个客户端多半要重新启动才会
 * 读到 —— 这句话必须在用户按下去之前说，不是之后。
 */
export function RotateDialog({
  target,
  clients,
  configVersion,
  onClose,
  onRotated,
}: {
  target: ClientView;
  clients: DetectedClient[];
  configVersion: string | null;
  onClose: () => void;
  onRotated: () => void;
}) {
  const t = useText(rotateDialogText);
  const common = useText(commonText);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<KeyRotated | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owner = clients.find((c) => c.id === target.client);
  const adopted = !!owner?.adopted_at_ms;
  const needsRestart = owner?.takes_effect === "on_restart";

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.rotateKey(target.name, configVersion);
      setDone(r);
      onRotated();
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.doneTitle}</DialogTitle>
            <DialogDescription>
              {done.synced.length > 0
                ? t.synced(name, done.synced.map((s) => s.name))
                : t.shown(name)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="tw-label text-muted-foreground">{t.newKey}</p>
                <p className="truncate font-mono tw-body">{done.key}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCopied(false);
                  api
                    .copyKey(target.name)
                    .then(() => setCopied(true))
                    .catch((e) => setError(errorText(e)));
                }}
              >
                <CopyIcon />
                {copied ? common.copied : common.copy}
              </Button>
            </div>
            {/* 做完之后再说一遍该做什么：前一屏是决定要不要做 */}
            {done.synced
              .filter((s) => s.takes_effect === "on_restart")
              .map((s) => (
                <Alert key={s.client} variant="warning">
                  <CircleAlertIcon />
                  <AlertTitle>{t.restart(s.name)}</AlertTitle>
                  <AlertDescription>{t.stillOld}</AlertDescription>
                </Alert>
              ))}
            {done.failed.map((f) => (
              <Alert key={f.client} variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{t.writeFailed(f.name)}</AlertTitle>
                <AlertDescription>
                  {t.enterManually(f.error, f.name)}
                </AlertDescription>
              </Alert>
            ))}
            {done.synced.length === 0 && done.failed.length === 0 && (
              <p className="tw-label text-muted-foreground">
                {t.updateElsewhere}
              </p>
            )}
            {error && <p className="tw-body text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button onClick={onClose}>{t.done}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title(target.name)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.description(adopted && owner ? owner.name : null)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {adopted && owner && needsRestart && (
          <Alert variant="warning">
            <CircleAlertIcon />
            <AlertTitle>{t.needsRestart(owner.name)}</AlertTitle>
            <AlertDescription>
              {t.readsAtStart(owner.name)}
            </AlertDescription>
          </Alert>
        )}
        {target.default && (
          <Alert variant="warning">
            <CircleAlertIcon />
            <AlertTitle>{t.isDefault}</AlertTitle>
            <AlertDescription>
              {t.defaultClients}
            </AlertDescription>
          </Alert>
        )}
        {error && <p className="tw-body text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // 结果要留在这张对话框里给出来，所以不让它自己关掉
              e.preventDefault();
              void rotate();
            }}
            disabled={busy}
          >
            {adopted ? t.rotateAndSync : t.rotate}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
