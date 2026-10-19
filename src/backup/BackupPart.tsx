import { useState } from "react";
import { Button } from "@/ui/button";
import { useText } from "@/i18n";
import { SettingsCard } from "@/settings/kit";
import type { ProviderView } from "@/types";
import { backupText } from "./backup.i18n";
import { BackupList } from "./BackupList";
import { ExportDialog } from "./ExportDialog";
import { PartHeading } from "./parts";
import { useImport } from "./useImport";

/**
 * 设置「同步与备份」里的备份部分（规格 6.13）：「导入配置…」「导出配置…」，下面是备份版本的表，
 * 再下面一句保留规则。连着远程 core 时这些都是服务器上的（文件在这台设备上读写）。
 *
 * `providers`：配置里的上游，导出对话框数 ChatGPT 登录用。
 */
export function BackupPart({ providers, onChanged }: { providers: readonly ProviderView[]; onChanged: () => void }) {
  const t = useText(backupText);
  const [exporting, setExporting] = useState(false);
  const importer = useImport(onChanged);
  return (
    <div className="flex flex-col gap-2">
      <PartHeading
        title={t.heading}
        actions={
          <>
            <Button size="sm" variant="outline" pending={importer.picking} onClick={importer.start}>
              {t.importConfig}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExporting(true)}>
              {t.exportConfig}
            </Button>
          </>
        }
      />
      <SettingsCard className="px-2 py-1">
        <BackupList onRestored={onChanged} />
      </SettingsCard>
      <p className="tw-label text-muted-foreground">{t.keeps}</p>
      {exporting && <ExportDialog providers={providers} onClose={() => setExporting(false)} />}
      {importer.dialog}
    </div>
  );
}
