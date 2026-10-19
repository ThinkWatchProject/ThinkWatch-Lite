import { Fragment, useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { focusSelf } from "@/ui/dialog-focus";
import { Input } from "@/ui/input";
import { Segmented } from "@/ui/segmented";
import { ErrorState, ListSkeleton } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useResource } from "@/lib/resource";
import { whenMinute } from "@/format";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import type { SyncConflict, SyncConflictDiff, SyncConflictSide, SyncTake, SyncView } from "@/types";
import { SYNC_KEYS, syncApi } from "./api";
import { conflictText } from "./ConflictDialog.i18n";
import {
  initialConflictPicks,
  keepBothProblem,
  remoteDevice,
  resolveDecisions,
  type ConflictPicks,
} from "./decide";
import { itemWithUnits, unitLabel } from "./labels";

/**
 * 同步冲突（方案 6.7）：同一个合并单位在本机和另一台设备上被改成了不同的内容。每一项选
 * 「使用本机」「使用 <那台设备>」或「两者都保留」（另一方的内容以新名字加进来；全局设置、
 * 路由顺序、通用偏好没有这一项）。
 *
 * 点对象名称展开差异：每个合并单位两边各是什么（core 给的 `diff`，删掉的一边写「已删除」）。
 *
 * **只交选了的**：没选的留着，下次再处理（「稍后处理」）。处理的结果作为新版本上传，别的
 * 设备随之清掉同一条冲突，不用再处理一遍 —— 那是 core 的事，这里只交选择。
 */
export function ConflictDialog({ onClose, onResolved }: { onClose: () => void; onResolved: (v: SyncView) => void }) {
  const t = useText(conflictText);
  const list = useResource(SYNC_KEYS.conflicts, syncApi.conflicts, { events: ["sync_status", "config_reloaded"] });
  const [picks, setPicks] = useState<ConflictPicks>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conflicts = list.data;
  // 新冲突到了（或者别的设备处理了几项）：新来的给缺省值，选过的保留
  useEffect(() => {
    if (!conflicts) return;
    setPicks((prev) => ({ ...initialConflictPicks(conflicts), ...prev }));
  }, [conflicts]);

  const decisions = conflicts ? resolveDecisions(conflicts, picks) : [];
  const left = conflicts ? conflicts.length - decisions.length : 0;
  const device = conflicts ? remoteDevice(conflicts) : null;

  async function apply() {
    if (!conflicts) return;
    setBusy(true);
    setError(null);
    try {
      const v = await syncApi.resolve(decisions);
      onResolved(v);
      if (decisions.length === conflicts.length) onClose();
      else void list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-4 sm:max-w-[760px]" onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.title}</DialogTitle>
          <DialogDescription>{t.desc}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1">
          {conflicts === undefined ? (
            list.error !== undefined && !list.loading ? (
              <ErrorState title={t.loadFailed} error={list.error} onRetry={() => void list.reload()} />
            ) : (
              <ListSkeleton rows={2} />
            )
          ) : conflicts.length === 0 ? (
            <p className="tw-body text-muted-foreground">{t.none}</p>
          ) : (
            <div className="rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[34%]">{t.object}</TableHead>
                    <TableHead>{t.here}</TableHead>
                    <TableHead>{device ?? t.other}</TableHead>
                    <TableHead className="text-right">{t.take}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conflicts.map((c) => (
                    <Row
                      key={c.id}
                      c={c}
                      showDevice={device === null}
                      pick={picks[c.id]}
                      disabled={busy}
                      onPick={(p) => setPicks((all) => ({ ...all, [c.id]: { ...all[c.id]!, ...p } }))}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Banner layout="inline" tone="error" show={error !== null} title={t.failed}>
            {error}
          </Banner>
        </div>

        <DialogFooter className="items-center">
          {conflicts && conflicts.length > 0 && left > 0 && (
            <span className="tw-label text-muted-foreground sm:mr-auto">{t.left(left)}</span>
          )}
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t.later}
          </Button>
          <Button pending={busy} disabled={busy || decisions.length === 0} onClick={() => void apply()}>
            {t.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  c,
  showDevice,
  pick,
  disabled,
  onPick,
}: {
  c: SyncConflict;
  /** 冲突来自不同的设备：表头写不出一个名字，每一格写上是哪一台 */
  showDevice: boolean;
  pick: { take: SyncTake | null; name: string } | undefined;
  disabled: boolean;
  onPick: (p: Partial<{ take: SyncTake; name: string }>) => void;
}) {
  const t = useText(conflictText);
  const [open, setOpen] = useState(false);
  const problem = keepBothProblem(c, pick);
  // core 说这一处能选哪几种（合并结果过不了校验时没有「使用另一台」，不能两者都保留时没有那一项）
  const label: Record<SyncTake, string> = { local: t.here, remote: c.remote.device, both: t.both };
  const options = c.options.map((id) => ({ id, label: label[id] }));
  return (
    <Fragment>
      <TableRow className="hover:bg-transparent">
        <TableCell className="max-w-0 align-top whitespace-normal">
          {c.diff.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              title={open ? t.hideDiff : t.showDiff}
              className="-ml-1 flex items-start gap-0.5 rounded-sm px-1 text-left break-words hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring/50"
              onClick={() => setOpen((o) => !o)}
            >
              <ChevronRightIcon
                aria-hidden
                className={cn("mt-[3px] size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
              />
              <span>{itemWithUnits(c.item, c.units)}</span>
            </button>
          ) : (
            <p className="break-words">{itemWithUnits(c.item, c.units)}</p>
          )}
          {c.reason && (
            <p className="mt-0.5 tw-label text-warning-foreground">{c.reason === "key_in_use" ? t.keyInUse : t.invalid}</p>
          )}
        </TableCell>
        <TableCell className="align-top tw-num text-muted-foreground">
          <Side side={c.local} />
        </TableCell>
        <TableCell className="align-top tw-num text-muted-foreground">
          {showDevice && <p className="text-foreground">{c.remote.device}</p>}
          <Side side={c.remote} />
        </TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col items-end gap-1">
            <Segmented<SyncTake>
              label={t.take}
              value={pick?.take ?? ("" as SyncTake)}
              disabled={disabled}
              options={options}
              onChange={(take) => onPick({ take })}
            />
            {pick?.take === "both" && (
              <>
                <Input
                  variant="sm"
                  className="w-56 motion-fade"
                  aria-label={t.bothName(c.item.name)}
                  title={t.bothNameHint}
                  aria-invalid={problem !== null || undefined}
                  value={pick.name}
                  disabled={disabled}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => onPick({ name: e.target.value })}
                />
                {problem && (
                  <span className="tw-label text-destructive">{problem === "empty" ? t.bothEmpty : t.bothSame}</span>
                )}
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4} className="bg-muted/30 whitespace-normal">
            <Diff diff={c.diff} remote={c.remote.device} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}

/** 一个冲突的差异：每个合并单位一行，本机和另一台设备的内容并排 */
function Diff({ diff, remote }: { diff: SyncConflictDiff[]; remote: string }) {
  const t = useText(conflictText);
  return (
    <div className="flex flex-col gap-2 py-1 motion-fade">
      {diff.map((d) => (
        <div key={d.unit} className="flex flex-col gap-1">
          {d.unit !== "all" && <p className="tw-label font-medium text-muted-foreground">{unitLabel(d.unit)}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Value label={t.here} value={d.local} />
            <Value label={remote} value={d.remote} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 一边的内容：JSON 原样排好；这一边删掉了写「已删除」 */
function Value({ label, value }: { label: string; value: unknown }) {
  const t = useText(conflictText);
  return (
    <div className="min-w-0">
      <p className="mb-0.5 tw-label text-muted-foreground">{label}</p>
      {value === null || value === undefined ? (
        <p className="tw-body text-muted-foreground italic">{t.deleted}</p>
      ) : (
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-popover px-2 py-1.5 font-mono tw-label whitespace-pre-wrap break-all select-text">
          {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function Side({ side }: { side: SyncConflictSide }) {
  const t = useText(conflictText);
  const when = whenMinute(side.at_ms);
  return <p>{side.deleted ? t.deletedAt(when) : t.changedAt(when)}</p>;
}
