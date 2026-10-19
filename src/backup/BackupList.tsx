import { useState } from "react";
import { HistoryIcon } from "lucide-react";
import { useResource } from "@/lib/resource";
import { Badge } from "@/ui/badge";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState, Loadable, TableSkeleton } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { whenMinute } from "@/format";
import type { BackupEntry } from "@/types";
import { BACKUPS_KEY, backupApi } from "./api";
import { backupText } from "./backup.i18n";
import { originLabel } from "./items";
import { keepInRow, openRow } from "@/upstreams/parts";
import { RestoreDialog } from "./RestoreDialog";
import { SaveVersionDialog } from "./SaveVersionDialog";

/** 备份版本的列表，配置一换就重读（新的那一版排到最前） */
export function useBackups() {
  return useResource(BACKUPS_KEY, backupApi.list, { events: ["config_reloaded"] });
}

/**
 * 备份版本（规格 7.1、6.13）：按时间倒序，本机与同步位置的同一版本是一行，「存放位置」两处都标。
 * 当前的那一版在时间后面标「当前」。行尾按钮和右键是「恢复…」「另存为…」（当前的那一版只能另存）；点一行
 * 就是「恢复…」—— 先看差异，不会直接恢复。
 *
 * 设置「同步与备份」里一份，工具栏的「备份」、安全模式出错页的「从备份恢复…」打开的对话框里
 * 一份，是同一张表。
 */
export function BackupList({
  onRestored,
  onOpenPlugins,
}: {
  onRestored?: () => void;
  onOpenPlugins?: () => void;
}) {
  const t = useText(backupText);
  const list = useBackups();
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  const [saving, setSaving] = useState<BackupEntry | null>(null);

  return (
    <>
      <Loadable
        r={list}
        loading={<TableSkeleton rows={4} cols={5} />}
        errorTitle={t.listFailed}
        isEmpty={(v) => v.length === 0}
        empty={<EmptyState variant="outlined" icon={<HistoryIcon />} title={t.noBackups} description={t.noBackupsHint} />}
      >
        {(entries) => (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t.time}</TableHead>
                <TableHead>{t.origin}</TableHead>
                <TableHead>{t.location}</TableHead>
                <TableHead>{t.contents}</TableHead>
                <TableHead>{t.coreVersion}</TableHead>
                <TableHead className="w-9">
                  <span className="sr-only">{t.actionsColumn}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <BackupRow key={e.id} e={e} onRestore={() => setRestoring(e)} onSave={() => setSaving(e)} />
              ))}
            </TableBody>
          </Table>
        )}
      </Loadable>
      {restoring && (
        <RestoreDialog
          entry={restoring}
          onClose={() => setRestoring(null)}
          onRestored={() => {
            void list.reload();
            onRestored?.();
          }}
          onOpenPlugins={onOpenPlugins}
        />
      )}
      {saving && <SaveVersionDialog entry={saving} onClose={() => setSaving(null)} />}
    </>
  );
}

/** 一个版本一行。当前的那一版不能恢复（点了也不开预览），只能另存 */
function BackupRow({ e, onRestore, onSave }: { e: BackupEntry; onRestore: () => void; onSave: () => void }) {
  const t = useText(backupText);
  const items: MenuItems = [
    ...(e.current ? [] : [{ kind: "item" as const, label: t.restore, onSelect: onRestore }]),
    { kind: "item", label: t.saveAs, onSelect: onSave },
  ];
  return (
    <RowMenu items={items}>
      <TableRow {...(e.current ? {} : openRow(onRestore))}>
        <TableCell className="whitespace-nowrap">
          <span className="inline-flex items-center gap-2">
            <span className="tw-num">{whenMinute(e.at_ms)}</span>
            {e.current && <Badge variant="success">{t.current}</Badge>}
          </span>
        </TableCell>
        <TableCell className="max-w-48 truncate text-muted-foreground">{originLabel(e.origin, e.device)}</TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {[e.local && t.local, e.sync && t.synced].filter(Boolean).join(" · ")}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {t.counts(e.counts.providers, e.counts.plugins)}
        </TableCell>
        <TableCell className="font-mono tw-num text-muted-foreground">{e.core_version}</TableCell>
        <TableCell className="w-9 text-right" {...keepInRow}>
          <RowMenuButton items={items} label={t.actionsFor(whenMinute(e.at_ms))} />
        </TableCell>
      </TableRow>
    </RowMenu>
  );
}
