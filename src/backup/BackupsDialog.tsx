import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { useText } from "@/i18n";
import { backupText } from "./backup.i18n";
import { BackupList } from "./BackupList";

/**
 * 备份版本的对话框：工具栏的「备份」（取代原来的「版本历史」）、命令面板，和安全模式出错页的
 * 「从备份恢复…」都打开它（`restore`：标题写「从备份恢复」）。表和设置里的是同一张。
 *
 * **安全模式下也能用**：配置读不了的时候，core 的备份接口照常答，恢复之后配置换入、退出安全模式。
 */
export function BackupsDialog({
  restore = false,
  onClose,
  onOpenPlugins,
}: {
  restore?: boolean;
  onClose: () => void;
  /** 关掉这里、去插件页（恢复的版本要装上、启用改得了工具调用的插件时） */
  onOpenPlugins?: () => void;
}) {
  const t = useText(backupText);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{restore ? t.restoreTitle : t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <BackupList onOpenPlugins={onOpenPlugins} />
        </div>
        <p className="tw-label text-muted-foreground">{t.keeps}</p>
      </DialogContent>
    </Dialog>
  );
}
