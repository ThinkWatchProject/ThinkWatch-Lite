import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/resource";
import { FormRow, FormRows } from "@/settings/form";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { Switch } from "@/ui/switch";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { DialogError } from "@/upstreams/parts";
import { errorText } from "@/i18n/core.i18n";
import type { ItemNode, ItemRef, ProviderView } from "@/types";
import { useRemote } from "@/connection/useRemote";
import { backupApi } from "./api";
import { backupText } from "./backup.i18n";
import { closure, countOf, groupBy, itemLabel, kindLabel, namedById, refKey, refOf } from "./items";
import { PassphraseRow, usePassphrase } from "./Passphrase";

/** 配置里有哪些项目（导出时选、导入时查重名）。配置一换就重读 */
export function useConfigItems() {
  return useResource("config-items", backupApi.items, { events: ["config_reloaded"] });
}

/**
 * 导出配置（规格 5.2）。从设置进入时缺省「全部配置」；从上游页多选、分享进入时缺省「选择项目」
 * 并勾好那几个上游。所选项目引用的其他项目自动勾上、标「随附」。
 *
 * 点「导出…」：core 打好配置包，Rust 弹「存储」对话框写盘（`backupApi.save`）。存储对话框里取消
 * 了，这个对话框留着。
 *
 * `providers`：配置里的上游（「不随文件导出」那一行数 ChatGPT 登录要用）。
 */
export function ExportDialog({
  providers,
  preselect,
  onClose,
}: {
  providers: readonly ProviderView[];
  /** 预先勾上的项目：给了就从「选择项目」开始 */
  preselect?: readonly ItemRef[];
  onClose: () => void;
}) {
  const t = useText(backupText);
  const c = useText(commonText);
  const items = useConfigItems();
  const remote = useRemote() !== null;
  const [scope, setScope] = useState<"all" | "items">(preselect && preselect.length > 0 ? "items" : "all");
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set((preselect ?? []).map(refKey)));
  const [secrets, setSecrets] = useState(true);
  const pass = usePassphrase();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nodes = items.data ?? [];
  const { included, along } = useMemo(() => closure(picked, nodes), [picked, nodes]);
  // 登录得来的凭据留在本机：ChatGPT 账号、OAuth 上游换发的令牌（core 的 `omitted_logins`）
  const logins = providers.filter(
    (p) =>
      (p.protocol === "chatgpt" || p.oauth != null) &&
      (scope === "all" || included.has(refKey({ kind: "provider", name: p.name }))),
  ).length;
  const empty = scope === "items" && included.size === 0;
  const ready = !empty && pass.problem === null && !(scope === "items" && items.data === undefined);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const f = await backupApi.export({
        scope: scope === "all" ? "all" : { items: [...included].map(refOf) },
        secrets,
        passphrase: pass.value,
        // 远程模式下由 Lite 附上这台设备上的通用偏好（规格 4.4）；本机模式下 core 存着它
        client_prefs: remote ? await backupApi.clientPrefs() : null,
      });
      const path = await backupApi.save(f);
      if (path) {
        notify.success(t.exported(path));
        onClose();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[86vh] flex-col gap-4 sm:max-w-[600px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="tw-title">{t.exportTitle}</DialogTitle>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          <FormRows>
            <FormRow
              label={t.scope}
              hint={
                scope === "all" ? (
                  items.data ? (
                    t.total(countOf(nodes, "provider"), countOf(nodes, "key"), countOf(nodes, "route"), countOf(nodes, "plugin"))
                  ) : undefined
                ) : empty ? (
                  t.noneSelected
                ) : (
                  t.selected(included.size)
                )
              }
            >
              <Segmented
                value={scope}
                label={t.scope}
                disabled={busy}
                options={[
                  { id: "all", label: t.scopeAll },
                  { id: "items", label: t.scopeItems },
                ]}
                onChange={setScope}
              />
              {scope === "items" &&
                (items.error !== undefined && items.data === undefined ? (
                  <ErrorState
                    compact
                    className="mt-1.5 w-full"
                    title={t.itemsFailed}
                    error={items.error}
                    onRetry={() => void items.reload()}
                  />
                ) : (
                  <ItemPicker
                    nodes={items.data}
                    picked={picked}
                    along={along}
                    disabled={busy}
                    onChange={setPicked}
                  />
                ))}
            </FormRow>
            <FormRow label={t.secrets}>
              <label className="flex items-center gap-2.5 pt-0.5 tw-body">
                <Switch checked={secrets} disabled={busy} onCheckedChange={setSecrets} />
                {t.secretsWhat}
              </label>
            </FormRow>
            <PassphraseRow p={pass} disabled={busy} />
            <FormRow label={t.omitted}>
              <ul className="flex flex-col gap-0.5 pt-1 tw-body text-muted-foreground">
                {logins > 0 && <li>{t.omitLogins(logins)}</li>}
                {!secrets && <li>{t.omitSecrets}</li>}
                <li>{t.omitLocal}</li>
                <li>{t.omitData}</li>
              </ul>
            </FormRow>
          </FormRows>
        </div>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          {secrets && !pass.on && <span className="mr-auto tw-label text-warning-foreground">{t.plaintext}</span>}
          <Button variant="outline" onClick={onClose}>
            {c.cancel}
          </Button>
          <Button pending={busy} disabled={!ready} onClick={() => void run()}>
            {t.exportAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 「选择项目」的清单：按类分组，每组一个总勾选框。随附的勾着、不能取消（取消掉引用它的那一项
 * 才会跟着去掉），名字后面标「随附」
 */
function ItemPicker({
  nodes,
  picked,
  along,
  disabled,
  onChange,
}: {
  nodes: readonly ItemNode[] | undefined;
  picked: ReadonlySet<string>;
  along: ReadonlySet<string>;
  disabled: boolean;
  onChange: (next: ReadonlySet<string>) => void;
}) {
  const t = useText(backupText);
  if (!nodes) {
    return (
      <div className="mt-1.5 flex w-full flex-col gap-2 rounded-lg border border-border p-3" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-48 rounded-sm" />
        ))}
      </div>
    );
  }
  const groups = groupBy(nodes, (n) => n.item);
  const toggle = (keys: string[], on: boolean) => {
    const next = new Set(picked);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    onChange(next);
  };
  return (
    <div className="mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-border">
      {groups.map((g) => {
        const keys = g.items.map((n) => refKey(n.item));
        const own = keys.filter((k) => picked.has(k)).length;
        const all = keys.every((k) => picked.has(k) || along.has(k));
        const head = own === 0 && !keys.some((k) => along.has(k)) ? false : all ? true : "indeterminate";
        return (
          <div key={g.kind} className="border-b border-border last:border-b-0">
            <label className="flex items-center gap-2.5 bg-muted/40 px-3 py-1.5 tw-label font-medium text-muted-foreground">
              <Checkbox
                checked={head}
                disabled={disabled}
                aria-label={kindLabel(g.kind)}
                onCheckedChange={(v) => toggle(keys, v === true)}
              />
              {kindLabel(g.kind)}
            </label>
            {g.items.map((n) => {
              const k = refKey(n.item);
              const isAlong = along.has(k);
              return (
                <label
                  key={k}
                  className={cn("flex min-w-0 items-center gap-2.5 px-3 py-1.5 tw-body", isAlong && "text-muted-foreground")}
                >
                  <Checkbox
                    checked={picked.has(k) || isAlong}
                    disabled={disabled || isAlong}
                    onCheckedChange={(v) => toggle([k], v === true)}
                  />
                  <span className={cn("min-w-0 truncate", namedById(n.item) && "font-mono")}>{itemLabel(n.item)}</span>
                  {isAlong && (
                    <Tip text={t.alongTip}>
                      <Badge variant="outline" className="font-normal">
                        {t.along}
                      </Badge>
                    </Tip>
                  )}
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
