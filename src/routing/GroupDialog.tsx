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
import { groupKindLabel } from "@/labels";
import type { GroupKind, Overview } from "@/types";
import { billingLabel, errorText, protocolLabel } from "@/upstreams/labels";
import { Boxed, FormItem, Note, RadioRow } from "@/upstreams/parts";
import { api } from "./api";
import { groupRefs } from "./GroupTable";
import { STRATEGIES, move } from "./model";
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
  const source =
    mode.kind === "edit"
      ? ov.groups.find((g) => g.name === mode.name)
      : mode.kind === "duplicate"
        ? ov.groups.find((g) => g.name === mode.from)
        : undefined;
  const [name, setName] = useState(
    mode.kind === "edit" ? mode.name : mode.kind === "duplicate" ? `${mode.from} 副本` : "",
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
    ? "填写名称"
    : trimmed.startsWith("__")
      ? "名称不能以 __ 开头"
      : taken
        ? `名称「${trimmed}」已被使用`
        : chosen.length === 0
          ? "至少选择一个上游"
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
    mode.kind === "edit" ? `编辑策略组「${mode.name}」` : mode.kind === "duplicate" ? "复制策略组" : "新建策略组";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>
            {refs.length > 0
              ? `被${refs.map((r) => `「${r.route} · ${r.rule}」`).join("、")}引用。`
              : "规则可以转发至策略组，由策略决定使用其中哪个上游。"}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] items-start gap-6 overflow-y-auto px-4 pb-1">
          <div className="flex flex-col gap-4">
            <FormItem label="名称" htmlFor="group-name">
              <Input id="group-name" autoFocus={mode.kind !== "edit"} value={name} onChange={(e) => setName(e.target.value)} />
            </FormItem>
            <div className="flex flex-col gap-1.5">
              <span className="tw-body font-medium">策略</span>
              <div role="radiogroup" aria-label="策略" className="flex flex-col gap-3">
                {STRATEGIES.map((s) => (
                  <RadioRow
                    key={s.id}
                    checked={kind === s.id}
                    title={groupKindLabel(s.id)}
                    desc={
                      s.id === "url-test" ? (
                        <>
                          {s.desc}
                          <Badge variant="warning" className="ml-1.5 align-middle">
                            影响 prompt cache
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
                  会话粘滞
                </label>
                <Note tone={sticky ? "muted" : "warning"}>
                  {sticky
                    ? "同一会话固定使用同一上游，prompt cache 保持命中。"
                    : "长会话的 prompt cache 将频繁失效，费用上升。"}
                </Note>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="tw-body font-medium">成员</span>
              <span className="tw-label text-muted-foreground">已选 {chosen.length} 个</span>
            </div>
            {ov.providers.length === 0 ? (
              <Note>尚无上游。</Note>
            ) : (
              <Boxed>
                <table className="w-full tw-body">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="w-7" />
                      <th className="w-7" />
                      <th className="py-2 font-medium">上游</th>
                      {kind === "select" && <th className="w-20 pr-3 text-center font-medium">优先使用</th>}
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
                          <td className="pl-2 text-muted-foreground/60" aria-label={`拖动调整 ${n} 的位置`} {...reorder.handle(i)}>
                            <GripVerticalIcon className="size-3.5" />
                          </td>
                          <td>
                            <Checkbox
                              aria-label={`${on ? "移出" : "加入"} ${n}`}
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
                                {p.disabled && " · 已停用"}
                              </div>
                            )}
                          </td>
                          {kind === "select" && (
                            <td className="pr-3 text-center">
                              {on && (
                                <input
                                  type="radio"
                                  name="group-preferred"
                                  aria-label={`优先使用 ${n}`}
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
                ? "拖动调整顺序。选定的上游不可用时，按顺序使用其余成员。"
                : kind === "fallback"
                  ? "拖动调整顺序：依次使用，前一个不可用时使用下一个。"
                  : "拖动调整顺序。排序依据相同时按此顺序。"}
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
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving || missing != null}>
            {saving && <Spinner />}
            {mode.kind === "edit" ? "保存" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
