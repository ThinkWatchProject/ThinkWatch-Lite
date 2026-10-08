import { useState } from "react";
import { HistoryIcon } from "lucide-react";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { EmptyState, Loadable, LoadingState, TableSkeleton } from "@/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { useText } from "@/i18n";
import ConfigTextMode, { PluginConfirmNotice } from "./ConfigText";
import type { ConfigFocus } from "./configLocate";
import { configDialogsText } from "./ConfigDialogs.i18n";
import { when } from "./format";
import { originLabel } from "./labels";
import { errorText } from "@/i18n/core.i18n";
import { needsConfirmation } from "@/plugins/write";

/**
 * 配置文件。**各配置页共用这一个入口** —— 文件只有一份，表单是它的几种
 * 视图，而不是几个互不相干的东西。
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

/** 版本历史。**每一次保存都在这里** —— 恢复也是一次保存，不会丢掉当前版本 */
export function VersionHistoryDialog({
  reloads,
  onClose,
  onOpenPlugins,
}: {
  /** 配置换入过几次。换了就重读 */
  reloads: number;
  onClose: () => void;
  /** 关掉这里、去插件页（恢复的版本要装上、启用改得了工具调用的插件时） */
  onOpenPlugins?: () => void;
}) {
  const t = useText(configDialogsText);
  const versions = useResource("config-history", () => call("ConfigHistory", null), { deps: [reloads] });
  const [busy, setBusy] = useState<string | null>(null);
  /** core 不让这次恢复装上、启用、换掉批准的代码的那个插件（它的那句话） */
  const [pluginRefusal, setPluginRefusal] = useState<string | null>(null);

  async function restore(version: string) {
    setBusy(version);
    setPluginRefusal(null);
    try {
      await call("ConfigRollback", { version });
    } catch (e) {
      // 和保存配置文件一样：恢复这条路没有点过头的那一条，只能去插件页
      if (needsConfirmation(e)) setPluginRefusal(errorText(e));
      else notify.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.historyTitle}</DialogTitle>
          <DialogDescription>{t.historyDescription}</DialogDescription>
        </DialogHeader>
        {pluginRefusal && (
          <PluginConfirmNotice reason={pluginRefusal} result="notRestored" onOpenPlugins={onOpenPlugins} />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Loadable
            r={versions}
            loading={<TableSkeleton rows={5} cols={4} />}
            errorTitle={t.historyFailed}
            isEmpty={(v) => v.length === 0}
            empty={
              <EmptyState variant="outlined" icon={<HistoryIcon />} title={t.noVersions} description={t.noVersionsHint} />
            }
          >
            {(list) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.time}</TableHead>
                    <TableHead>{t.origin}</TableHead>
                    <TableHead>{t.version}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((v) => (
                    <TableRow key={v.version}>
                      <TableCell className="tabular-nums">{when(v.at_ms)}</TableCell>
                      <TableCell className="text-muted-foreground">{originLabel(v.origin)}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{v.version.slice(7, 19)}</TableCell>
                      <TableCell className="text-right">
                        {v.current ? (
                          <Badge variant="success">{t.current}</Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy != null}
                            pending={busy === v.version}
                            onClick={() => restore(v.version)}
                          >
                            {t.restore}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Loadable>
        </div>
      </DialogContent>
    </Dialog>
  );
}
