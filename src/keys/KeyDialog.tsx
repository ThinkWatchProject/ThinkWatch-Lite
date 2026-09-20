import { useState } from "react";
import { CopyIcon, RotateCwIcon } from "lucide-react";
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
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { when } from "@/format";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ClientView, CostGroup, DetectedClient, KnownModel, RouteView } from "@/types";
import { api } from "./api";
import { keyDialogText } from "./KeyDialog.i18n";
import { errorText, routeLabel, useLabel } from "./labels";
import { ModelScope } from "./ModelScope";
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
  usage,
  routes,
  defaultRoute,
  catalog,
  configVersion,
  onClose,
  onSaved,
  onRotate,
}: {
  /** 编辑哪一把。不给就是新建 */
  editing: ClientView | null;
  keys: ClientView[];
  clients: DetectedClient[];
  usage: CostGroup[];
  routes: RouteView[];
  defaultRoute: string;
  /** 网关知道的全部模型，用来勾选可见范围。取不到时为空 */
  catalog: KnownModel[];
  configVersion: string | null;
  onClose: () => void;
  onSaved: (name: string) => void;
  onRotate: (name: string) => void;
}) {
  const t = useText(keyDialogText);
  const common = useText(commonText);
  const [name, setName] = useState(editing?.name ?? "");
  const [route, setRoute] = useState(editing?.route ?? "");
  const [scope, setScope] = useState<Scope>(scopeOf(editing?.allow));
  const [entries, setEntries] = useState<string[]>(editing?.allow ?? []);
  const [limit, setLimit] = useState(
    editing?.max_concurrent != null ? String(editing.max_concurrent) : "",
  );
  const [enabled, setEnabled] = useState(!editing?.disabled);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = usage.find((u) => u.name === editing?.name);
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
      base_version: configVersion ?? undefined,
    };
    try {
      if (editing) await api.updateKey(editing.name, body);
      else await api.createKey(body);
      onSaved(name.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? t.editTitle : t.newTitle}</DialogTitle>
          <DialogDescription>
            {editing ? (
              <>
                <span className="font-mono text-foreground">{editing.name}</span> ·{" "}
                {useLabel(editing, clients)}
              </>
            ) : (
              t.newDescription
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {editing && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono tw-body">{editing.key}</p>
                <p className="tw-label text-muted-foreground">
                  {editing.last_seen_ms ? t.lastUsed(when(editing.last_seen_ms)) : t.neverUsed}
                  {used && used.requests > 0 && ` · ${t.usage(used.requests)}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCopied(false);
                    api
                      .copyKey(editing.name)
                      .then(() => setCopied(true))
                      .catch((e) => setError(errorText(e)));
                  }}
                >
                  <CopyIcon />
                  {copied ? common.copied : common.copy}
                </Button>
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

          <ModelScope
            scope={scope}
            entries={entries}
            catalog={catalog}
            onScope={setScope}
            onEntries={setEntries}
          />

          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
            <div>
              <p className="tw-body font-medium">{t.enabled}</p>
              <p className="tw-label text-muted-foreground">
                {editing?.default ? t.defaultAlwaysOn : t.disabledRejects}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={editing?.default}
              onCheckedChange={(v) => setEnabled(v)}
            />
          </div>
        </div>

        {error && <p className="tw-body text-destructive">{error}</p>}

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={saving || missing != null}>
            {saving && <Spinner />}
            {editing ? common.save : t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
