import { useState } from "react";
import { ArrowRightIcon, LayersIcon, SplitIcon } from "lucide-react";
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
import { Spinner } from "@/ui/spinner";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ReferenceView } from "@/types";
import { deleteDialogText } from "./DeleteDialog.i18n";
import { errorText } from "./labels";
import { Note } from "./parts";

/** 引用了要删的东西的一处 */
export type Referrer =
  | { kind: "reference"; ref: ReferenceView }
  /** 使用某个代理或价目表的上游 */
  | { kind: "upstream"; name: string };

/**
 * 删除确认。**还被引用时不给删除按钮** —— 标题直接说「无法删除」，列出是谁
 * 在用，每一处都能跳过去解除。
 */
export function DeleteDialog({
  what,
  name,
  referrers,
  consequence,
  onDelete,
  onClose,
  onShow,
}: {
  /** 「上游」「代理」「价目表」 */
  what: string;
  name: string;
  referrers: Referrer[];
  /** 删除之后会怎样，一句话 */
  consequence: string;
  onDelete: () => Promise<void>;
  onClose: () => void;
  /** 跳到那一处 */
  onShow: (r: Referrer) => void;
}) {
  const t = useText(deleteDialogText);
  const c = useText(commonText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = referrers.length > 0;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{blocked ? t.blockedTitle(what, name) : t.title(what, name)}</AlertDialogTitle>
          <AlertDialogDescription>{blocked ? t.blocked(what) : consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {blocked && (
          <div className="overflow-hidden rounded-lg border border-border">
            {referrers.map((r, i) => (
              <div
                key={i}
                className="flex h-9 items-center gap-2 border-b border-border px-2.5 tw-body last:border-b-0"
              >
                {r.kind === "reference" && r.ref.kind === "group" ? (
                  <LayersIcon className="size-3.5 text-muted-foreground" />
                ) : (
                  <SplitIcon className="size-3.5 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate">{describe(r)}</span>
                <div className="flex-1" />
                <Button variant="ghost" size="xs" onClick={() => onShow(r)}>
                  {t.show}
                  <ArrowRightIcon />
                </Button>
              </div>
            ))}
          </div>
        )}
        {error && <Note tone="error">{error}</Note>}
        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? c.close : c.cancel}</AlertDialogCancel>
          {!blocked && (
            <Button variant="destructive" onClick={run} disabled={busy}>
              {busy && <Spinner />}
              {c.delete}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function describe(r: Referrer): string {
  const t = textOf(deleteDialogText);
  if (r.kind === "upstream") return t.upstream(r.name);
  switch (r.ref.kind) {
    case "rule_target":
      return t.rule(r.ref.route, r.ref.rule);
    case "rule_condition":
      return t.condition(r.ref.route, r.ref.rule);
    case "group":
      return t.group(r.ref.group);
  }
}
