import { useState } from "react";
import { toast } from "sonner";
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
import { Segmented } from "@/ui/segmented";
import { IconLocal, IconRemote } from "@/ui/icons";
import { useLang, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { FormRow, FormRows } from "@/settings/form";
import { connApi, type ConnView, type Profile, type Startup } from "./api";
import { connText } from "./connection.i18n";
import { useConnections } from "./ConnectionProvider";
import { profileName } from "./describe";

/** 「9 月 20 日」/「Sep 20」 */
function day(ms: number, lang: "zh" | "en"): string {
  return new Date(ms).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: lang === "zh" ? "long" : "short",
    day: "numeric",
  });
}

/**
 * 设置 → 连接（设计稿 ②）。**放在设置页最上方。**
 *
 * 新建和编辑一律走对话框（③），页面上不做内联表单。当前连接不能删除，要先切走；
 * 本机内置、删不掉。「启动时连接」是几个里选一个，用分段控件，和「外观」一样。
 *
 * **不依赖 core 的任何数据**：远程连不上时这一节照样能用 —— 这正是用户这时要来的地方。
 */
export function ConnectionsSection() {
  const t = useText(connText);
  const { view, add, edit, switchTo } = useConnections();
  const [deleting, setDeleting] = useState<Profile | null>(null);
  if (!view) return null;

  async function setStartup(s: Startup) {
    try {
      await connApi.setStartup(s);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  return (
    <section id="connections">
      <div className="flex items-center justify-between gap-4">
        <h2 className="tw-title font-semibold">{t.title}</h2>
        <Button size="sm" variant="outline" onClick={add}>
          {t.add}
        </Button>
      </div>
      <p className="mt-1 tw-body text-muted-foreground">{t.intro}</p>

      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {view.profiles.map((p) => (
          <Row
            key={p.id}
            p={p}
            view={view}
            onSwitch={() => switchTo(p.id)}
            onEdit={() => edit(p)}
            onDelete={() => setDeleting(p)}
          />
        ))}
      </ul>

      <h3 className="mt-5 tw-body font-medium text-muted-foreground">{t.startupGroup}</h3>
      <FormRows>
        <FormRow label={t.startupLabel} hint={t.startupHint}>
          <Segmented<Startup>
            value={view.startup}
            label={t.startupLabel}
            options={[
              { id: "last", label: t.startupLast },
              { id: "local", label: t.startupLocal },
            ]}
            onChange={(v) => void setStartup(v)}
          />
        </FormRow>
      </FormRows>

      <DeleteDialog profile={deleting} onClose={() => setDeleting(null)} />
    </section>
  );
}

function Row({
  p,
  view,
  onSwitch,
  onEdit,
  onDelete,
}: {
  p: Profile;
  view: ConnView;
  onSwitch: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useText(connText);
  const common = useText(commonText);
  const lang = useLang();
  const current = p.id === view.current;
  const Icon = p.local ? IconLocal : IconRemote;
  let desc: string;
  if (p.local) desc = t.localNote(view.data_dir);
  else if (current && view.link.kind === "connected")
    desc = `${p.addr} · ${t.coreVersion(view.link.info.core_version)}`;
  else if (p.last_connected_at != null) desc = `${p.addr} · ${t.lastConnected(day(p.last_connected_at, lang))}`;
  else desc = `${p.addr} · ${t.neverConnected}`;

  return (
    <li className="flex items-center gap-4 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 tw-body font-medium">
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{profileName(p)}</span>
          {current && <Badge variant="secondary">{t.current}</Badge>}
        </p>
        <p className="mt-0.5 truncate tw-label text-muted-foreground">{desc}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!current && (
          <Button size="sm" variant="outline" onClick={onSwitch}>
            {t.switchTo}
          </Button>
        )}
        {!p.local && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {common.edit}
          </Button>
        )}
        {/* 当前连着的删不掉，要先切走：按钮不出现，而不是点了才说不行 */}
        {!p.local && !current && (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            {common.delete}
          </Button>
        )}
      </div>
    </li>
  );
}

function DeleteDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const t = useText(connText);
  const common = useText(commonText);
  return (
    <AlertDialog open={profile !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{profile ? t.deleteTitle(profile.name) : ""}</AlertDialogTitle>
          <AlertDialogDescription>{t.deleteBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (profile) connApi.remove(profile.id).catch((e) => toast.error(errorText(e)));
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
