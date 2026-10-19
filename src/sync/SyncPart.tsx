import { useState } from "react";
import { call } from "@/control";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/resource";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { notify } from "@/ui/notify";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { PartHeading } from "@/backup/parts";
import { coreText, errorText } from "@/i18n/core.i18n";
import { useNavParams } from "@/nav";
import { useNow } from "@/useNow";
import { useRemote } from "@/connection/useRemote";
import { useFormDraft } from "@/settings/form";
import { ErrorRow, RowSkeleton, SaveBar, SettingsCard, SettingsRow, useDirtyMark, useSavedFlash } from "@/settings/kit";
import type { SyncEncryptionAction, SyncView } from "@/types";
import { syncApi } from "./api";
import { ConflictDialog } from "./ConflictDialog";
import { EncryptionDialog, ExcludeDialog, StopDialog, UnlockDialog } from "./Dialogs";
import { TargetFields, type RowOf } from "./Fields";
import { syncFieldsText } from "./fields.i18n";
import { JoinWizard } from "./JoinWizard";
import { ago, itemLabel } from "./labels";
import { SyncNotices, sentence } from "./Notices";
import { syncPartText } from "./SyncPart.i18n";
import { draftOf, sameTarget, targetOf, targetProblem, type TargetDraft } from "./target";
import { syncOn, useSyncView } from "./useSync";

/** 目录上挂「有没存的」点的那一节。和「同步与备份」的外壳（`SyncBackupSection`）同一个 id */
const SECTION = "sync-backup";

/**
 * 设置 › 同步与备份 › 同步（方案 6.13）。外壳（`settings/SyncBackupSection.tsx`）把它和备份
 * 那一半放在同一节里；本机模式下独立一节，远程模式下归入「服务器」组，改的是远程 core 的同步。
 *
 * - **没开同步**：一句说明和「开启同步…」（向导，`JoinWizard`）。上游页空状态的「加入同步…」
 *   经 `open("settings", { section: "sync-backup", action: "join-sync" })` 直接打开它。
 * - **开着**：状态、同步位置与连接参数、加密、不同步的上游、本设备名称；改了点「保存」才写进
 *   配置（`config.yaml` 的 `sync` 节）。加密的开关和口令走对话框（要口令，core 当场重新上传）。
 *   下面是设备列表。要人处理的状态在最上面一条黄色提示，可以忽略。
 */
export function SyncPart() {
  const t = useText(syncPartText);
  const r = useSyncView();
  const ov = useResource("overview", () => call("Overview", null), { events: ["config_reloaded"] });
  const [wizard, setWizard] = useState(false);
  const v = r.data;

  // 上游页空状态的「加入同步…」：开着同步时只是滚到这一节（外壳那边已经滚了）
  useNavParams("settings", (p) => {
    if (p.action === "join-sync") setWizard(true);
  });

  const proxies = ov.data?.proxies.map((p) => p.name) ?? [];
  const upstreams = ov.data?.providers.map((p) => p.name) ?? [];
  const on = syncOn(v);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {v === undefined ? (
        <>
          <PartHeading title={t.title} />
          <SettingsCard>
            {r.error !== undefined && !r.loading ? (
              <ErrorRow title={t.loadFailed} error={r.error} onRetry={() => void r.reload()} />
            ) : (
              <>
                <RowSkeleton control="w-28" />
                <RowSkeleton control="w-52" />
              </>
            )}
          </SettingsCard>
        </>
      ) : on ? (
        <On view={v} proxies={proxies} upstreams={upstreams} onView={(next) => r.mutate(next)} reload={() => void r.reload()} />
      ) : (
        <>
          <PartHeading title={t.title} />
          <SettingsCard>
            <SettingsRow
              label={t.offDesc}
              control={
                <Button type="button" size="sm" variant="outline" onClick={() => setWizard(true)}>
                  {t.turnOn}
                </Button>
              }
            />
          </SettingsCard>
        </>
      )}
      {wizard && !on && (
        <JoinWizard proxies={proxies} onClose={() => setWizard(false)} onDone={() => void r.reload()} />
      )}
    </div>
  );
}


interface Draft {
  target: TargetDraft;
  device: string;
  excluded: string[];
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

const same = (a: Draft, b: Draft) =>
  sameTarget(a.target, b.target) && a.device === b.device && sameList(a.excluded, b.excluded);

function On({
  view,
  proxies,
  upstreams,
  onView,
  reload,
}: {
  view: SyncView;
  proxies: string[];
  upstreams: string[];
  onView: (v: SyncView) => void;
  reload: () => void;
}) {
  const t = useText(syncPartText);
  const ft = useText(syncFieldsText);
  const remote = useRemote();
  const saved: Draft = {
    target: draftOf(view.target),
    device: view.device?.name ?? "",
    excluded: view.excluded,
  };
  const { draft, setDraft, dirty, commit, reset } = useFormDraft("sync", saved, same);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, flash] = useSavedFlash();
  const [syncing, setSyncing] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: "stop" }
    | { kind: "exclude" }
    | { kind: "conflicts" }
    | { kind: "unlock" }
    | { kind: "encryption"; action: SyncEncryptionAction }
    | null
  >(null);
  useDirtyMark(SECTION, dirty);

  const problem = targetProblem(draft.target);
  const deviceOk = draft.device.trim() !== "";
  const valid = problem === null && deviceOk;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await syncApi.save({
        target: sameTarget(draft.target, saved.target) ? null : targetOf(draft.target),
        device_name: draft.device === saved.device ? null : draft.device.trim(),
        excluded: sameList(draft.excluded, saved.excluded) ? null : draft.excluded,
      });
      commit({ ...draft, device: draft.device.trim() });
      flash();
      reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function now() {
    setSyncing(true);
    try {
      onView(await syncApi.now());
    } catch (e) {
      notify.error(e, t.nowFailed);
    } finally {
      setSyncing(false);
    }
  }

  const row: RowOf = ({ id, label, htmlFor, hint, control }) => (
    <SettingsRow key={id} label={label} htmlFor={htmlFor} description={hint} control={control} />
  );
  const cascade = sameList(draft.excluded, saved.excluded) ? view.excluded_cascade : [];

  return (
    <>
      <PartHeading
        title={t.title}
        actions={
          <>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "stop" })}>
              {t.stop}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              pending={syncing}
              disabled={view.state === "syncing" || view.state === "paused"}
              onClick={() => void now()}
            >
              {t.now}
            </Button>
          </>
        }
      />
      <SyncNotices view={view} withoutConflicts onChanged={onView} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !busy && valid) void save();
        }}
      >
        <SettingsCard>
          <SettingsRow
            label={t.status}
            description={<StateNotes view={view} />}
            control={
              <span className="inline-flex items-center gap-3">
                <State view={view} />
                {view.conflicts > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "conflicts" })}>
                    {t.resolve}
                  </Button>
                )}
                {/* 口令在别处改了：提示可以忽略，这里一直给得到入口 */}
                {view.state === "locked" && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ kind: "unlock" })}>
                    {t.unlock}
                  </Button>
                )}
              </span>
            }
          />
          <TargetFields
            dense
            draft={draft.target}
            proxies={proxies}
            remote={!!remote}
            disabled={busy}
            onChange={(patch) => {
              setError(null);
              setDraft((d) => ({ ...d, target: { ...d.target, ...patch } }));
            }}
            row={row}
          />
          <SettingsRow
            label={t.encryption}
            htmlFor="sync-encrypted"
            description={view.encrypted ? t.encrypted : t.plain}
            control={
              <span className="inline-flex items-center gap-3">
                {view.encrypted && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setDialog({ kind: "encryption", action: "change" })}
                  >
                    {t.changePassphrase}
                  </Button>
                )}
                <Switch
                  id="sync-encrypted"
                  checked={view.encrypted}
                  onCheckedChange={(c) => setDialog({ kind: "encryption", action: c === true ? "enable" : "disable" })}
                />
              </span>
            }
          />
          <SettingsRow
            label={t.excluded}
            description={
              <>
                <span className={cn(draft.excluded.length > 0 && "text-foreground")}>
                  {draft.excluded.length > 0 ? draft.excluded.join(t.excludedSep) : t.excludedNone}
                </span>
                {cascade.length > 0 && (
                  <span className="block">{t.cascade(cascade.map(itemLabel).join(t.excludedSep))}</span>
                )}
              </>
            }
            control={
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setDialog({ kind: "exclude" })}>
                {t.pick}
              </Button>
            }
          />
          <SettingsRow
            label={ft.deviceName}
            htmlFor="sync-device-name"
            description={deviceOk ? ft.deviceNameHint : <span className="text-destructive">{ft.deviceNameMissing}</span>}
            control={
              <Input
                id="sync-device-name"
                variant="sm"
                className="w-60"
                value={draft.device}
                disabled={busy}
                aria-invalid={!deviceOk || undefined}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setError(null);
                  setDraft((d) => ({ ...d, device: e.target.value }));
                }}
              />
            }
          />
          {problem && dirty && (
            <div className="px-4 pb-3 tw-label text-destructive motion-fade">{ft.problem[problem]}</div>
          )}
          <SaveBar
            dirty={dirty}
            pending={busy}
            saved={justSaved}
            invalid={!valid}
            onDiscard={() => {
              setError(null);
              reset();
            }}
          />
        </SettingsCard>
      </form>
      <Banner layout="inline" tone="error" show={error !== null} title={t.saveFailed}>
        {error}
      </Banner>
      <Devices view={view} />

      {dialog?.kind === "stop" && <StopDialog onClose={() => setDialog(null)} onDone={reload} />}
      {dialog?.kind === "conflicts" && <ConflictDialog onClose={() => setDialog(null)} onResolved={onView} />}
      {dialog?.kind === "unlock" && <UnlockDialog onClose={() => setDialog(null)} onDone={onView} />}
      {dialog?.kind === "encryption" && (
        <EncryptionDialog action={dialog.action} onClose={() => setDialog(null)} onDone={onView} />
      )}
      {dialog?.kind === "exclude" && (
        <ExcludeDialog
          upstreams={upstreams}
          value={draft.excluded}
          onClose={() => setDialog(null)}
          onDone={(excluded) => setDraft((d) => ({ ...d, excluded }))}
        />
      )}
    </>
  );
}

/**
 * 状态行下面的几句说明，**不另起提示**：同步位置上跳过了的文件（`skipped`），上一轮同步成了
 * 但没照办的地方（`notices`，比如通用偏好超出上限、这台留着自己的）。没有就什么都不画
 */
function StateNotes({ view }: { view: SyncView }) {
  const t = useText(syncPartText);
  const lines = [
    ...(view.skipped > 0 ? [t.skipped(view.skipped)] : []),
    ...view.notices.map((m) => sentence(coreText(m))),
  ];
  if (lines.length === 0) return null;
  return (
    <span className="flex flex-col gap-0.5">
      {lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </span>
  );
}

/** 状态那一格：已同步 · 2 分钟前、正在同步、有几项冲突、连不上…… */
function State({ view }: { view: SyncView }) {
  const t = useText(syncPartText);
  const now = useNow(30_000);
  let tone: StatusTone = "warn";
  let text: string;
  switch (view.state) {
    case "idle":
    case "off":
      tone = "ok";
      text = view.last_synced_ms ? t.state.idle(ago(view.last_synced_ms, now)) : t.state.never;
      break;
    case "syncing":
      tone = "pending";
      text = t.state.syncing;
      break;
    case "conflict":
      text = t.state.conflict(view.conflicts);
      break;
    case "paused":
      tone = "idle";
      text = t.state.paused;
      break;
    default:
      text = t.state[view.state];
  }
  return (
    <StatusLabel tone={tone} muted={tone === "ok"} className="motion-fade" key={view.state}>
      {text}
    </StatusLabel>
  );
}

/**
 * 设备列表：本设备在前，其余按最后同步的时间。**版本过新而暂停的写「已暂停：需更新」**
 * —— 别的设备上看得见是哪一台卡住了
 */
function Devices({ view }: { view: SyncView }) {
  const t = useText(syncPartText);
  const now = useNow(30_000);
  if (view.devices.length === 0) return null;
  const list = [...view.devices].sort((a, b) => Number(b.this) - Number(a.this) || b.last_seen_ms - a.last_seen_ms);
  return (
    <SettingsCard>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full pl-4">{t.devices}</TableHead>
            <TableHead className="whitespace-nowrap">{t.lastSeen}</TableHead>
            <TableHead className="whitespace-nowrap">{t.coreVersion}</TableHead>
            <TableHead className="pr-4 whitespace-nowrap">{t.deviceState}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((d) => (
            <TableRow key={d.id} className="hover:bg-transparent">
              <TableCell className="max-w-0 pl-4">
                <span className="block truncate">
                  {d.this ? t.thisDevice(d.name) : d.remote_core ? t.remoteCore(d.name) : d.name}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground tw-num">{ago(d.last_seen_ms, now)}</TableCell>
              <TableCell className="font-mono whitespace-nowrap text-muted-foreground">{d.core_version}</TableCell>
              <TableCell className="pr-4 whitespace-nowrap">
                {d.paused_update ? (
                  <StatusLabel tone="warn">{t.pausedUpdate}</StatusLabel>
                ) : (
                  <StatusLabel tone="ok" muted>
                    {t.ok}
                  </StatusLabel>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </SettingsCard>
  );
}
