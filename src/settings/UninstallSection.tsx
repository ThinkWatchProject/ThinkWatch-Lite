import { useState } from "react";
import { NetworkIcon, PowerOffIcon, RotateCcwIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { StatusDot } from "@/ui/status-dot";
import type { UninstallStep } from "@/types";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { isWindows } from "@/platform";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { api as clientsApi } from "@/clients/api";
import { remoteText } from "@/connection/remote.i18n";
import type { RemoteCore } from "@/connection/api";
import { APP_KEYS, settingsApi } from "./api";
import { SettingsCard, SettingsGroup, SettingsRow } from "./kit";
import { settingsText } from "./SettingsPage.i18n";

/**
 * 最近一次卸载每一步的结果。**放在模块里**：切到别的页再回来，这一节还记得已经
 * 卸载过（这之后用户多半就去把应用移到废纸篓了）。
 */
let lastLog: UninstallStep[] | null = null;

/**
 * 完全卸载。
 *
 * **macOS 上删除应用没有卸载钩子**：拖进废纸篓就是拖进废纸篓，没有任何机会做
 * 清理 —— 而那时接管过的客户端全都指向一个已经没有东西在听的端口，所有 AI 客户端
 * 同时失效，用户很可能已经忘了是什么改的。所以这个入口必须在，而且要在他还没删
 * 应用的时候就看得见。
 *
 * 按下去先弹确认，**列出会发生的每一件事**（还原哪几个客户端、取消开机启动、要不
 * 要连数据一起删）；删数据默认不勾：请求历史和费用记录是用户自己的东西，删了才发现
 * 还想看是不可逆的。做完在同一个对话框里逐条说结果。
 */
export function UninstallSection({ remote }: { remote: RemoteCore | null }) {
  const t = useText(settingsText);
  const rt = useText(remoteText);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState(lastLog);
  const em = (text: string) => <span className="font-medium text-foreground">{text}</span>;
  return (
    <SettingsGroup id="uninstall" title={t.uninstall}>
      <SettingsCard>
        <SettingsRow
          label={t.uninstallTitle}
          description={
            <>
              {log ? (log.at(-1)?.text ?? t.uninstalledRow) : t.uninstallIntro(em)}
              {remote && !log && <span className="mt-1 block">{rt.uninstallServer(remote.name)}</span>}
            </>
          }
          control={
            <Button type="button" size="sm" variant="destructive" onClick={() => setOpen(true)}>
              {t.uninstallAction}
            </Button>
          }
        />
      </SettingsCard>
      {open && (
        <UninstallDialog
          onClose={() => setOpen(false)}
          onDone={(l) => {
            lastLog = l;
            setLog(l);
          }}
        />
      )}
    </SettingsGroup>
  );
}

type Stage =
  | { kind: "ask" }
  | { kind: "running" }
  | { kind: "done"; log: UninstallStep[] }
  | { kind: "failed"; error: unknown };

function UninstallDialog({ onClose, onDone }: { onClose: () => void; onDone: (log: UninstallStep[]) => void }) {
  const t = useText(settingsText);
  const common = useText(commonText);
  const [drop, setDrop] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "ask" });
  const info = useResource(APP_KEYS.info, settingsApi.info);
  /**
   * 会被还原的是哪几个。**读不到就不列名字**（只说「还原已接管的客户端」）：
   * 列表读不出来不该挡住卸载
   */
  const clients = useResource("settings:uninstall-clients", clientsApi.list);
  const adopted = clients.data?.clients.filter((c) => c.adopted_at_ms !== null).map((c) => c.name);
  /**
   * 客户端页上改成 mirrored 的 `.wslconfig`。**卸载不改回它**：那是 WSL 自己的设置，
   * 改回 NAT 会让别的东西跟着变 —— 这件事在按下去之前说
   */
  const wslconfig = useResource(isWindows ? "settings:uninstall-wslconfig" : null, clientsApi.wslconfigKept);
  const kept = wslconfig.data;
  const running = stage.kind === "running";
  const done = stage.kind === "done";
  /** 没做成的几步。**标题按它说**：有一步没做成还写「卸载完成」，用户就不会往下看是哪一步 */
  const failed = stage.kind === "done" ? stage.log.filter((s) => !s.ok).length : 0;

  async function run() {
    setStage({ kind: "running" });
    try {
      const log = await settingsApi.uninstall(drop);
      setStage({ kind: "done", log });
      onDone(log);
    } catch (e) {
      setStage({ kind: "failed", error: e });
    }
  }

  const names = adopted ? adopted.join(t.sep) : null;
  return (
    <AlertDialog open onOpenChange={(o) => !o && !running && onClose()}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-[440px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="tw-title">
            {!done ? t.uninstallTitle : failed > 0 ? t.uninstalledWithFailures(failed) : t.uninstalled}
          </AlertDialogTitle>
          {!done && <AlertDialogDescription>{t.willDo}</AlertDialogDescription>}
        </AlertDialogHeader>

        {stage.kind === "done" ? (
          <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/45 px-3.5 py-3 tw-body">
            {stage.log.map((step, i) => (
              <li key={i} className="flex gap-2.5 motion-fade">
                {step.ok ? (
                  <span aria-hidden className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground" />
                ) : (
                  <StatusDot tone="error" className="mt-[0.45em] shrink-0" label={t.stepFailed} />
                )}
                <span className={cn("min-w-0 break-words select-text", !step.ok && "text-destructive")}>{step.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-3 rounded-lg border border-border bg-surface/45 px-3.5 py-3 tw-body">
            <li className="flex gap-2.5">
              <RotateCcwIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p>{t.restoreClients}</p>
                {clients.data === undefined && clients.loading ? (
                  <Skeleton className="mt-1.5 h-2.5 w-40 rounded-sm" />
                ) : names !== null ? (
                  <p className="tw-label text-muted-foreground">{names || t.restoreNone}</p>
                ) : null}
              </div>
            </li>
            <li className="flex gap-2.5">
              <PowerOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p>{t.stopAutostart}</p>
            </li>
            {kept && (
              <li className="flex gap-2.5">
                <NetworkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0">
                  <p>{t.wslconfigKept}</p>
                  <p className="tw-label break-words text-muted-foreground">
                    {kept.backup == null
                      ? t.wslconfigCreated(kept.path)
                      : drop
                        ? t.wslconfigBackupDropped(kept.path)
                        : t.wslconfigBackup(kept.path, kept.backup)}
                  </p>
                </div>
              </li>
            )}
            <li className="flex gap-2.5">
              <Checkbox
                id="uninstall-drop-data"
                className="mt-0.5"
                checked={drop}
                disabled={running}
                onCheckedChange={(c) => setDrop(c === true)}
              />
              <label htmlFor="uninstall-drop-data" className="min-w-0">
                <span className={drop ? "text-destructive" : undefined}>{t.dropData}</span>
                {info.data ? (
                  <code className="block font-mono tw-label break-all text-muted-foreground">{info.data.data_dir}</code>
                ) : (
                  <Skeleton className="my-1 h-2.5 w-36 rounded-sm" />
                )}
                <span className="block tw-label text-muted-foreground">{t.dropDataWhat}</span>
              </label>
            </li>
          </ul>
        )}

        <Banner layout="inline" tone="error" show={stage.kind === "failed"} title={t.uninstallFailed}>
          {stage.kind === "failed" ? errorText(stage.error) : null}
        </Banner>

        <AlertDialogFooter>
          {done ? (
            <AlertDialogAction onClick={onClose}>{common.close}</AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel disabled={running}>{common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={running}
                aria-busy={running || undefined}
                onClick={(e) => {
                  // 做完之前不关：结果要在这个对话框里逐条说
                  e.preventDefault();
                  void run();
                }}
              >
                {running && <Spinner data-icon="inline-start" aria-hidden />}
                {t.confirmUninstall}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
