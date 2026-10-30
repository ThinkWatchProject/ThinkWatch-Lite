import { useState, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
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
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Label } from "@/ui/label";
import { rowMotion, usePresentList } from "@/ui/motion";
import { PageSection } from "@/ui/page";
import { SecretInput } from "@/ui/secret-input";
import { Loadable, TableSkeleton } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { whenMinute } from "@/format";
import type { Resource } from "@/lib/resource";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { RedactException, RedactExceptions, SecurityEventView } from "@/types";
import { ruleName } from "./labels";
import { exceptionsText } from "./Exceptions.i18n";

/**
 * 密钥与隐私的例外值：某个值反复被误认时，只把这个值列为例外，规则照常工作。**例外跨规则**：
 * 列入之后这个值在任何规则下都不替换、不记录。
 *
 * 界面上只有打码后的样子（core 给的）；原值只在「添加例外」的输入框里，交给 core 之后不留。
 */

/** 「例外 · N 个值」一节，在规则表下方。没有例外时只有一句和「添加例外」 */
export function ExceptionsSection({
  r,
  onAdd,
  onRemove,
}: {
  r: Resource<RedactExceptions>;
  onAdd: () => void;
  onRemove: (item: RedactException) => void;
}) {
  const t = useText(exceptionsText);
  const data = r.data;
  const n = data?.items.length ?? 0;
  const full = data !== undefined && n >= data.max;
  return (
    <PageSection
      title={
        <>
          {t.title}
          {n > 0 && <span className="font-normal text-muted-foreground"> · {t.count(n)}</span>}
        </>
      }
      actions={
        data && (
          <>
            {full && <span className="tw-label text-muted-foreground">{t.full(data.max)}</span>}
            <Button size="sm" variant="outline" disabled={full} onClick={onAdd}>
              <PlusIcon />
              {t.add}
            </Button>
          </>
        )
      }
    >
      <Loadable r={r} loading={<TableSkeleton rows={2} cols={4} />}>
        {(d) =>
          d.items.length === 0 ? (
            <p className="tw-body text-muted-foreground">{t.none}</p>
          ) : (
            <ExceptionTable items={d.items} onRemove={onRemove} />
          )
        }
      </Loadable>
    </PageSection>
  );
}

/** 例外表：值（打码）、最先认出它的规则、加入时间、「移出例外」。先加的在前，和配置里一样 */
export function ExceptionTable({
  items,
  onRemove,
}: {
  items: RedactException[];
  onRemove: (item: RedactException) => void;
}) {
  const t = useText(exceptionsText);
  const shown = usePresentList(items, (x) => x.sha256);
  return (
    <Table className="table-fixed min-w-[560px]">
      <colgroup>
        <col />
        <col className="w-[220px]" />
        <col className="w-[120px]" />
        <col className="w-[96px]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>{t.value}</TableHead>
          <TableHead>{t.rule}</TableHead>
          <TableHead>{t.addedAt}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map(({ item: x, key, presence }) => (
          <TableRow key={key} className={rowMotion(presence)} data-slot="exception">
            <TableCell className="truncate font-mono tw-label" title={x.masked}>
              {x.masked}
            </TableCell>
            <TableCell className="truncate text-muted-foreground">
              {x.rule ? ruleName("redact", x.rule) : t.noRule}
            </TableCell>
            <TableCell className="tw-num text-muted-foreground">{whenMinute(x.added_at)}</TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2"
                aria-label={t.removeFor(x.masked)}
                onClick={() => onRemove(x)}
              >
                {t.remove}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * 跑一个会失败的写操作：失败时对话框留着，把 core 的话显示在里面；成功时由调用方关掉。
 */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(go: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await go();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/**
 * 手动添加一个例外值：还没出现在日志里的测试值。**值只在这个输入框里**，默认隐藏、小眼睛
 * 切换；交给 core 之后对话框关掉，值随之丢掉。
 */
export function AddExceptionDialog({ onAdd, onClose }: { onAdd: (value: string) => Promise<void>; onClose: () => void }) {
  const t = useText(exceptionsText);
  const common = useText(commonText);
  const [value, setValue] = useState("");
  const { busy, error, run } = useRun();
  const empty = value.trim().length === 0;
  const submit = () => {
    if (!empty && !busy) void run(() => onAdd(value));
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.addTitle}</DialogTitle>
          <DialogDescription>{t.addDesc}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Label htmlFor="exception-value">{t.addLabel}</Label>
          <SecretInput
            id="exception-value"
            value={value}
            placeholder={t.addPlaceholder}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </form>
        <Banner layout="inline" tone="error" title={t.addFailed} show={error !== null}>
          {error}
        </Banner>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {common.cancel}
          </Button>
          <Button pending={busy} disabled={empty} onClick={submit}>
            {t.add}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 确认对话框里的「值」「规则」两行 */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-border bg-surface/60 px-3 py-2 tw-body">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 把安全日志的一条列为例外。写明此值今后不再替换、不再记录，给出打码后的值和规则名。
 * 记录太早、无法从日志列入时，core 的话里说了改用「添加例外」，原样显示在对话框里
 */
export function ExceptDialog({
  e,
  onConfirm,
  onClose,
}: {
  e: SecurityEventView;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(exceptionsText);
  const common = useText(commonText);
  const { busy, error, run } = useRun();
  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.exceptTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.exceptDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <Facts
          rows={[
            [t.value, <span className="font-mono tw-label">{e.excerpt}</span>],
            [t.ruleLabel, ruleName(e.guard, e.rule, e.custom, e.rule_snapshot.name)],
          ]}
        />
        <Banner layout="inline" tone="error" title={t.exceptFailed} show={error !== null}>
          {error}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{common.cancel}</AlertDialogCancel>
          <AlertDialogConfirm pending={busy} onConfirm={() => void run(onConfirm)}>
            {t.exceptTitle}
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 移出例外。**移出之后不能撤销**：配置里只留着值的哈希，要再列入得重新粘贴原值，所以先确认
 */
export function RemoveExceptionDialog({
  item,
  onRemove,
  onClose,
}: {
  item: RedactException;
  onRemove: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(exceptionsText);
  const common = useText(commonText);
  const { busy, error, run } = useRun();
  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.removeTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.removeDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <Facts
          rows={[
            [t.value, <span className="font-mono tw-label">{item.masked}</span>],
            ...(item.rule ? [[t.ruleLabel, ruleName("redact", item.rule)] as [string, ReactNode]] : []),
          ]}
        />
        <Banner layout="inline" tone="error" title={t.removeFailed} show={error !== null}>
          {error}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{common.cancel}</AlertDialogCancel>
          <AlertDialogConfirm pending={busy} onConfirm={() => void run(onRemove)}>
            {t.remove}
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 日志、命中详情里「例外」的标签：这个值此刻是例外 */
export function ExceptedTag() {
  const t = useText(exceptionsText);
  return <Badge variant="outline">{t.tag}</Badge>;
}
