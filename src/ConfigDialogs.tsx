import { call } from "@/control";
import { useResource } from "@/lib/resource";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Loadable, LoadingState } from "@/ui/states";
import { useText } from "@/i18n";
import ConfigTextMode from "./ConfigText";
import type { ConfigFocus } from "./configLocate";
import { configDialogsText } from "./ConfigDialogs.i18n";

/**
 * 配置文件。**各配置页共用这一个入口** —— 文件只有一份，表单是它的几种
 * 视图，而不是几个互不相干的东西。
 *
 * 旁边原来的「版本历史」由备份取代（`src/backup/BackupsDialog.tsx`）：每次保存都是备份里的
 * 一个版本，连同插件一起。
 */
export function ConfigFileDialog({
  reloads,
  focus,
  rejectedLine,
  onClose,
  onJump,
}: {
  /** 配置换入过几次。换了就重读 */
  reloads: number;
  /** 打开时选中这一项（哪一段、叫什么） */
  focus: ConfigFocus | null;
  rejectedLine: number | null;
  onClose: () => void;
  /** 光标所在那一段由哪个页面管理，跳过去 */
  onJump: (section: string | null, name: string) => void;
}) {
  const t = useText(configDialogsText);
  // 配置换入一次就重读。**重读时编辑器照常画着**：没改过的草稿跟着新版本走，改过的
  // 不动（见 ConfigText）
  const doc = useResource("config-file", () => call("GetConfig", null), { deps: [reloads] });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[86vh] flex-col gap-3 sm:max-w-[1040px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.fileTitle}</DialogTitle>
          <DialogDescription>
            {t.fileDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <Loadable r={doc} loading={<LoadingState label={t.readingFile} className="h-full" />} errorTitle={t.fileFailed}>
            {(d) => (
              <ConfigTextMode
                doc={d}
                focus={focus}
                rejectedLine={rejectedLine}
                onSaved={() => {
                  // 版本号换了，外面的配置事件会让上面那份数据重读
                }}
                onJumpToForm={({ name, section }) => onJump(section, name)}
              />
            )}
          </Loadable>
        </div>
      </DialogContent>
    </Dialog>
  );
}
