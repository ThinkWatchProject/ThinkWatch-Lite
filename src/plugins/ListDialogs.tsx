import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { ConfirmAction, focusSelf } from "@/keys/parts";
import { useReorder } from "@/routing/useReorder";
import { DialogError } from "@/upstreams/parts";
import type { PluginView } from "@/types";
import { pluginName } from "./defaults";
import { manifestUnknown } from "./model";
import { PluginText, StatusOf } from "./parts";
import { pluginsPageText } from "./PluginsPage.i18n";

/** 列表以外的地方怎么叫它：默认插件按界面语言，读不出 manifest 的是 id */
const nameOf = (p: PluginView) => (manifestUnknown(p) ? p.id : pluginName(p.id, p.name));

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
          <AlertDialogTitle>{t.deleteTitle(<PluginText text={nameOf(target)} />)}</AlertDialogTitle>
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
 * 调整运行顺序。**顺序有意义**：前一个插件改过的内容交给后一个。拖动一行（按住左边的把手，
 * 或者整行的空白处）放到别处，也可以用每行右边的上移、下移（键盘用这两个）。排好了一次保存，
 * 写成一个配置版本（`ReorderPlugins`），不是每挪一下写一次。
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
  const reorder = useReorder((from, to) => setOrder((o) => moved(o, from, to)));
  /** 按钮挪到头之后自己失效了：焦点交给同一行的另一个按钮，键盘接着能按 */
  const [refocus, setRefocus] = useState<{ id: string; dir: "up" | "down" } | null>(null);
  const list$ = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!refocus) return;
    list$.current
      ?.querySelector<HTMLButtonElement>(`[data-row="${CSS.escape(refocus.id)}"] [data-move="${refocus.dir}"]`)
      ?.focus();
    setRefocus(null);
  }, [refocus]);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const id = order[i]!;
    setOrder((o) => moved(o, i, j));
    // 挪到了头（或尾）：这个方向的按钮失效，焦点换到另一个
    if (j === 0) setRefocus({ id, dir: "down" });
    else if (j === order.length - 1) setRefocus({ id, dir: "up" });
  };

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
        <ol ref={list$} className="flex flex-col overflow-hidden rounded-lg border border-border select-none">
          {order.map((id, i) => {
            const p = byId.get(id);
            if (!p) return null;
            const mark = reorder.marker(i, order.length);
            return (
              <li
                key={id}
                data-row={id}
                data-reorder-row={i}
                className={cn(
                  "flex h-10 items-center gap-1 border-b border-border pr-1.5 last:border-b-0",
                  reorder.dragging === i && "bg-muted/60 opacity-60",
                  mark === "before" && "shadow-[inset_0_2px_0_var(--color-foreground)]",
                  mark === "after" && "shadow-[inset_0_-2px_0_var(--color-foreground)]",
                )}
              >
                {/* 把手和名字这一段都能拖；右边的按钮不在里面，点它们不会开始拖动 */}
                <span
                  className="flex h-full min-w-0 flex-1 items-center gap-3 pl-2"
                  aria-label={t.dragPlugin(nameOf(p))}
                  {...(saving ? {} : reorder.handle(i))}
                >
                  <GripVerticalIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                  <span className="w-4 shrink-0 text-right tw-num text-muted-foreground">{i + 1}</span>
                  <PluginText text={nameOf(p)} className="min-w-0 flex-1 truncate tw-body" />
                  <StatusOf status={p.status} />
                </span>
                <span className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-move="up"
                    aria-label={t.moveUp(nameOf(p))}
                    disabled={i === 0 || saving}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    data-move="down"
                    aria-label={t.moveDown(nameOf(p))}
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

/** 把第 `from` 个挪到第 `to` 个的位置（拿走之后的下标），别的顺次让开 */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}
