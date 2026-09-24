import { useState } from "react";
import { RotateCwIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Switch } from "@/ui/switch";
import { when } from "@/format";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ClientView, DetectedClient, KnownModel, ManualClient, RouteView } from "@/types";
import { api } from "./api";
import type { KeyUse } from "./data";
import { keyDialogText } from "./KeyDialog.i18n";
import { errorText, routeLabel, takeoverOf } from "./labels";
import { TakeoverBadge } from "./KeysTable";
import { ModelScope } from "./ModelScope";
import { CopyButton, focusSelf, useDialogFocus } from "./parts";
import { allowOf, scopeOf, type Scope } from "./scope";

/**
 * 新建与编辑一把密钥。
 *
 * 密钥的值不是一个可填的字段：它由 core 生成，要换走「更换」——
 * 那条路会把新值同步给正在用它的客户端。
 */
export function KeyDialog({
  editing,
  keys,
  clients,
  manual,
  usage,
  usageLoaded,
  routes,
  defaultRoute,
  catalog,
  version,
  onClose,
  onSaved,
  onRotate,
}: {
  /** 编辑哪一把。不给就是新建 */
  editing: ClientView | null;
  keys: ClientView[];
  clients: DetectedClient[];
  manual: ManualClient[];
  /** 这一把 24 小时的用量。没有请求、或者没取到时没有 */
  usage: KeyUse | undefined;
  usageLoaded: boolean;
  routes: RouteView[];
  defaultRoute: string;
  /** 网关知道的全部模型，用来勾选可见范围。取不到时为空 */
  catalog: KnownModel[];
  /** 写配置时带的版本号 */
  version: { get: () => string };
  onClose: () => void;
  /** 保存好了：密钥名，和配置的新版本 */
  onSaved: (name: string, version: string) => void;
  onRotate: (name: string) => void;
}) {
  const t = useText(keyDialogText);
  const dialogFocus = useDialogFocus();
  const common = useText(commonText);
  const [name, setName] = useState(editing?.name ?? "");
  const [route, setRoute] = useState(editing?.route ?? "");
  const [scope, setScope] = useState<Scope>(scopeOf(editing?.allow));
  const [entries, setEntries] = useState<string[]>(editing?.allow ?? []);
  const [limit, setLimit] = useState(editing?.max_concurrent != null ? String(editing.max_concurrent) : "");
  const [enabled, setEnabled] = useState(!editing?.disabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const owner = editing ? takeoverOf(editing, clients, manual) : null;
  const taken = keys.some((k) => k.name === name.trim() && k.name !== editing?.name);
  const missing =
    name.trim().length === 0
      ? t.nameRequired
      : taken
        ? t.nameTaken
        : scope === "some" && entries.length === 0
          ? t.patternsRequired
          : null;

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      key: {
        name: name.trim(),
        route: route || null,
        allow: allowOf(scope, entries),
        max_concurrent: limit.trim() ? Number(limit.trim()) : null,
        disabled: !enabled,
      },
      base_version: version.get(),
    };
    try {
      const w = editing ? await api.updateKey(editing.name, body) : await api.createKey(body);
      onSaved(name.trim(), w.version);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        {...dialogFocus}
        // 编辑是点一行打开的：焦点落在对话框本身，不落到第一个按钮上 —— WebKit 里
        // 脚本给的焦点会在按钮上画一圈框。新建时照常落到名称输入框
        onOpenAutoFocus={editing ? focusSelf : undefined}
      >
        <DialogHeader>
          <DialogTitle>{editing ? t.editTitle : t.newTitle}</DialogTitle>
          <DialogDescription asChild={editing != null}>
            {editing ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-foreground">{editing.name}</span>
                {owner && <TakeoverBadge owner={owner} logo />}
              </div>
            ) : (
              t.newDescription
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono tw-body select-text">{editing.key}</p>
                <p className="tw-label text-muted-foreground">
                  {editing.last_seen_ms ? t.lastUsed(when(editing.last_seen_ms)) : t.neverUsed}
                  {usageLoaded && usage && usage.requests > 0 && ` · ${t.usage(usage.requests)}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <CopyButton
                  onCopy={() =>
                    api.copyKey(editing.name).catch((e: unknown) => {
                      setError(errorText(e));
                      throw e;
                    })
                  }
                />
                <Button variant="outline" size="sm" onClick={() => onRotate(editing.name)}>
                  <RotateCwIcon />
                  {t.rotate}
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-name">
                {t.name}
              </label>
              <Input
                id="k-name"
                className="font-mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.namePlaceholder}
                aria-invalid={taken}
              />
              <p className="tw-label text-muted-foreground">{t.nameHint}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label className="tw-body font-medium" htmlFor="k-route">
                {t.route}
              </label>
              <NativeSelect id="k-route" value={route} onChange={(e) => setRoute(e.target.value)}>
                {/* 不绑就是走默认路由 —— 写出来，而不是留一个空白 */}
                <NativeSelectOption value="">{routeLabel(null, defaultRoute)}</NativeSelectOption>
                {routes
                  .filter((r) => r.name !== defaultRoute)
                  .map((r) => (
                    <NativeSelectOption key={r.name} value={r.name}>
                      {r.name}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <p className="tw-label text-muted-foreground">{t.routeHint}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5 sm:w-1/2 sm:pr-2">
            <label className="tw-body font-medium" htmlFor="k-limit">
              {t.limit}
            </label>
            <Input
              id="k-limit"
              className="font-mono"
              value={limit}
              placeholder={t.noLimit}
              onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>

          <ModelScope scope={scope} entries={entries} catalog={catalog} onScope={setScope} onEntries={setEntries} />

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div>
              <label className="tw-body font-medium" htmlFor="k-enabled">
                {t.enabled}
              </label>
              <p className="tw-label text-muted-foreground">
                {editing?.default ? t.defaultAlwaysOn : t.disabledRejects}
              </p>
            </div>
            <Switch id="k-enabled" checked={enabled} disabled={editing?.default} onCheckedChange={(v) => setEnabled(v)} />
          </div>
        </div>

        <Banner show={error !== null} layout="inline" tone="error">
          {error}
        </Banner>

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {common.cancel}
          </Button>
          <Button onClick={() => void save()} pending={saving} disabled={missing != null}>
            {editing ? common.save : t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
