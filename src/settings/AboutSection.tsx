import { useState } from "react";
import { CheckIcon } from "lucide-react";
import appIcon from "../../src-tauri/icons/128x128.png";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Reveal } from "@/ui/motion";
import { usePending } from "@/ui/notify";
import { Skeleton } from "@/ui/skeleton";
import { StatusLabel } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tip } from "@/ui/tip";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { remoteText } from "@/connection/remote.i18n";
import type { RemoteCore } from "@/connection/api";
import type { Found, UpdateView } from "@/updateFlow";
import { APP_KEYS, settingsApi } from "./api";
import { FLASH, Loaded, RowError, SettingsCard, SettingsGroup, SettingsRow, anchorId, useAppEvent, useWrite } from "./kit";
import { settingsText } from "./SettingsPage.i18n";

/** 「检查更新」按下去之后的结果。`idle`：这次打开设置页之后还没查过 */
type Check = { kind: "idle" } | { kind: "checking" } | { kind: "latest" } | { kind: "failed"; error: unknown };

/**
 * 关于：应用图标、版本和更新状态，下面是排查时最先要问的几样（数据在哪、core 从
 * 哪儿加载的）和诊断包。
 *
 * **这里不装任何东西。**查到新版本时打开的是更新窗口 —— 自动检查查到的和这里手动
 * 查到的走同一个窗口、同一套按钮；两处各有一套安装界面的话，迟早说不一样的话。
 * 已经查到了一版时按钮直接把那扇窗口拉起来，不再联网问一遍。
 *
 * 连着远程 core 时写连的是哪一台、它的 core 是哪一版；本机 core 的二进制那时不在
 * 用，不列。诊断包也不给（它描述的是 core 那一侧）。
 */
export function AboutSection({ remote, linked }: { remote: RemoteCore | null; linked: boolean }) {
  const t = useText(settingsText);
  const rt = useText(remoteText);
  const info = useResource(APP_KEYS.info, settingsApi.info);
  const update = useResource(APP_KEYS.update, settingsApi.update);
  const [autoPending, setAuto] = useWrite(update, (next: UpdateView) => settingsApi.setUpdateCheck(next.check_updates));
  const [check, setCheck] = useState<Check>({ kind: "idle" });
  const [opening, open] = usePending();
  const { mutate, reload } = update;

  // 后台那轮自动检查查到了：这里也跟着显示
  useAppEvent<Found>("update-found", (found) => {
    if (update.data) mutate({ ...update.data, offer: found });
    else void reload();
  });

  async function look() {
    setCheck({ kind: "checking" });
    try {
      const found = await settingsApi.checkUpdate();
      if (update.data) mutate({ ...update.data, offer: found });
      setCheck(found ? { kind: "idle" } : { kind: "latest" });
    } catch (e) {
      setCheck({ kind: "failed", error: e });
    }
  }

  const version = info.data?.version ?? update.data?.version;
  /** 版本从两处都读不出来：那一行说出来、给重试，不让骨架一直在那儿 */
  const failed = version === undefined && info.error !== undefined && update.error !== undefined;
  const offer = update.data?.offer ?? null;
  const install = update.data?.install;
  const checking = check.kind === "checking";

  /** 版本号下面那一行：只在查过、或者知道有新版本时出现 */
  const state = checking ? (
    <StatusLabel tone="pending">{t.checking}</StatusLabel>
  ) : check.kind === "failed" ? (
    <Tip text={errorText(check.error)}>
      <span className="inline-flex">
        <StatusLabel tone="error">{t.checkFailed}</StatusLabel>
      </span>
    </Tip>
  ) : offer ? (
    <StatusLabel tone="warn">{t.newer(offer.version)}</StatusLabel>
  ) : check.kind === "latest" ? (
    <StatusLabel tone="ok" muted>
      {t.latest}
    </StatusLabel>
  ) : null;

  /** 路径这一类：读到了照抄，读不出来写「—」（为什么读不出来，版本那一行已经说了） */
  const path = (v: string | undefined) => (v === undefined && info.error !== undefined ? "—" : v);

  return (
    <SettingsGroup id="about" title={t.about}>
      <SettingsCard>
        <div
          id={anchorId("updates")}
          data-section="updates"
          className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4", FLASH)}
        >
          {/* 应用图标本身（和程序坞里同一张），不是一个画出来的替身 */}
          <img src={appIcon} alt="" width={56} height={56} draggable={false} className="size-14 shrink-0 select-none" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="flex items-center gap-2 tw-head font-semibold text-foreground">
              {t.appName}
              {install === "homebrew" && <Badge variant="secondary">{t.homebrew}</Badge>}
              {install === "dev" && <Badge variant="outline">{t.devBuild}</Badge>}
            </p>
            {version ? (
              <p className="tw-num tw-body text-muted-foreground select-text">{t.versionIs(version)}</p>
            ) : failed ? (
              <div className="pt-1">
                <RowError
                  error={info.error}
                  onRetry={() => {
                    void info.reload();
                    void update.reload();
                  }}
                />
              </div>
            ) : (
              <Skeleton className="mt-1.5 h-3 w-28 rounded-sm" />
            )}
            <Reveal show={state !== null}>
              <div className="pt-1">{state}</div>
            </Reveal>
          </div>
          {offer ? (
            <Button
              type="button"
              size="sm"
              pending={opening}
              onClick={() =>
                void open(async () => {
                  await settingsApi.showUpdate();
                })
              }
            >
              {t.updateTo(offer.version)}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              pending={checking}
              disabled={!update.data}
              onClick={() => void look()}
            >
              {t.checkNow}
            </Button>
          )}
        </div>

        <SettingsRow
          label={t.autoCheck}
          htmlFor="settings-check-updates"
          control={
            <Loaded r={update} width="h-[18px] w-8 rounded-full">
              {(v) => (
                <Switch
                  id="settings-check-updates"
                  checked={v.check_updates}
                  pending={autoPending}
                  onCheckedChange={(c) => void setAuto({ ...v, check_updates: c === true })}
                />
              )}
            </Loaded>
          }
        />

        {remote && (
          <>
            <SettingsRow label={rt.connection} description={<Mono>{`${remote.name} · ${remote.addr}`}</Mono>} />
            <SettingsRow label={rt.serverCore} description={<Mono>{remote.core ?? "—"}</Mono>} />
          </>
        )}
        <SettingsRow label={t.dataDir} description={<Mono>{path(info.data?.data_dir)}</Mono>} />
        {!remote && <SettingsRow label={t.coreBin} description={<Mono>{path(info.data?.core_bin)}</Mono>} />}
        {!remote && <Diagnostics linked={linked} />}
      </SettingsCard>
    </SettingsGroup>
  );
}

/** 路径、版本这类要照抄的值：等宽、可选中、太长就折行。还没读到时一块灰 */
function Mono({ children }: { children: string | undefined }) {
  if (children === undefined) return <Skeleton className="mt-1 h-2.5 w-64 max-w-full rounded-sm" />;
  return <code className="block font-mono tw-label break-all text-muted-foreground select-text">{children}</code>;
}

/**
 * 诊断包。遇到问题时一次性交出「这里是什么情况」，省掉来回问一轮（版本？配置？
 * 哪个上游？）。**里面全部脱敏过，但仍然要求用户自己看一眼再交出去**：这是个
 * 看得见所有 API key 的网关，这一步值得多花十秒。
 *
 * 内容由 core 给出：没连上 core 时按钮灰着，说明换成一句「连接后可生成」。
 */
function Diagnostics({ linked }: { linked: boolean }) {
  const t = useText(settingsText);
  const [busy, run] = usePending();
  const [path, setPath] = useState<string | null>(null);
  return (
    <SettingsRow
      anchor="diagnostics"
      label={t.diagnostics}
      description={
        linked
          ? t.diagnosticsBody((label) => (
              <Tip text={t.diagnosticsTip}>
                <span className="underline decoration-dotted underline-offset-2">{label}</span>
              </Tip>
            ))
          : t.diagnosticsOffline
      }
      control={
        <Button
          type="button"
          size="sm"
          variant="outline"
          pending={busy}
          disabled={!linked}
          // 生成的路径就画在这一行下面，不另弹提示
          onClick={() => void run(async () => setPath(await settingsApi.saveDiagnostics()))}
        >
          {t.generate}
        </Button>
      }
    >
      <Reveal show={path !== null}>
        <div className="pt-3">
          <div className="rounded-md border border-border bg-background px-3 py-2.5">
            <p className="flex items-center gap-1.5 tw-body text-foreground">
              <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden />
              {t.generated}
            </p>
            <code className="mt-1 block font-mono tw-label break-all text-muted-foreground select-text">{path}</code>
            <p className="mt-1.5 tw-label text-muted-foreground">
              {t.review((text) => (
                <span className="font-medium text-foreground">{text}</span>
              ))}
            </p>
          </div>
        </div>
      </Reveal>
    </SettingsRow>
  );
}
