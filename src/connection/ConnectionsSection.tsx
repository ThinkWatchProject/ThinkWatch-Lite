import { useEffect, useState, type KeyboardEvent } from "react";
import { PlusIcon } from "lucide-react";
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
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { IconLocal, IconRemote } from "@/ui/icons";
import { rowMotion, usePresentList } from "@/ui/motion";
import { notify } from "@/ui/notify";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Segmented } from "@/ui/segmented";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { cn } from "@/lib/utils";
import { useLang, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { ListSkeleton } from "@/ui/states";
import { Skeleton } from "@/ui/skeleton";
import { SettingsCard, SettingsGroup, SettingsRow } from "@/settings/kit";
import { connApi, type ConnView, type Profile, type Startup } from "./api";
import { connText } from "./connection.i18n";
import { useConnections } from "./ConnectionProvider";
import { profileName } from "./describe";
import { remoteStatus, type Tone } from "./Switcher";

/** 「9 月 20 日」/「Sep 20」 */
function day(ms: number, lang: "zh" | "en"): string {
  return new Date(ms).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: lang === "zh" ? "long" : "short",
    day: "numeric",
  });
}

/** 这一行此刻的状态：只有当前连着的那一条有 */
export interface LinkStatus {
  text: string;
  tone: StatusTone;
}

/**
 * 侧栏切换器的三档（`Tone`）换成状态点的说法，**字也用侧栏那几个**：同一个窗口里
 * 左下角写「已停止」、设置页写另一句，读起来像两件事。正在启动、正在连接是此刻在
 * 发生的事，点会跳。
 */
export function linkStatus(s: { text: string; tone: Tone }): LinkStatus {
  return { text: s.text, tone: s.tone === "ok" ? "ok" : s.tone === "warn" ? "pending" : "error" };
}

/**
 * 设置 → 连接（设计稿 ②）。**放在设置页最上方**：连不上的时候用户就是来这里的。
 *
 * 一条连接一行，和侧栏底部的切换器同一套说法：图标、名字、地址；当前那一条挂「当前」
 * 和它此刻的状态（本机 core 的状态，或者远程的已连接 / 正在连接 / 未连接）。别的行
 * 右边是「切换」。编辑、删除在行尾的「…」和右键菜单里；点一下远程那一行也是编辑。
 *
 * 新建和编辑一律走对话框（③），页面上不做内联表单。当前连接删不掉，要先切走；本机
 * 内置、删不掉。「启动时连接」是几个里选一个，用分段控件。
 *
 * **不依赖 core 的任何数据**：远程连不上时这一节照样能用 —— 这正是用户这时要来的地方。
 */
export function ConnectionsSection({ local }: { local: LinkStatus }) {
  const t = useText(connText);
  const { view, add, edit, switchTo } = useConnections();
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const rows = usePresentList(view?.profiles ?? [], (p) => p.id);

  return (
    <SettingsGroup
      id="connections"
      title={t.title}
      description={t.intro}
      actions={
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <PlusIcon />
          {t.add}
        </Button>
      }
    >
      <SettingsCard>
        {view ? (
          <ul aria-label={t.title}>
            {rows.map(({ item: p, key, presence }) => (
              <ProfileRow
                key={key}
                p={p}
                view={view}
                local={local}
                className={rowMotion(presence)}
                onSwitch={() => switchTo(p.id)}
                onEdit={() => edit(p)}
                onDelete={() => setDeleting(p)}
              />
            ))}
          </ul>
        ) : (
          <ListSkeleton rows={2} className="p-2" />
        )}
      </SettingsCard>

      <SettingsCard>
        <StartupRow view={view} />
      </SettingsCard>

      <DeleteDialog profile={deleting} onClose={() => setDeleting(null)} />
    </SettingsGroup>
  );
}

/** 启动时连接：上次使用的 / 本机。先按新值画上，列表推回来之前不弹回去 */
function StartupRow({ view }: { view: ConnView | null }) {
  const t = useText(connText);
  const [want, setWant] = useState<Startup | null>(null);
  const saved = view?.startup ?? null;
  // 推回来的列表已经是选的那一档了：不再需要本地那一份
  useEffect(() => {
    if (want !== null && saved === want) setWant(null);
  }, [saved, want]);
  const value = want ?? saved;
  return (
    <SettingsRow
      label={t.startupLabel}
      description={t.startupHint}
      control={
        value ? (
          <Segmented<Startup>
            value={value}
            label={t.startupLabel}
            options={[
              { id: "last", label: t.startupLast },
              { id: "local", label: t.startupLocal },
            ]}
            onChange={(s) => {
              setWant(s);
              connApi.setStartup(s).catch((e) => {
                setWant(null);
                notify.error(e);
              });
            }}
          />
        ) : (
          // 连接列表还没到：先占住分段控件的位置，到了不跳
          <Skeleton className="h-7 w-44 rounded-lg" />
        )
      }
    />
  );
}

function ProfileRow({
  p,
  view,
  local,
  className,
  onSwitch,
  onEdit,
  onDelete,
}: {
  p: Profile;
  view: ConnView;
  local: LinkStatus;
  className?: string;
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useText(connText);
  const common = useText(commonText);
  const lang = useLang();
  const current = p.id === view.current;
  const Icon = p.local ? IconLocal : IconRemote;
  const name = profileName(p);

  let desc: string;
  if (p.local) desc = t.localNote(view.data_dir);
  else if (current && view.link.kind === "connected")
    desc = `${p.addr} · ${t.coreVersion(view.link.info.core_version)}`;
  else if (p.last_connected_at != null) desc = `${p.addr} · ${t.lastConnected(day(p.last_connected_at, lang))}`;
  else desc = `${p.addr} · ${t.neverConnected}`;

  const status: LinkStatus | null = !current ? null : p.local ? local : linkStatus(remoteStatus(view));

  // 当前连着的删不掉，要先切走：菜单里那一项置灰，而不是点了才说不行
  const items: MenuItems = [
    ...(current ? [] : [{ kind: "item" as const, label: t.switchTo, onSelect: onSwitch }]),
    ...(p.local
      ? []
      : [
          { kind: "item" as const, label: common.edit, onSelect: onEdit },
          { kind: "sep" as const },
          { kind: "item" as const, label: common.delete, danger: true, disabled: current, onSelect: onDelete },
        ]),
  ];
  // 远程那一行点一下就是编辑；本机那一行没有可编辑的东西
  const editable = !p.local;
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (!editable || e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onEdit();
    }
  };

  const row = (
    <li
      data-slot="settings-row"
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `${name} · ${common.edit}` : undefined}
      onClick={editable ? onEdit : undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "relative flex items-center gap-3 px-4 py-3 outline-none",
        "before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:border-t before:border-border first:before:hidden",
        editable && "cursor-default transition-colors duration-(--motion-fast) hover:bg-muted/50 focus-visible:bg-muted/50",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background",
          current ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 tw-body font-medium text-foreground">
          <span className="truncate">{name}</span>
          {current && <Badge variant="secondary">{t.current}</Badge>}
        </p>
        <p className="truncate font-mono tw-label text-muted-foreground">{desc}</p>
      </div>
      {status && (
        <StatusLabel tone={status.tone} muted={status.tone === "ok"} className="shrink-0">
          {status.text}
        </StatusLabel>
      )}
      <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {!current && (
          <Button type="button" size="sm" variant="outline" onClick={onSwitch}>
            {t.switchShort}
          </Button>
        )}
        {items.length > 0 && <RowMenuButton items={items} label={t.actionsFor(name)} />}
      </div>
    </li>
  );
  return items.length > 0 ? <RowMenu items={items}>{row}</RowMenu> : row;
}

function DeleteDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const t = useText(connText);
  const common = useText(commonText);
  return (
    <AlertDialog open={profile !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="tw-title">{profile ? t.deleteTitle(profileName(profile)) : ""}</AlertDialogTitle>
          <AlertDialogDescription>{t.deleteBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (profile) connApi.remove(profile.id).catch((e) => notify.error(e));
              onClose();
            }}
          >
            {common.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
