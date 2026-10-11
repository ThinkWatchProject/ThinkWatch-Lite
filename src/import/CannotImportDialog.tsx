import { useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { focusSelf } from "@/ui/dialog-focus";
import { usePending } from "@/ui/notify";
import { StatusLabel } from "@/ui/status-dot";
import { useResource } from "@/lib/resource";
import { useTauriEvent } from "@/lib/tauriEvent";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { APP_KEYS, settingsApi } from "@/settings/api";
import type { Found } from "@/updateFlow";
import { cannotImportText } from "./CannotImportDialog.i18n";

/** 「检查更新」按下去之后的结果 */
type Check = "idle" | "checking" | "latest" | "failed";

/**
 * 导入链接里有这一版不认识的参数：说无法导入，是哪一个参数（Rust 侧只在参数名是
 * `^[a-z0-9_]{1,32}$` 时给出来，这里当纯文本画）。
 *
 * **更新走设置里的那一套**：已经知道有新版本时一句「更新后再打开这条链接」和「安装更新」
 * （打开更新窗口，和别处查到新版本时是同一扇窗口）；还不知道时给「检查更新」，查到了换成
 * 前面那样，没有就说已是最新版本。
 */
export function CannotImportDialog({ param, onClose }: { param: string | null; onClose: () => void }) {
  const t = useText(cannotImportText);
  const c = useText(commonText);
  const update = useResource(APP_KEYS.update, settingsApi.update);
  const [check, setCheck] = useState<Check>("idle");
  const [opening, open] = usePending();
  const offer = update.data?.offer ?? null;

  /** 查到的新版本并进缓存里现在的那一份（同设置页） */
  const withOffer = (found: Found | null) => {
    const was = update.data;
    if (was) update.mutate((prev) => ({ ...(prev ?? was), offer: found }));
    else void update.reload();
  };
  // 后台那轮自动检查查到了：这里也跟着显示
  useTauriEvent<Found>("update-found", (e) => withOffer(e.payload));

  async function look() {
    setCheck("checking");
    try {
      const found = await settingsApi.checkUpdate();
      withOffer(found);
      setCheck(found ? "idle" : "latest");
    } catch {
      setCheck("failed");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* 链接打开的，不是点出来的：焦点放在对话框上，「关闭」上不画一圈焦点框 */}
      <DialogContent className="flex flex-col gap-4 sm:max-w-[440px]" onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.title}</DialogTitle>
          <DialogDescription className="break-words">
            {param ? t.unsupported(param) : t.unsupportedUnnamed}
          </DialogDescription>
        </DialogHeader>
        {offer && <p className="tw-body">{t.update}</p>}
        {!offer && check === "latest" && (
          <StatusLabel tone="ok" muted>
            {t.latest}
          </StatusLabel>
        )}
        {!offer && check === "failed" && <StatusLabel tone="error">{t.checkFailed}</StatusLabel>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {c.close}
          </Button>
          {offer ? (
            <Button pending={opening} onClick={() => void open(settingsApi.showUpdate)}>
              {t.install}
            </Button>
          ) : (
            <Button pending={check === "checking"} onClick={() => void look()}>
              {t.check}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
