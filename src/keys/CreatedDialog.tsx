import { CheckIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { Skeleton } from "@/ui/skeleton";
import { useText } from "@/i18n";
import { api } from "./api";
import { createdDialogText } from "./CreatedDialog.i18n";
import { CopyButton, useDialogFocus } from "./parts";

/**
 * 刚建好的一把密钥，下一步一定是拿去某个地方填上 —— 地址和密钥一起给，各带一个
 * 复制按钮。
 */
export function CreatedDialog({
  name,
  value,
  gateway,
  onCopyKey,
  onClose,
}: {
  name: string;
  /** 列表重取回来之前是 null */
  value: string | null;
  /** 网关地址。还没取到是 null */
  gateway: string | null;
  onCopyKey: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(createdDialogText);
  const dialogFocus = useDialogFocus();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg" {...dialogFocus}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-success/15 text-success">
              <CheckIcon className="size-3" />
            </span>
            {t.title}
          </DialogTitle>
          <DialogDescription>{t.canConnect(<span className="font-mono text-foreground">{name}</span>)}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border border-border bg-surface/60">
          <CopyRow
            label={t.gatewayAddress}
            value={gateway}
            onCopy={() =>
              api.copyGatewayBase().catch((e: unknown) => {
                notify.error(e);
                throw e;
              })
            }
          />
          <div className="border-t border-border" />
          <CopyRow label={t.key} value={value} onCopy={onCopyKey} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t.done}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 一行：名目、值（等宽），右边复制。值还没到时是一条骨架 */
function CopyRow({ label, value, onCopy }: { label: string; value: string | null; onCopy: () => Promise<void> }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="tw-label text-muted-foreground">{label}</p>
        {value == null ? (
          <Skeleton className="mt-1.5 mb-1 h-3 w-56 rounded-sm" />
        ) : (
          <p className="truncate font-mono tw-body select-text">{value}</p>
        )}
      </div>
      <CopyButton disabled={value == null} onCopy={onCopy} />
    </div>
  );
}
