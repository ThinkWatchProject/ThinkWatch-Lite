import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { ClientLogo } from "@/ui/logos";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { DetectedClient } from "@/types";
import { ConfirmAction, focusSelf } from "@/keys/parts";
import { useRemote } from "@/connection/useRemote";
import { clientsText } from "./clients.i18n";
import { statusOf } from "./status";
import { ClientStatus } from "./ClientStatus";

/**
 * 全部还原之前的确认。**列出会被还原的是哪几个** —— 「还原全部」这四个字
 * 说不清会断掉几个客户端，而那正是按下去之前该知道的。
 *
 * 按下之后对话框留着、按钮转圈，全部做完才关。
 */
export function RestoreAllDialog({
  adopted,
  gatewayBase,
  pending,
  onCancel,
  onConfirm,
}: {
  adopted: DetectedClient[];
  gatewayBase: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(clientsText);
  const remote = useRemote();
  const common = useText(commonText);
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <AlertDialogContent onOpenAutoFocus={focusSelf}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.restoreAllTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.restoreAllBody(adopted.length)}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border tw-body">
          {adopted.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <ClientLogo id={c.id} name={c.name} className="text-muted-foreground" />
                <span className="truncate font-medium">{c.name}</span>
              </span>
              <ClientStatus status={statusOf(c, gatewayBase, Date.now(), remote !== null)} />
            </li>
          ))}
        </ul>
        <p className="tw-body text-muted-foreground">{t.keysKept}</p>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{common.cancel}</AlertDialogCancel>
          <ConfirmAction variant="destructive" pending={pending} onConfirm={onConfirm}>
            {t.confirmRestoreAll}
          </ConfirmAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
