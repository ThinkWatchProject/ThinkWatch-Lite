import { useState } from "react";
import { FormRows } from "@/settings/form";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { whenMinute } from "@/format";
import { DialogError } from "@/upstreams/parts";
import type { BackupEntry } from "@/types";
import { backupApi } from "./api";
import { backupText } from "./backup.i18n";
import { originLabel } from "./items";
import { PassphraseRow, usePassphrase } from "./Passphrase";

/**
 * 某一版本的「另存为…」（规格 7.1）：把这一版存成一个配置包，放到任意位置。本机的版本含密钥、
 * 不加密，所以和导出一样可以选口令加密；不加密时提示文件里是明文密钥。
 */
export function SaveVersionDialog({ entry, onClose }: { entry: BackupEntry; onClose: () => void }) {
  const t = useText(backupText);
  const c = useText(commonText);
  const pass = usePassphrase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const f = await backupApi.file(entry.id, pass.value);
      const path = await backupApi.save(f);
      if (path) {
        notify.success(t.saved(path));
        onClose();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex flex-col gap-4 sm:max-w-[520px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.saveTitle}</DialogTitle>
          <DialogDescription>
            {[
              whenMinute(entry.at_ms),
              originLabel(entry.origin, entry.device),
              t.counts(entry.counts.providers, entry.counts.plugins),
            ].join(" · ")}
          </DialogDescription>
        </DialogHeader>
        <FormRows>
          <PassphraseRow p={pass} disabled={busy} />
        </FormRows>
        <DialogError error={error} />
        <DialogFooter className="items-center">
          {!pass.on && <span className="mr-auto tw-label text-warning-foreground">{t.plaintext}</span>}
          <Button variant="outline" onClick={onClose}>
            {c.cancel}
          </Button>
          <Button pending={busy} disabled={pass.problem !== null} onClick={() => void run()}>
            {t.saveAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
