import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
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
import { errorText } from "@/i18n/core.i18n";
import { ConfirmAction, focusSelf } from "@/keys/parts";
import { DialogError } from "@/upstreams/parts";
import type { PluginView } from "./api.provisional";
import { PluginText, StatusOf } from "./parts";
import { pluginsPageText } from "./PluginsPage.i18n";

/**
 * 删除一个插件的确认。按下「删除」之后对话框留着、按钮转圈，直到 core 回话：成功了才关
 * （那一行随之淡出），失败了原因写在这里（和删除密钥同一个做法）。
 */
export function DeleteDialog({
  target,
  onDelete,
  onClose,
}: {
  target: PluginView;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(pluginsPageText);
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
          <AlertDialogTitle>{t.deleteTitle(<PluginText text={target.name} />)}</AlertDialogTitle>
          <AlertDialogDescription>{t.deleteDescription}</AlertDialogDescription>
        </AlertDialogHeader>
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

/**
 * 调整运行顺序。**顺序有意义**：前一个插件改过的内容交给后一个。上下移好了一次保存，写成
 * 一个配置版本（`ReorderPlugins`），不是每挪一下写一次。
 */
export function ReorderDialog({
  list,
  onSave,
  onClose,
}: {
  list: PluginView[];
  onSave: (ids: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(pluginsPageText);
  const common = useText(commonText);
  const [order, setOrder] = useState(() => list.map((p) => p.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(list.map((p) => [p.id, p]));
  const dirty = order.some((id, i) => id !== list[i]?.id);

  const move = (i: number, d: -1 | 1) =>
    setOrder((o) => {
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave(order);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle>{t.reorderTitle}</DialogTitle>
          <DialogDescription>{t.reorderDescription}</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col overflow-hidden rounded-lg border border-border">
          {order.map((id, i) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <li key={id} className="flex h-10 items-center gap-3 border-b border-border pr-1.5 pl-3 last:border-b-0">
                <span className="w-4 shrink-0 text-right tw-num text-muted-foreground">{i + 1}</span>
                <PluginText text={p.name} className="min-w-0 flex-1 truncate tw-body" />
                <StatusOf status={p.status} />
                <span className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.moveUp(p.name)}
                    disabled={i === 0 || saving}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.moveDown(p.name)}
                    disabled={i === order.length - 1 || saving}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
        <DialogError error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {common.cancel}
          </Button>
          <Button onClick={() => void save()} pending={saving} disabled={!dirty}>
            {common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
