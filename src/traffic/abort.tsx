import { useState } from "react";
import { call } from "@/control";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { RequestRow } from "@/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogConfirm,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
import { focusSelf } from "@/ui/dialog-focus";
import { notify } from "@/ui/notify";
import { abortText } from "./abort.i18n";

/**
 * 这一行能不能手动中止：还在跑，而且不是跑在 WebSocket 连接上的（那种跟着连接走，core 不
 * 单独中止它）
 */
export const abortable = (r: Pick<RequestRow, "state" | "ws">): boolean => r.state === "in_flight" && !r.ws;

/**
 * 中止一个在跑的请求。**不弹确认**：菜单里点的就是这一条，叫停之后它照常从事件流上收场
 * （那一行变成「手动中止」），用不着再报一次成功。叫停不成（它刚好跑完了）说一声
 */
export async function abortRequest(id: number): Promise<void> {
  try {
    await call("AbortRequest", null, id);
  } catch (e) {
    notify.error(e, textOf(abortText).failed);
  }
}

/**
 * 中止一次会话里所有在跑的请求之前的确认。`session` 为 `null` 时关着；`running` 是此刻在跑、
 * 能中止的有几个。按下之后对话框留着、按钮转圈，叫停了才关；叫停不成，原因写在对话框里
 */
export function AbortSessionDialog({
  session,
  running,
  onClose,
}: {
  session: string | null;
  running: number;
  onClose: () => void;
}) {
  const t = useText(abortText);
  const common = useText(commonText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };
  async function run(id: string) {
    setPending(true);
    setError(null);
    try {
      await call("AbortSession", null, id);
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={session !== null} onOpenChange={(o) => !o && !pending && close()}>
      <AlertDialogContent onOpenAutoFocus={focusSelf}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>{t.body(Math.max(running, 1))}</AlertDialogDescription>
        </AlertDialogHeader>
        <Banner layout="inline" tone="error" show={error !== null} title={t.failed}>
          {error}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{common.cancel}</AlertDialogCancel>
          <AlertDialogConfirm
            variant="destructive"
            pending={pending}
            onConfirm={() => session !== null && void run(session)}
          >
            {t.confirm}
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
