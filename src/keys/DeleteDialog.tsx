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
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ClientView } from "@/types";
import { deleteDialogText } from "./DeleteDialog.i18n";
import type { KeyOwner } from "./labels";
import { ConfirmAction, focusSelf } from "./parts";

/**
 * 删除一把密钥的确认。
 *
 * **按下「删除」之后对话框留着**，按钮转圈，直到 core 回话：成功了才关（那一行随之
 * 淡出），失败了原因写在这里，可以再试或者取消 —— 不先关掉再在别处报一个错。
 */
export function DeleteDialog({
  target,
  owner,
  onDelete,
  onClose,
}: {
  target: ClientView;
  /** 为哪个客户端生成的。接管时生成的那把，删之前说一句代价 */
  owner: KeyOwner | null;
  /** 真正去删。抛出的错误写在对话框里 */
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(deleteDialogText);
  const common = useText(commonText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(e);
      setPending(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent onOpenAutoFocus={focusSelf}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title(target.name)}</AlertDialogTitle>
          <AlertDialogDescription>{t.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* 这一步随手就做了，而代价要到下次接管才显出来 */}
        {owner && owner.kind !== "manual" && (
          <Banner layout="inline" tone="info" title={t.regenerated(owner.client)}>
            {t.keepIt}
          </Banner>
        )}
        <Banner show={error !== null} layout="inline" tone="error">
          {error !== null && errorText(error)}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{common.cancel}</AlertDialogCancel>
          <ConfirmAction variant="destructive" pending={pending} onConfirm={() => void run()}>
            {common.delete}
          </ConfirmAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
