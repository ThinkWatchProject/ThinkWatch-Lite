import { useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Switch } from "@/ui/switch";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { focusSelf, useDialogFocus } from "@/keys/parts";
import { DialogError } from "@/upstreams/parts";
import type { OnError, PluginView } from "@/types";
import { localSchema, pluginName } from "./defaults";
import { draftOf, scopeOf, scopeProblem, ScopeFields, settingsDraftOf, settingsOf, SettingsFields } from "./fields";
import { pluginFieldsText } from "./fields.i18n";
import { pluginLabelsText } from "./labels.i18n";
import { manifestUnknown, shaPrefix } from "./model";
import { savePlugin } from "./native";
import { PermissionChips, PluginText, RequestKinds } from "./parts";
import { settingsDialogText } from "./SettingsDialog.i18n";
import { OnErrorField } from "./SourceDialog";

/**
 * 一个插件的设置：启用、出错时、适用范围、插件自己的设置项。**改完点保存才写**
 * （一次写成一个配置版本）。
 *
 * 保存带的是**打开时的版本号**：对话框开着的时候别处改了配置，core 会说「版本不一致」，
 * 而不是让这份旧表单把别人的改动盖掉（和密钥对话框同一条）。
 *
 * **改得了工具调用的插件**（或者读不出权限的），打开它、改设置、改范围要在系统的确认框里
 * 点头（`savePlugin`）。在那里点了取消，表单原样留着、什么都没写。
 *
 * 代码不在这里改：「更换代码」走另一个对话框，最后要在系统对话框里确认。
 */
export function SettingsDialog({
  plugin,
  version,
  onClose,
  onSaved,
  onReplace,
}: {
  plugin: PluginView;
  version: { get: () => string };
  onClose: () => void;
  onSaved: (version: string) => void;
  onReplace: () => void;
}) {
  const t = useText(settingsDialogText);
  const lt = useText(pluginLabelsText);
  const ft = useText(pluginFieldsText);
  const common = useText(commonText);
  const dialogFocus = useDialogFocus();
  const [base] = useState(() => version.get());
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [onError, setOnError] = useState<OnError>(plugin.on_error);
  const [scope, setScope] = useState(() => draftOf(plugin.scope));
  const [settings, setSettings] = useState(() => settingsDraftOf(plugin.settings_schema, plugin.settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const unknown = manifestUnknown(plugin);
  // 默认插件的设置项标签按界面语言说；键、类型、默认值不变
  const schema = localSchema(plugin.id, plugin.name, plugin.settings_schema);
  const check = settingsOf(schema, settings);
  const nextScope = scopeOf(scope);
  const dirty =
    enabled !== plugin.enabled ||
    onError !== plugin.on_error ||
    JSON.stringify(nextScope) !== JSON.stringify(plugin.scope) ||
    JSON.stringify(check.values) !== JSON.stringify(settingsOf(schema, settingsDraftOf(schema, plugin.settings)).values);
  const missing = scopeProblem(scope);
  const problem = missing ? ft.needOne(lt.scopeParts[missing]) : check.bad[0] ? ft.numberBad(check.bad[0]) : null;

  async function save() {
    setSaving(true);
    setError(null);
    setCancelled(false);
    try {
      const r = await savePlugin(plugin, {
        enabled,
        on_error: onError,
        scope: nextScope,
        settings: check.values,
        base_version: base,
      });
      if (r.kind === "cancelled") {
        // 系统的确认框里点了取消：表单原样留着
        setCancelled(true);
        setSaving(false);
        return;
      }
      onSaved(r.version);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl" {...dialogFocus} onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate tw-body text-foreground">
                {unknown ? <span className="font-mono">{plugin.id}</span> : <PluginText text={pluginName(plugin.id, plugin.name)} />}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 tw-label text-muted-foreground">
                <span className="font-mono select-text">{t.id(plugin.id)}</span>
                <span className="font-mono select-text">{t.sha(shaPrefix(plugin.sha256))}</span>
                {!unknown && <PermissionChips permissions={plugin.permissions} />}
                {!unknown && <RequestKinds kinds={plugin.requests} />}
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-1">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div>
              <label className="tw-body font-medium" htmlFor="plugin-enabled">
                {t.enabled}
              </label>
              <p className="tw-label text-muted-foreground">{t.enabledHint}</p>
            </div>
            <Switch id="plugin-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <OnErrorField value={onError} onChange={setOnError} />

          <section className="flex flex-col gap-3">
            <h3 className="tw-head text-foreground">{lt.scope}</h3>
            <ScopeFields value={scope} onChange={setScope} />
          </section>

          {schema.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="tw-head text-foreground">{ft.settings}</h3>
              <SettingsFields schema={schema} value={settings} onChange={setSettings} />
            </section>
          )}
        </div>

        <DialogError error={error} />
        {cancelled && <p className="-mt-2 tw-label text-muted-foreground">{t.cancelled}</p>}

        <DialogFooter className="items-center">
          <Button variant="outline" className="sm:mr-auto" disabled={saving} onClick={onReplace}>
            {t.replace}
          </Button>
          {problem && <span className="tw-label text-warning">{problem}</span>}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {common.cancel}
          </Button>
          <Button onClick={() => void save()} pending={saving} disabled={!dirty || problem != null}>
            {common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
