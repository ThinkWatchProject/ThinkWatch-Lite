import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { invalidate } from "@/lib/resource";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { ErrorState, TableSkeleton } from "@/ui/states";
import { Spinner } from "@/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { whenMinute } from "@/format";
import { PluginConfirmNotice } from "@/ConfigText";
import { needsConfirmation } from "@/plugins/write";
import { DialogError } from "@/upstreams/parts";
import { FixList } from "@/repair";
import type { BackupEntry, ItemRef, RestorePreview, RestoreRow } from "@/types";
import { BACKUPS_KEY, backupApi } from "./api";
import { backupText } from "./backup.i18n";
import { groupBy, itemLabel, kindLabel, namedById, originLabel, refKey } from "./items";
import { planRows, selectable, selection, tallyWritten, type PlanRow } from "./restorePlan";

const STALE = "control.config_stale";

/** 改了勾选之后等这么久再去要计划：连着点几下只要一次 */
const REPLAN_MS = 300;

/**
 * 恢复一个备份版本（规格 7.2）：按项目列出该版本与当前配置的差异，缺省全勾，即整体换成该版本；
 * 取消勾选的保持当前内容。本机设置和同名 ChatGPT 上游的登录由 core 保留当前的。
 *
 * **改了勾选，表上的变化以 core 的计划为准**：用所选的几项重新预览（`items`），一并恢复的、因
 * 被引用而保留的照它写（`restorePlan.ts`）。恢复按的是同一个计划；完成后的提示按实际动了的写。
 *
 * 恢复本身也是一个新版本，可以再恢复回来。
 */
export function RestoreDialog({
  entry,
  onClose,
  onRestored,
  onOpenPlugins,
}: {
  entry: BackupEntry;
  onClose: () => void;
  onRestored?: () => void;
  /** 关掉这里、去插件页（恢复的版本要装上、启用改得了工具调用的插件时） */
  onOpenPlugins?: () => void;
}) {
  const t = useText(backupText);
  const c = useText(commonText);
  /** 整个版本的差异：表的骨架 */
  const [base, setBase] = useState<RestorePreview | null>(null);
  const [baseError, setBaseError] = useState<unknown>(undefined);
  /** 此刻所选的计划（和 `planFor` 对应），没取到之前是 null */
  const [plan, setPlan] = useState<RestorePreview | null>(null);
  /** 计划是按哪一份所选取的（`JSON` 写法）；和此刻的所选不一样时，计划还在路上 */
  const [planFor, setPlanFor] = useState<string | null>(null);
  /** 取消勾选的（其余都恢复） */
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pluginRefusal, setPluginRefusal] = useState<string | null>(null);
  const at = whenMinute(entry.at_ms);
  /** 只认最后一次要的计划 */
  const asked = useRef(0);

  const loadBase = useCallback(() => {
    setBaseError(undefined);
    setStale(false);
    const n = ++asked.current;
    backupApi.restorePreview(entry.id, null).then(
      (p) => {
        if (n !== asked.current) return;
        setBase(p);
        setPlan(p);
        setPlanFor(JSON.stringify(null));
        // 差异变了：取消勾选的那几项里不在了的去掉
        const keys = new Set(p.rows.map((r) => refKey(r.item)));
        setUnchecked((u) => (Array.from(u).every((k) => keys.has(k)) ? u : new Set(Array.from(u).filter((k) => keys.has(k)))));
      },
      (e: unknown) => n === asked.current && setBaseError(e),
    );
  }, [entry.id]);
  useEffect(loadBase, [loadBase]);

  const items: ItemRef[] | null = base ? selection(base.rows, unchecked) : null;
  const want = JSON.stringify(items);

  // 勾选变了：所选的几项重新要一次计划（全选就是整个版本，用骨架那一份）
  useEffect(() => {
    if (!base || want === planFor) return;
    if (items === null) {
      setPlan(base);
      setPlanFor(want);
      return;
    }
    if (items.length === 0) return;
    const n = ++asked.current;
    const h = setTimeout(() => {
      backupApi.restorePreview(entry.id, items).then(
        (p) => {
          if (n !== asked.current) return;
          setPlan(p);
          setPlanFor(want);
        },
        (e: unknown) => n === asked.current && setError(errorText(e)),
      );
    }, REPLAN_MS);
    return () => clearTimeout(h);
    // `items` 由 `want` 决定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, want, planFor, entry.id]);

  async function run(p: RestorePreview) {
    setBusy(true);
    setError(null);
    setPluginRefusal(null);
    try {
      const w = await backupApi.restore(entry.id, p.base_version, items);
      const n = tallyWritten(w.rows);
      notify.success(t.restored(at, n.restored, n.kept));
      invalidate(BACKUPS_KEY);
      onRestored?.();
      onClose();
    } catch (e) {
      if (typeof e === "object" && e !== null && (e as { code?: unknown }).code === STALE) setStale(true);
      else if (needsConfirmation(e)) setPluginRefusal(errorText(e));
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const chosen = base ? base.rows.filter((r) => selectable(r) && !unchecked.has(refKey(r.item))).length : 0;
  /** 计划和此刻的勾选对得上（没在路上）才能恢复 */
  const settled = plan !== null && planFor === want;
  const shown = base && plan ? planRows(base.rows, plan.rows, unchecked) : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-3 sm:max-w-[640px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.restoreVersion(at)}</DialogTitle>
          <DialogDescription>
            {originLabel(entry.origin, entry.device)} · {t.restoreDescription}
          </DialogDescription>
        </DialogHeader>

        <Banner
          show={stale}
          layout="inline"
          tone="warning"
          title={t.stale}
          actions={
            <Button size="sm" variant="outline" onClick={loadBase}>
              {t.previewAgain}
            </Button>
          }
        />
        {pluginRefusal && (
          <PluginConfirmNotice reason={pluginRefusal} result="notRestored" onOpenPlugins={onOpenPlugins} />
        )}

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-y border-border px-4">
          {base === null ? (
            baseError !== undefined ? (
              <ErrorState compact title={t.previewFailed} error={baseError} onRetry={loadBase} />
            ) : (
              <TableSkeleton rows={4} cols={2} />
            )
          ) : base.rows.length === 0 ? (
            <p className="py-6 text-center tw-body text-muted-foreground">{t.unchanged}</p>
          ) : (
            <>
              {(plan ?? base).repairs.length > 0 && (
                <Banner layout="inline" tone="info" title={t.repaired((plan ?? base).repairs.length)} className="mt-3">
                  <FixList fixes={(plan ?? base).repairs} />
                </Banner>
              )}
              <ChangesTable
                rows={shown}
                disabled={busy}
                onToggle={(keys, on) =>
                  setUnchecked((u) => {
                    const next = new Set(u);
                    for (const k of keys) {
                      if (on) next.delete(k);
                      else next.add(k);
                    }
                    return next;
                  })
                }
              />
            </>
          )}
        </div>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          <span className="mr-auto flex items-center gap-1.5 tw-label text-muted-foreground">
            {base && base.rows.length > 0 && chosen === 0 ? (
              t.nothingChecked
            ) : !settled && base ? (
              <>
                <Spinner className="size-3" aria-hidden />
                {t.replanning}
              </>
            ) : plan && plan.sync_devices > 0 ? (
              t.syncNote(plan.sync_devices)
            ) : null}
          </span>
          <Button variant="outline" onClick={onClose}>
            {c.cancel}
          </Button>
          <Button
            pending={busy}
            disabled={!settled || chosen === 0 || stale}
            onClick={() => plan && void run(plan)}
          >
            {t.restoreAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 差异表：按类分组，一行一项，前面是勾选框；表头的勾选框管全部。变化一列照 core 的计划写：
 * 勾着的写新增、删除、修改；没勾的写「保持当前内容」，被所选项目带着的写「一并恢复」；保留的
 * 写原因
 */
function ChangesTable({
  rows,
  disabled,
  onToggle,
}: {
  rows: readonly PlanRow[];
  disabled: boolean;
  onToggle: (keys: string[], on: boolean) => void;
}) {
  const t = useText(backupText);
  const keys = rows.filter((r) => r.box).map((r) => refKey(r.row.item));
  const on = rows.filter((r) => r.box && r.checked).length;
  const all = on === keys.length ? true : on === 0 ? false : "indeterminate";
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8">
            <Checkbox
              checked={all}
              disabled={disabled || keys.length === 0}
              aria-label={t.item}
              onCheckedChange={(v) => onToggle(keys, v === true)}
            />
          </TableHead>
          <TableHead>{t.item}</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">{t.change}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groupBy(rows, (r) => r.row.item).map((g) => (
          <Fragment key={g.kind}>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="bg-muted/40 py-1.5 tw-label font-medium text-muted-foreground">
                {kindLabel(g.kind)}
              </TableCell>
            </TableRow>
            {g.items.map((p) => {
              const r = p.row;
              const k = refKey(r.item);
              return (
                <TableRow key={k} className="hover:bg-transparent">
                  <TableCell>
                    {p.box && (
                      <Checkbox
                        checked={p.checked}
                        disabled={disabled}
                        aria-label={itemLabel(r.item)}
                        onCheckedChange={(v) => onToggle([k], v === true)}
                      />
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "max-w-0 truncate",
                      namedById(r.item) && "font-mono",
                      p.note === "untouched" && "text-muted-foreground",
                    )}
                  >
                    {itemLabel(r.item)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Change p={p} />
                  </TableCell>
                </TableRow>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function Change({ p }: { p: PlanRow }) {
  const t = useText(backupText);
  const r: RestoreRow = p.row;
  if (p.note === "kept" || r.kept) {
    return (
      <span className="tw-label text-muted-foreground">
        {r.kept === "key_in_use" ? t.keptInUse : t.keptReferenced}
      </span>
    );
  }
  if (p.note === "untouched") return <span className="tw-label text-muted-foreground">{t.untouched}</span>;
  const badge = (
    <Badge variant={r.change === "remove" ? "destructive" : r.change === "add" ? "secondary" : "warning"}>
      {t.changes[r.change]}
    </Badge>
  );
  if (p.note === "along") {
    return (
      <span className="inline-flex items-center gap-1.5">
        {badge}
        <span className="tw-label text-muted-foreground">{t.along2}</span>
      </span>
    );
  }
  return badge;
}
