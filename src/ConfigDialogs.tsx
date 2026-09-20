import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { useText } from "@/i18n";
import ConfigTextMode from "./ConfigText";
import { configDialogsText } from "./ConfigDialogs.i18n";
import { when } from "./format";
import type { ConfigText, ConfigVersion } from "./types";
import { originLabel } from "./labels";
import { errorText } from "@/i18n/core.i18n";

/**
 * 配置文件。**各配置页共用这一个入口** —— 文件只有一份，表单是它的几种
 * 视图，而不是几个互不相干的东西。
 */
export function ConfigFileDialog({
  configVersion,
  focus,
  rejectedLine,
  onClose,
  onJump,
}: {
  configVersion: string | null;
  /** 打开时选中这个名字所在的那一段 */
  focus: string | null;
  rejectedLine: number | null;
  onClose: () => void;
  /** 光标所在那一段由哪个页面管理，跳过去 */
  onJump: (section: string | null, name: string) => void;
}) {
  const t = useText(configDialogsText);
  const [doc, setDoc] = useState<ConfigText | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<ConfigText>("get_config")
      .then((d) => alive && setDoc(d))
      .catch((e) => toast.error(errorText(e)));
    return () => {
      alive = false;
    };
  }, [configVersion]);

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
          {doc ? (
            <ConfigTextMode
              doc={doc}
              focus={focus}
              rejectedLine={rejectedLine}
              onSaved={() => {
                // 版本号换了，外面的配置事件会让上面那个 effect 重新读
              }}
              onJumpToForm={({ name, section }) => onJump(section, name)}
            />
          ) : (
            <p className="flex items-center gap-2 tw-body text-muted-foreground">
              <Spinner />
              {t.readingFile}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 版本历史。**每一次保存都在这里** —— 恢复也是一次保存，不会丢掉当前版本 */
export function VersionHistoryDialog({
  configVersion,
  onClose,
}: {
  configVersion: string | null;
  onClose: () => void;
}) {
  const t = useText(configDialogsText);
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<ConfigVersion[]>("config_history")
      .then((v) => alive && setVersions(v))
      .catch((e) => toast.error(errorText(e)));
    return () => {
      alive = false;
    };
  }, [configVersion]);

  async function restore(version: string) {
    setBusy(version);
    try {
      await invoke("rollback_config", { version });
    } catch (e) {
      toast.error(errorText(e));
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          {versions == null ? (
            <p className="flex items-center gap-2 tw-body text-muted-foreground">
              <Spinner />
              {t.readingHistory}
            </p>
          ) : versions.length === 0 ? (
            <p className="tw-body text-muted-foreground">{t.noVersions}</p>
          ) : (
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
                {versions.map((v) => (
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
                          onClick={() => restore(v.version)}
                        >
                          {busy === v.version && <Spinner />}
                          {t.restore}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
