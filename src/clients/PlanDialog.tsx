import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Reveal } from "@/ui/motion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { DetectedClient, FieldChange, PlanView } from "@/types";
import { ClientMark, DISCLOSURE, Tile, useDialogFocus } from "@/keys/parts";
import { clientsText } from "./clients.i18n";

/**
 * 接管、还原之前的确认。**这一步不能省** —— 要改的是用户其他软件的配置。
 *
 * 顺序是用户要做决定的顺序：改哪个文件、改哪几项（密钥写成「新密钥 xxx」或
 * 「密钥 xxx」，新建和沿用对用户是两件事）、有什么要知道的；完整的改动默认
 * 收起 —— 需要逐行核对的人点开，其余的人不必读一段配置文件。
 *
 * 按下确认之后对话框留着、按钮转圈，写完才关；失败时对话框还在，可以再试。
 * 确认之后不再弹第二个对话框：行上的状态会变成「等待首个请求」。
 */
export function PlanDialog({
  plan,
  client,
  restore,
  pending,
  onCancel,
  onConfirm,
}: {
  plan: PlanView;
  client: DetectedClient;
  restore: boolean;
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
        <DialogHeader className="flex-row items-center gap-3">
          <Tile className="size-9 rounded-lg [&_svg]:size-[18px]">
            <ClientMark id={client.id} name={client.name} size={18} />
          </Tile>
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle>{restore ? t.restoreTitle(client.name) : t.adoptTitle(client.name)}</DialogTitle>
            <DialogDescription>{plan.before == null ? t.creates(path) : t.modifies(path)}</DialogDescription>
          </div>
        </DialogHeader>

        {plan.noop ? (
          <p className="tw-body">{t.noop}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {plan.fields.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t.field}</TableHead>
                      <TableHead>{restore ? t.change : t.written}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.fields.map((f) => (
                      <TableRow key={`${f.op} ${f.path}`} className="hover:bg-transparent">
                        <TableCell className="font-mono tw-label">{f.path}</TableCell>
                        <TableCell className="whitespace-normal break-all">
                          <FieldValue f={f} plan={plan} restore={restore} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {(plan.notes.length > 0 || (restore && plan.key)) && (
              <div className="flex flex-col gap-1">
                <p className="tw-head">{t.notes}</p>
                <ul className="flex list-disc flex-col gap-1 pl-5 tw-body text-muted-foreground">
                  {plan.notes.map((n, i) => (
                    <li key={i}>{coreText(n)}</li>
                  ))}
                  {restore && plan.key && <li>{t.keepsKey(plan.key)}</li>}
                </ul>
              </div>
            )}

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
                <Diff before={plan.before} after={plan.after} />
                {plan.carries_secret && <p className="mt-1.5 tw-label text-muted-foreground">{t.secretMasked}</p>}
              </Reveal>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {common.cancel}
          </Button>
          {!plan.noop && (
            <Button variant={restore ? "destructive" : "default"} pending={pending} onClick={onConfirm}>
              {restore ? t.confirmRestore : t.confirmAdopt}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 一项改动写成什么：密钥写名字，删除写「删除」，其余写值 */
function FieldValue({ f, plan, restore }: { f: FieldChange; plan: PlanView; restore: boolean }) {
  const t = useText(clientsText);
  if (f.op === "remove") return <span className="text-muted-foreground">{t.remove}</span>;
  if (f.secret) {
    const name = plan.key ?? "";
    return <span>{plan.key_created && !restore ? t.newKey(name) : t.keyNamed(name)}</span>;
  }
  if (restore) return <span className="font-mono tw-label">{t.restoreTo(f.value ?? "")}</span>;
  return <span className="font-mono tw-label">{f.value}</span>;
}

/**
 * 逐行 diff。
 *
 * **删掉的行必须留在它原来的位置上。**第一版把所有删除行提到最前面，
 * 于是「给 MY_OWN 那行末尾加了个逗号」被画成「你的 MY_OWN 被删了，
 * 另外新增了一行」—— 用户看到自己的字段带着删除线出现在最上面，正是
 * 这个对话框本来要消除的那种恐慌。
 *
 * 所以用最长公共子序列：没动的行原地不动，改动的行紧挨着显示。
 */
export function Diff({ before, after }: { before: string | null; after: string }) {
  const a = (before ?? "").split("\n");
  const b = after.split("\n");

  // LCS 表。配置文件都是几十行，O(n·m) 完全够用。
  // 摊平成一维的 Uint32Array —— 二维数组每次下标访问在
  // noUncheckedIndexedAccess 下都是 `number | undefined`
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  const line = (xs: string[], k: number) => xs[k] ?? "";
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        line(a, i) === line(b, j)
          ? lcs[(i + 1) * w + j + 1]! + 1
          : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const rows: { text: string; kind: "add" | "del" | "same" }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (line(a, i) === line(b, j)) {
      rows.push({ text: line(a, i), kind: "same" });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      rows.push({ text: line(a, i), kind: "del" });
      i++;
    } else {
      rows.push({ text: line(b, j), kind: "add" });
      j++;
    }
  }
  while (i < n) rows.push({ text: line(a, i++), kind: "del" });
  while (j < m) rows.push({ text: line(b, j++), kind: "add" });

  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-surface p-2 font-mono tw-label leading-relaxed">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.kind === "add"
              ? "bg-success/10 text-success-foreground"
              : r.kind === "del"
                ? "bg-destructive/8 text-destructive-foreground line-through"
                : "text-muted-foreground"
          }
        >
          {r.kind === "add" ? "+ " : r.kind === "del" ? "- " : "  "}
          {r.text}
        </div>
      ))}
    </pre>
  );
}
