import { Fragment } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type { ImportRow, ItemKind, SyncJoinAuto } from "@/types";
import {
  autoOf,
  choicesOf,
  countRows,
  pickAll,
  refKey,
  renameProblem,
  type MergeChoice,
  type MergePicks,
} from "./decide";
import { itemLabel, unitLabel } from "./labels";
import { syncLabelsText } from "./labels.i18n";
import { mergeRowsText } from "./MergeRows.i18n";

/** 分组的先后：和导入对话框、导出的清单同一个顺序（方案 5.2） */
const KIND_ORDER: readonly ItemKind[] = [
  "provider",
  "proxy",
  "key",
  "alias",
  "group",
  "route",
  "route_order",
  "price_sheet",
  "security_rule",
  "plugin",
  "global",
  "client_prefs",
];

/**
 * 加入同步时的合并预览：和导入同一套规则（方案 5.3、5.4）。**相同的不列**，只在统计里
 * 计数；新增的照导入，冲突的逐项选覆盖、改名导入或跳过（全局设置只有覆盖、跳过），没有
 * 缺省值；错误的不可导入，写出原因。
 */
export function MergeRows({
  rows,
  auto = [],
  picks,
  onPicks,
  disabled,
}: {
  rows: readonly ImportRow[];
  /** core 替人定了的几项（默认网关密钥采用同步数据）：照常列出，不给选择 */
  auto?: readonly SyncJoinAuto[];
  picks: MergePicks;
  onPicks: (next: MergePicks) => void;
  disabled?: boolean;
}) {
  const t = useText(mergeRowsText);
  const lt = useText(syncLabelsText);
  const c = countRows(rows, auto);
  const shown = rows.filter((r) => r.status !== "same");
  const groups = KIND_ORDER.map((k) => ({ kind: k, rows: shown.filter((r) => r.item.kind === k) })).filter(
    (g) => g.rows.length > 0,
  );

  const pick = (r: ImportRow, patch: Partial<{ choice: MergeChoice; name: string }>) => {
    const k = refKey(r.item);
    const cur = picks[k] ?? { choice: null, name: r.suggested_name ?? r.item.name };
    onPicks({ ...picks, [k]: { ...cur, ...patch } });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center gap-2">
        <span className="tw-body text-muted-foreground tw-num">{t.counts(c.new, c.conflict, c.same, c.error)}</span>
        {c.conflict > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {(["overwrite", "rename", "skip"] as const).map((x) => (
              <Button
                key={x}
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onPicks(pickAll(rows, picks, x, auto))}
              >
                {t.all[x]}
              </Button>
            ))}
          </div>
        )}
      </div>
      {shown.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[38%]">{t.name}</TableHead>
                <TableHead>{t.status}</TableHead>
                <TableHead className="text-right">{t.action}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.kind}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={3} className="bg-muted/40 py-1 tw-label font-medium text-muted-foreground">
                      {lt.kind[g.kind]}
                    </TableCell>
                  </TableRow>
                  {g.rows.map((r) => {
                    const p = picks[refKey(r.item)];
                    const problem = renameProblem(rows, picks, r);
                    const decided = autoOf(auto, r);
                    return (
                      <TableRow key={refKey(r.item)} className="hover:bg-transparent">
                        <TableCell className="max-w-0 align-top">
                          <span className="block truncate" title={itemLabel(r.item)}>
                            {r.item.kind === "global" ? itemLabel(r.item) : r.item.name}
                          </span>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          {decided ? <Decided /> : <Status row={r} />}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col items-end gap-1">
                            {decided ? (
                              <span className="pt-1 tw-body whitespace-nowrap text-muted-foreground">
                                {t.takeRemote}
                              </span>
                            ) : r.status === "conflict" ? (
                              <>
                                <Segmented<MergeChoice>
                                  label={t.action}
                                  value={p?.choice ?? ("" as MergeChoice)}
                                  disabled={disabled}
                                  options={choicesOf(r).map((x) => ({ id: x, label: t.choice[x] }))}
                                  onChange={(choice) => pick(r, { choice })}
                                />
                                {p?.choice === "rename" && (
                                  <>
                                    <Input
                                      variant="sm"
                                      className="w-48 motion-fade"
                                      aria-label={t.newName(r.item.name)}
                                      aria-invalid={problem !== null || undefined}
                                      value={p.name}
                                      disabled={disabled}
                                      spellCheck={false}
                                      autoComplete="off"
                                      onChange={(e) => pick(r, { name: e.target.value })}
                                    />
                                    {/* 改名导入是另一个项目：不沿用本机的密钥、登录（core 的 rename_flags） */}
                                    {r.rename_flags.length > 0 && (
                                      <span className="tw-label text-warning-foreground">
                                        {t.renameFlags(r.rename_flags.map((f) => t.flag[f]).join(lt.unitSep))}
                                      </span>
                                    )}
                                    {problem && (
                                      <span className="tw-label text-destructive">
                                        {problem === "empty"
                                          ? t.renameEmpty
                                          : problem === "same"
                                            ? t.renameSame
                                            : t.renameTaken}
                                      </span>
                                    )}
                                  </>
                                )}
                              </>
                            ) : (
                              <span className="pt-1 tw-body text-muted-foreground">
                                {r.status === "error" ? t.cannot : t.importIt}
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * core 替人定了的那一行（现在只有默认网关密钥）：采用同步数据，接管着的客户端随后自动换上新值
 */
function Decided() {
  const t = useText(mergeRowsText);
  return (
    <div className="flex min-w-0 flex-col gap-1 pt-0.5">
      <StatusLabel tone="ok" muted>
        {t.defaultKey}
      </StatusLabel>
      <span className="tw-label text-muted-foreground">{t.clientsFollow}</span>
    </div>
  );
}

/** 状态一格：状态，下面一行是不同的部分、错误的原因、导入之后要留意的 */
function Status({ row }: { row: ImportRow }) {
  const t = useText(mergeRowsText);
  const lt = useText(syncLabelsText);
  const tone = row.status === "conflict" ? "warn" : row.status === "error" ? "error" : "ok";
  const units = row.differs.filter((u) => u !== "all").map(unitLabel);
  return (
    <div className="flex min-w-0 flex-col gap-1 pt-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusLabel tone={tone} muted={row.status === "new"}>
          {t.statusOf[row.status]}
        </StatusLabel>
        {row.flags.map((f) => (
          <Badge key={f} variant="outline">
            {t.flag[f]}
          </Badge>
        ))}
      </div>
      {row.status === "conflict" && units.length > 0 && (
        <span className="tw-label text-muted-foreground">{t.differs(units.join(lt.unitSep))}</span>
      )}
      {row.error && <span className="tw-label break-words text-destructive">{coreText(row.error)}</span>}
    </div>
  );
}
