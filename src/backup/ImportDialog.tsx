import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { invalidate } from "@/lib/resource";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { notify } from "@/ui/notify";
import { SecretInput } from "@/ui/secret-input";
import { Segmented } from "@/ui/segmented";
import { LoadingState } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { whenMinute } from "@/format";
import { DialogError } from "@/upstreams/parts";
import type { ImportAction, ImportPreview, ImportRow, ItemKind, ItemRef, PickedFile } from "@/types";
import { FixList } from "@/repair";
import { useRemote } from "@/connection/useRemote";
import { BACKUPS_KEY, backupApi } from "./api";
import { backupText } from "./backup.i18n";
import { useConfigItems } from "./ExportDialog";
import {
  actionsFor,
  blocked,
  bulk,
  carryOver,
  decisions,
  initialChoices,
  listed,
  nameProblems,
  tally,
  unresolved,
  rowNotes,
  writing,
  type Choices,
  type RowNote,
} from "./importFlow";
import { differsLabel, groupBy, itemLabel, kindLabel, namedById, refKey } from "./items";

/** core 说配置包要口令、口令不对（tw-pack 的 `NeedPassphrase` / `WrongPassphrase`） */
const NEED_PASSPHRASE = "pack.need_passphrase";
const WRONG_PASSPHRASE = "pack.wrong_passphrase";
/** 预览之后配置被改过：导入被拒，重新预览 */
const STALE = "control.config_stale";

const codeOf = (e: unknown) =>
  typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;

type Phase =
  | { kind: "reading" }
  | { kind: "passphrase"; error: string | null }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; preview: ImportPreview };

/**
 * 导入配置（规格 5.3–5.5）：先预览，逐项列出新增、冲突、错误（相同的只计数），冲突逐项选
 * 覆盖 / 改名导入 / 跳过，没选完「导入」按不下去。加密的配置包先要口令。
 *
 * 预览之后配置被改过（别处改了、同步来了）：导入被拒，说一声、给「重新预览」。
 */
export function ImportDialog({
  file,
  onClose,
  onImported,
}: {
  file: PickedFile;
  onClose: () => void;
  /** 导入成功：外面重读概览 */
  onImported?: () => void;
}) {
  const t = useText(backupText);
  const c = useText(commonText);
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const [passphrase, setPassphrase] = useState("");
  /** 预览用过的口令：导入时带同一个 */
  const used = useRef<string | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const items = useConfigItems();
  const remote = useRemote() !== null;

  const preview = useCallback(
    async (pass: string | null) => {
      setError(null);
      setStale(false);
      try {
        const p = await backupApi.preview(file, pass);
        used.current = pass;
        // 重新预览（配置在预览之后被改过）：已经选好的处理留着
        setChoices((before) => carryOver(p.rows, initialChoices(p.rows), before));
        setPhase({ kind: "ready", preview: p });
      } catch (e) {
        const code = codeOf(e);
        if (code === NEED_PASSPHRASE) setPhase({ kind: "passphrase", error: null });
        else if (code === WRONG_PASSPHRASE) setPhase({ kind: "passphrase", error: errorText(e) });
        else setPhase({ kind: "failed", error: e });
      }
    },
    [file],
  );
  useEffect(() => {
    void preview(null);
  }, [preview]);

  const taken = useMemo(() => {
    const m = new Map<ItemKind, Set<string>>();
    for (const n of items.data ?? []) {
      const s = m.get(n.item.kind) ?? new Set<string>();
      s.add(n.item.name);
      m.set(n.item.kind, s);
    }
    return m;
  }, [items.data]);

  async function run(p: ImportPreview) {
    setBusy(true);
    setError(null);
    try {
      const ds = decisions(p.rows, choices);
      await backupApi.import(file, used.current, p.base_version, ds);
      // 连着远程 core：通用偏好在这台设备上，配置包里带着的由这里应用（本机模式下 core 存着，
      // 变了它自己说一声）
      if (remote && p.client_prefs != null) {
        await backupApi.applyClientPrefs(p.client_prefs).catch((e: unknown) => notify.error(e));
      }
      notify.success(t.imported(writing(ds)));
      invalidate(BACKUPS_KEY);
      onImported?.();
      onClose();
    } catch (e) {
      if (codeOf(e) === STALE) setStale(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = phase.kind === "ready" ? phase.preview : null;
  const rows = ready ? ready.rows : [];
  const problems = ready ? nameProblems(rows, choices, taken) : {};
  const stuck = ready ? blocked(rows, choices) : {};
  const open = ready ? unresolved(rows, choices) : 0;
  const ds = ready ? decisions(rows, choices) : [];
  const count = writing(ds);
  const bad = Object.keys(problems).length > 0;
  const n = tally(rows);
  const footNote = !ready
    ? null
    : open > 0
      ? t.unresolved(open)
      : bad
        ? t.badNames
        : listed(rows).length === 0
          ? t.allSame
          : count === 0
            ? t.nothing
            : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-3 sm:max-w-[760px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.importTitle}</DialogTitle>
          <DialogDescription className="truncate">
            {ready ? <PackLine name={file.name} p={ready} /> : <span className="font-mono">{file.name}</span>}
          </DialogDescription>
        </DialogHeader>

        {phase.kind === "reading" && <LoadingState label={t.reading} className="py-10" />}

        {phase.kind === "failed" && (
          <Banner layout="inline" tone="error" title={t.readFailed}>
            <span className="select-text break-words">{errorText(phase.error)}</span>
          </Banner>
        )}

        {phase.kind === "passphrase" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (passphrase !== "") void preview(passphrase);
            }}
          >
            <p className="tw-body text-muted-foreground">{t.encrypted}</p>
            <div className="flex max-w-[420px] items-center gap-2">
              <SecretInput
                autoFocus
                aria-label={t.passphrase}
                placeholder={t.passphrase}
                value={passphrase}
                aria-invalid={phase.error ? true : undefined}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={passphrase === ""}>
                {t.continue}
              </Button>
            </div>
            {phase.error && <p className="tw-label text-destructive">{phase.error}</p>}
          </form>
        )}

        {ready && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="tw-body text-muted-foreground tw-num">
                {[
                  t.countNew(n.new),
                  t.countConflict(n.conflict),
                  t.countSame(n.same),
                  ...(n.error > 0 ? [t.countError(n.error)] : []),
                ].join(" · ")}
              </span>
              {n.conflict > 0 && (
                <div className="ml-auto flex items-center gap-2">
                  {(["overwrite", "rename", "skip"] as const).map((a) => (
                    <Button
                      key={a}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setChoices((cs) => bulk(rows, cs, a))}
                    >
                      {a === "overwrite" ? t.overwriteAll : a === "rename" ? t.renameAll : t.skipAll}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            <Banner
              show={stale}
              layout="inline"
              tone="warning"
              title={t.stale}
              actions={
                <Button size="sm" variant="outline" onClick={() => void preview(used.current)}>
                  {t.previewAgain}
                </Button>
              }
            />
            <div className="-mx-4 min-h-0 flex-1 overflow-y-auto border-y border-border px-4">
              {ready.repairs.length > 0 && (
                <Banner layout="inline" tone="info" title={t.repaired(ready.repairs.length)} className="mt-3">
                  <FixList fixes={ready.repairs} />
                </Banner>
              )}
              <RowsTable
                rows={rows}
                choices={choices}
                problems={problems}
                stuck={stuck}
                disabled={busy}
                onChange={(key, next) => setChoices((cs) => ({ ...cs, [key]: { ...cs[key]!, ...next } }))}
              />
              {n.same > 0 && listed(rows).length > 0 && (
                <p className="py-2 tw-label text-muted-foreground">{t.sameHidden(n.same)}</p>
              )}
            </div>
          </>
        )}

        <DialogError error={error} />

        <DialogFooter className="items-center">
          {footNote && <span className="mr-auto tw-label text-muted-foreground">{footNote}</span>}
          <Button variant="outline" onClick={onClose}>
            {ready || phase.kind === "passphrase" ? c.cancel : c.close}
          </Button>
          {ready && (
            <Button
              pending={busy}
              disabled={open > 0 || bad || count === 0 || stale}
              onClick={() => void run(ready)}
            >
              {t.doImport}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 对话框顶上那一句：哪个文件、完整还是部分、含不含密钥、什么时候由哪一版 core 导出 */
function PackLine({ name, p }: { name: string; p: ImportPreview }) {
  const t = useText(backupText);
  const m = p.manifest;
  return (
    <>
      <span className="font-mono">{name}</span>
      {" · "}
      {m.kind === "full" ? t.packFull : t.packPartial}
      {" · "}
      {m.secrets ? t.withSecrets : t.withoutSecrets}
      {m.encrypted && <> · {t.packEncrypted}</>}
      {" · "}
      {t.exportedBy(whenMinute(m.created_at_ms), m.core_version)}
    </>
  );
}

/** 逐项的表：按类分组，一行一项。相同的不列 */
function RowsTable({
  rows,
  choices,
  problems,
  stuck,
  disabled,
  onChange,
}: {
  rows: readonly ImportRow[];
  choices: Choices;
  problems: Record<string, "empty" | "taken">;
  /** 因为引用了不导入的项目而导不进来的行 → 缺的那一项 */
  stuck: Record<string, ItemRef>;
  disabled: boolean;
  onChange: (key: string, next: Partial<Choices[string]>) => void;
}) {
  const t = useText(backupText);
  const groups = groupBy(listed(rows), (r) => r.item);
  if (groups.length === 0) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[32%]">{t.name}</TableHead>
          <TableHead>{t.status}</TableHead>
          <TableHead className="w-[1%] whitespace-nowrap">{t.action}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((g) => (
          <Fragment key={g.kind}>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={3} className="bg-muted/40 py-1.5 tw-label font-medium text-muted-foreground">
                {kindLabel(g.kind)}
              </TableCell>
            </TableRow>
            {g.items.map((r) => {
              const key = refKey(r.item);
              return (
                <TableRow key={key} className="hover:bg-transparent">
                  <TableCell className={cn("max-w-0 truncate align-top", namedById(r.item) && "font-mono")}>
                    {itemLabel(r.item)}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <StatusCell r={r} missing={stuck[key]} notes={rowNotes(r, choices[key])} />
                  </TableCell>
                  <TableCell className="align-top">
                    <ActionCell
                      r={r}
                      stuck={stuck[key] !== undefined}
                      choice={choices[key]}
                      problem={problems[key]}
                      disabled={disabled}
                      onChange={(next) => onChange(key, next)}
                    />
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

/** 状态那一格：新增 / 冲突 / 错误，加上导入后停用的几种标记；后面一句是哪里不同、为什么不行 */
function StatusCell({ r, missing, notes = [] }: { r: ImportRow; missing?: ItemRef; notes?: RowNote[] }) {
  const t = useText(backupText);
  if (missing) {
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="destructive">{t.statusError}</Badge>
        <span className="tw-label text-muted-foreground">{t.refSkipped(kindLabel(missing.kind), itemLabel(missing))}</span>
      </span>
    );
  }
  const hint =
    r.status === "error"
      ? r.error
        ? coreText(r.error)
        : null
      : r.status === "conflict"
        ? differsLabel(r.differs)
        : (r.flags.map((f) => t.flagHints[f])[0] ?? null);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {r.status === "new" && r.flags.length === 0 && <Badge variant="secondary">{t.statusNew}</Badge>}
      {r.status === "conflict" && <Badge variant="warning">{t.statusConflict}</Badge>}
      {r.status === "error" && <Badge variant="destructive">{t.statusError}</Badge>}
      {r.status !== "error" &&
        r.flags.map((f) => (
          <Badge key={f} variant="warning">
            {t.flags[f]}
          </Badge>
        ))}
      {hint && <span className="tw-label text-muted-foreground">{hint}</span>}
      {notes.map((n) => (
        <span key={n} className="basis-full tw-label text-warning-foreground">
          {t.rowNotes[n]}
        </span>
      ))}
    </span>
  );
}

/** 处理那一格：新增的一个勾选框，冲突的三选一（改名导入带一个名字），错误的写「不可导入」 */
function ActionCell({
  r,
  stuck,
  choice,
  problem,
  disabled,
  onChange,
}: {
  r: ImportRow;
  stuck: boolean;
  choice: Choices[string] | undefined;
  problem: "empty" | "taken" | undefined;
  disabled: boolean;
  onChange: (next: Partial<Choices[string]>) => void;
}) {
  const t = useText(backupText);
  if (r.status === "error" || stuck) {
    return <span className="tw-body whitespace-nowrap text-muted-foreground">{t.cannotImport}</span>;
  }
  if (r.status === "new") {
    return (
      <label className="flex items-center gap-2 tw-body whitespace-nowrap">
        <Checkbox
          checked={choice?.action === "import"}
          disabled={disabled}
          onCheckedChange={(v) => onChange({ action: v === true ? "import" : "skip" })}
        />
        {t.doImport}
      </label>
    );
  }
  const label: Record<ImportAction, string> = {
    import: t.doImport,
    overwrite: t.overwrite,
    rename: t.rename,
    skip: t.skip,
  };
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Segmented<ImportAction>
        // 没选的冲突：一段都不亮
        value={(choice?.action ?? "") as ImportAction}
        label={itemLabel(r.item)}
        disabled={disabled}
        options={actionsFor(r).map((a) => ({ id: a, label: label[a] }))}
        onChange={(a) => onChange({ action: a })}
      />
      {choice?.action === "rename" && (
        <>
          <Input
            variant="sm"
            className="w-full min-w-44 font-mono"
            aria-label={t.newName(r.item.name)}
            aria-invalid={problem ? true : undefined}
            value={choice.name}
            disabled={disabled}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          {problem && (
            <span className="tw-label text-destructive">{problem === "empty" ? t.nameEmpty : t.nameTaken}</span>
          )}
        </>
      )}
    </div>
  );
}
