import { useState } from "react";
import { GripVerticalIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { groupKindLabel } from "@/labels";
import type { GroupKind, Overview } from "@/types";
import { billingLabel, errorText, protocolLabel } from "@/upstreams/labels";
import { Boxed, FormItem, Note, RadioRow } from "@/upstreams/parts";
import { api } from "./api";
import { groupDialogText } from "./GroupDialog.i18n";
import { groupRefs } from "./GroupTable";
import { move, strategies } from "./model";
import { routingText } from "./routing.i18n";
import { useReorder } from "./useReorder";

export type GroupDialogMode =
  | { kind: "create" }
  | { kind: "edit"; name: string }
  | { kind: "duplicate"; from: string };

/**
 * 新建、编辑、复制策略组。
 *
 * 左边是策略，右边是成员 —— 成员的先后在「按顺序」「手动选择」里就是优先级，
 * 所以可以拖动；手动选择还要在已选成员里定一个优先使用的。
 */
export function GroupDialog({
  mode,
  ov,
  configVersion,
  onClose,
  onSaved,
}: {
  mode: GroupDialogMode;
  ov: Overview;
  configVersion: string | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const t = useText(groupDialogText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const source =
    mode.kind === "edit"
      ? ov.groups.find((g) => g.name === mode.name)
      : mode.kind === "duplicate"
        ? ov.groups.find((g) => g.name === mode.from)
        : undefined;
  const [name, setName] = useState(
    mode.kind === "edit" ? mode.name : mode.kind === "duplicate" ? rt.copyName(mode.from) : "",
  );
  const [kind, setKind] = useState<GroupKind>(source?.kind ?? "fallback");
  const [order, setOrder] = useState<string[]>(() => {
    const members = source?.providers ?? [];
    return [...members, ...ov.providers.map((p) => p.name).filter((n) => !members.includes(n))];
  });
  const [members, setMembers] = useState<string[]>(source?.providers ?? []);
  const [selected, setSelected] = useState<string | null>(source?.selected ?? null);
  const [sticky, setSticky] = useState(source?.session_affinity ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reorder = useReorder((from, to) => setOrder((o) => move(o, from, to)));

  const chosen = order.filter((n) => members.includes(n));
  const preferred =
    kind === "select" ? (selected && chosen.includes(selected) ? selected : (chosen[0] ?? null)) : null;
  const refs = mode.kind === "edit" ? groupRefs(ov, mode.name) : [];
  const trimmed = name.trim();
  const taken =
    ov.groups.some((g) => g.name === trimmed && !(mode.kind === "edit" && g.name === mode.name)) ||
    ov.providers.some((p) => p.name === trimmed);
  const missing = !trimmed
    ? rt.nameMissing
    : trimmed.startsWith("__")
      ? rt.nameReserved
      : taken
        ? rt.nameTaken(trimmed)
        : chosen.length === 0
          ? t.noMembers
          : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const save = {
        group: {
          name: trimmed,
          kind,
          providers: chosen,
          selected: preferred,
          session_affinity: kind === "load-balance" ? sticky : true,
        },
        base_version: configVersion ?? undefined,
      };
      if (mode.kind === "edit") await api.updateGroup(mode.name, save);
      else await api.createGroup(save);
      onSaved(trimmed);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const title =
    mode.kind === "edit" ? t.editTitle(mode.name) : mode.kind === "duplicate" ? t.duplicateTitle : rt.newGroup;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>{refs.length > 0 ? t.referencedBy(refs) : t.intro}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] items-start gap-6 overflow-y-auto px-4 pb-1">
          <div className="flex flex-col gap-4">
            <FormItem label={rt.name} htmlFor="group-name">
              <Input id="group-name" autoFocus={mode.kind !== "edit"} value={name} onChange={(e) => setName(e.target.value)} />
            </FormItem>
            <div className="flex flex-col gap-1.5">
              <span className="tw-body font-medium">{rt.strategy}</span>
              <div role="radiogroup" aria-label={rt.strategy} className="flex flex-col gap-3">
                {strategies().map((s) => (
                  <RadioRow
                    key={s.id}
                    checked={kind === s.id}
                    title={groupKindLabel(s.id)}
                    desc={
                      s.id === "url-test" ? (
                        <>
                          {s.desc}
                          <Badge variant="warning" className="ml-1.5 align-middle">
                            {rt.affectsCache}
                          </Badge>
                        </>
                      ) : (
                        s.desc
                      )
                    }
                    onSelect={() => setKind(s.id)}
                  />
                ))}
              </div>
            </div>
            {kind === "load-balance" && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 tw-body">
                  <Switch checked={sticky} onCheckedChange={setSticky} />
                  {t.sticky}
                </label>
                <Note tone={sticky ? "muted" : "warning"}>{sticky ? t.stickyOn : t.stickyOff}</Note>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="tw-body font-medium">{rt.members}</span>
              <span className="tw-label text-muted-foreground">{t.selectedCount(chosen.length)}</span>
            </div>
            {ov.providers.length === 0 ? (
              <Note>{t.noUpstreams}</Note>
            ) : (
              <Boxed>
                <table className="w-full tw-body">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="w-7" />
                      <th className="w-7" />
                      <th className="py-2 font-medium">{t.upstream}</th>
                      {kind === "select" && <th className="w-20 pr-3 text-center font-medium">{t.preferred}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((n, i) => {
                      const p = ov.providers.find((x) => x.name === n);
                      const on = members.includes(n);
                      const mark = reorder.marker(i, order.length);
                      return (
                        <tr
                          key={n}
                          data-reorder-row={i}
                          className={cn(
                            "border-b border-border last:border-b-0",
                            reorder.dragging === i && "opacity-50",
                            mark === "before" && "shadow-[inset_0_2px_0_var(--color-foreground)]",
                            mark === "after" && "shadow-[inset_0_-2px_0_var(--color-foreground)]",
                          )}
                        >
                          <td className="pl-2 text-muted-foreground/60" aria-label={t.dragMember(n)} {...reorder.handle(i)}>
                            <GripVerticalIcon className="size-3.5" />
                          </td>
                          <td>
                            <Checkbox
                              aria-label={t.toggleMember(on, n)}
                              checked={on}
                              onCheckedChange={(v) =>
                                setMembers((m) => (v === true ? [...m, n] : m.filter((x) => x !== n)))
                              }
                            />
                          </td>
                          <td className="py-1.5">
                            <div className={on ? "font-medium" : "text-muted-foreground"}>{n}</div>
                            {p && (
                              <div className="tw-label text-muted-foreground">
                                {protocolLabel(p.protocol)} · {billingLabel(p.billing ?? p.billing_effective)}
                                {p.disabled && t.disabledSuffix}
                              </div>
                            )}
                          </td>
                          {kind === "select" && (
                            <td className="pr-3 text-center">
                              {on && (
                                <input
                                  type="radio"
                                  name="group-preferred"
                                  aria-label={t.prefer(n)}
                                  className="size-3.5 accent-foreground"
                                  checked={preferred === n}
                                  onChange={() => setSelected(n)}
                                />
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Boxed>
            )}
            <Note>
              {kind === "select"
                ? t.orderSelect
                : kind === "fallback"
                  ? t.orderFallback
                  : t.orderOther}
            </Note>
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            {ct.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={saving || missing != null}>
            {saving && <Spinner />}
            {mode.kind === "edit" ? ct.save : rt.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
