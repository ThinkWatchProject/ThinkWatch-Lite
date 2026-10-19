import { useText } from "@/i18n";
import { BackupPart } from "@/backup/BackupPart";
import { SyncPart } from "@/sync/SyncPart";
import type { ProviderView } from "@/types";
import { SettingsGroup } from "./kit";
import { syncBackupText } from "./SyncBackupSection.i18n";

/** 这一节在目录和深链里的 id（`nav.open("settings", { section: "sync-backup" })`） */
export const SYNC_BACKUP = "sync-backup";

/**
 * 设置「同步与备份」（规格 6.13）：上面是同步（多台设备共用一份配置），下面是备份（版本列表、
 * 导入导出）。本机模式下是独立的一节；连着远程 core 时归进「服务器」那一组，说的是服务器的
 * 同步与备份。
 *
 * 外壳只管排这两部分：同步那一部分由同步那一路做（`src/sync/SyncPart.tsx`），备份这一部分在
 * `src/backup/BackupPart.tsx`。
 */
export function SyncBackupSection({
  providers,
  onChanged,
}: {
  providers: readonly ProviderView[];
  onChanged: () => void;
}) {
  const t = useText(syncBackupText);
  return (
    <SettingsGroup id={SYNC_BACKUP} title={t.title}>
      <div className="flex flex-col gap-6">
        <SyncPart />
        <BackupPart providers={providers} onChanged={onChanged} />
      </div>
    </SettingsGroup>
  );
}
