import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Reveal } from "@/ui/motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { WslConfigPlan } from "@/types";
import { ConfirmAction, DISCLOSURE, focusSelf, useDialogFocus } from "@/keys/parts";
import { clientsText } from "./clients.i18n";
import { Diff } from "./PlanDialog";

/** 写进 `.wslconfig` 的那个值。配置里的取值，不翻译 */
const MIRRORED = "mirrored";

/**
 * 改为 mirrored 网络之前的确认。**和接管客户端是同一个样子**：改哪个文件、改哪一项、
 * 要知道的几件事，完整的改动默认收起。改的是 WSL 自己的设置，影响这台电脑上所有
 * WSL 2 发行版，这一点在确认之前说。
 *
 * 按下之后对话框留着、按钮转圈，写完才关；失败时对话框还在，可以再试。
 */
export function MirroredDialog({
  plan,
  pending,
  onCancel,
  onConfirm,
}: {
  plan: WslConfigPlan;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  const dialogFocus = useDialogFocus();
  const [diffOpen, setDiffOpen] = useState(false);
  const path = <code className="font-mono text-foreground">{plan.path}</code>;
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" {...dialogFocus}>
        <DialogHeader>
          <DialogTitle>{t.mirroredTitle}</DialogTitle>
          <DialogDescription>{plan.before == null ? t.creates(path) : t.modifies(path)}</DialogDescription>
        </DialogHeader>

        {plan.noop ? (
          <p className="tw-body">{t.mirroredNoop}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t.field}</TableHead>
                    <TableHead>{t.written}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-mono tw-label">{plan.field}</TableCell>
                    <TableCell className="font-mono tw-label">{MIRRORED}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-1">
              <p className="tw-head">{t.notes}</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 tw-body text-muted-foreground">
                <li>{t.mirroredAllDistros}</li>
                <li>{t.mirroredRestart}</li>
                <li>{t.mirroredKept}</li>
              </ul>
            </div>

            <div>
              <Button
                variant="ghost"
                size="xs"
                className={cn("-ml-1.5 gap-1 px-1.5 text-muted-foreground aria-expanded:text-muted-foreground", DISCLOSURE)}
                aria-expanded={diffOpen}
                onClick={() => setDiffOpen((o) => !o)}
              >
                <ChevronRightIcon className={cn("motion-bar", diffOpen && "rotate-90")} />
                {t.diff}
              </Button>
              <Reveal show={diffOpen}>
                <Diff before={plan.before ?? null} after={plan.after} />
              </Reveal>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {common.cancel}
          </Button>
          {!plan.noop && (
            <Button pending={pending} onClick={onConfirm}>
              {t.confirmMirrored}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 重启 WSL 之前的确认。**说清楚会停掉什么**：`wsl --shutdown` 停的是所有正在运行的
 * 发行版，里面没保存的东西跟着没了 —— 不只是装着客户端的那一个。
 *
 * 按下之后对话框留着、按钮转圈，停完才关。
 */
export function RestartWslDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(clientsText);
  const common = useText(commonText);
  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <AlertDialogContent onOpenAutoFocus={focusSelf}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.restartTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.restartWhat}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{common.cancel}</AlertDialogCancel>
          <ConfirmAction variant="destructive" pending={pending} onConfirm={onConfirm}>
            {t.confirmRestart}
          </ConfirmAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
