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
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { DetectedClient } from "@/types";
import { clientsText } from "./clients.i18n";
import { statusOf } from "./status";
import { StatusLabel } from "./StatusLabel";

/**
 * 全部还原之前的确认。**列出会被还原的是哪几个** —— 「还原全部」这四个字
 * 说不清会断掉几个客户端，而那正是按下去之前该知道的。
 */
export function RestoreAllDialog({
  adopted,
  gatewayBase,
  busy,
  onCancel,
  onConfirm,
}: {
  adopted: DetectedClient[];
  gatewayBase: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.restoreAllTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.restoreAllBody(adopted.length)}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1.5 rounded-md border border-border px-3 py-2 tw-body">
          {adopted.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3">
              <span className="font-medium">{c.name}</span>
              <span className="tw-label">
                <StatusLabel status={statusOf(c, gatewayBase)} />
              </span>
            </li>
          ))}
        </ul>
        <p className="tw-body text-muted-foreground">{t.keysKept}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{common.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy} onClick={onConfirm}>
            {t.confirmRestoreAll}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
