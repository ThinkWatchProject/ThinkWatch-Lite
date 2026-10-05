import { useState } from "react";
import { GripVerticalIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
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
import { IconServer } from "@/ui/icons";
import { Input } from "@/ui/input";
import { Segmented } from "@/ui/segmented";
import { EmptyState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { BALANCE_BY, balanceByLabel, groupKindLabel } from "@/labels";
import type { BalanceBy, GroupKind, Overview } from "@/types";
import { billingLabel, protocolLabel } from "@/upstreams/labels";
import { FormItem, Note } from "@/upstreams/parts";
import { api } from "./api";
import { onOpenFocus } from "./fields";
import { groupDialogText } from "./GroupDialog.i18n";
import { groupRefs } from "./GroupTable";
import { move, parseWeight, strategies } from "./model";
import { TargetIcon, upstreamState } from "./parts";
import { routingText } from "./routing.i18n";
import { useReorder } from "./useReorder";

export type GroupDialogMode =
  | { kind: "create" }
  | { kind: "edit"; name: string }
  | { kind: "duplicate"; from: string };

/**
 * 新建、编辑、复制策略组。
 *
 * 从上往下：名称、策略（几个里选一个，下面一句说它怎么选）、成员。成员的先后在
 * 「按顺序」「手动选择」里就是优先级，所以可以拖动；手动选择还要在已选成员里定
 * 一个优先使用的（行尾的「设为优先」）。
 *
 * 轮询多两样：分配依据（只看比例，或者再看速度、稳定性），和每个成员的权重（行尾，
 * 1 到 100，没改过的明写 1）。别的策略不用它们，切走再切回来时还在，只是不交。
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
  /** 概览里的配置版本。**只取打开那一刻的**：保存时带它，开着的时候别处改过就是冲突 */
  configVersion: string;
  onClose: () => void;
  /** 保存成功。`version`：写完之后的配置版本（从规则里新建时，路由对话框接着用它） */
  onSaved: (name: string, version: string) => void;
}) {
  const t = useText(groupDialogText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  // 表单按打开时的概览填，保存时带的也是那一版（见 RouteDialog 的 `base`）
  const [base] = useState(configVersion);
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
  const [balanceBy, setBalanceBy] = useState<BalanceBy>(source?.balance_by ?? "weights");
  // 填的是文字：清空、打错的那一下也要留着让人改，交的时候才换成数
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(source?.weights ?? {}).map(([n, w]) => [n, String(w)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reorder = useReorder((from, to) => setOrder((o) => move(o, from, to)));

  const chosen = order.filter((n) => members.includes(n));
  const balanced = kind === "load-balance";
  const weightText = (n: string) => weights[n] ?? "1";
  const badWeight = balanced ? chosen.find((n) => parseWeight(weightText(n)) == null) : undefined;
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
          : badWeight !== undefined
            ? t.weightInvalid(badWeight)
            : null;
  const strategy = strategies().find((s) => s.id === kind);

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
          // 不交 = 都是 1、只看比例；别的策略只能这样
          weights: balanced ? Object.fromEntries(chosen.map((n) => [n, parseWeight(weightText(n)) ?? 1])) : null,
          balance_by: balanced ? balanceBy : null,
        },
        base_version: base,
      };
      const w = mode.kind === "edit" ? await api.updateGroup(mode.name, save) : await api.createGroup(save);
      onSaved(trimmed, w.version);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }

  const title =
    mode.kind === "edit" ? t.editTitle(mode.name) : mode.kind === "duplicate" ? t.duplicateTitle : rt.newGroup;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[640px]"
        onOpenAutoFocus={(e) => onOpenFocus(e, mode.kind === "edit")}
      >
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>{refs.length > 0 ? t.referencedBy(refs) : t.intro}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-1">
          <FormItem label={rt.name} htmlFor="group-name" className="max-w-[280px]">
            <Input
              id="group-name"
              autoFocus={mode.kind !== "edit"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormItem>

          <div className="flex flex-col gap-1.5">
            <span className="tw-body font-medium">{rt.strategy}</span>
            <Segmented<GroupKind>
              label={rt.strategy}
              value={kind}
              onChange={setKind}
              options={strategies().map((s) => ({ id: s.id, label: groupKindLabel(s.id) }))}
            />
            <p key={kind} className="flex flex-wrap items-center gap-x-1.5 tw-label text-muted-foreground motion-fade">
              {strategy?.desc}
            </p>
          </div>

          {balanced && (
            <div className="flex flex-col gap-1.5">
              <span className="tw-body font-medium">{t.balanceBy}</span>
              <Segmented<BalanceBy>
                label={t.balanceBy}
                value={balanceBy}
                onChange={setBalanceBy}
                options={BALANCE_BY.map((b) => ({ id: b, label: balanceByLabel(b) }))}
              />
              <p key={balanceBy} className="tw-label text-muted-foreground motion-fade">
                {t.balanceDesc[balanceBy]}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="tw-body font-medium">{rt.members}</span>
              <span className="tw-label text-muted-foreground">{t.selectedCount(chosen.length)}</span>
            </div>
            {ov.providers.length === 0 ? (
              <EmptyState variant="outlined" icon={<IconServer />} title={t.noUpstreams} />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-surface/60 hover:bg-surface/60">
                      <TableHead className="w-7 px-0" />
                      <TableHead className="w-7 px-0" />
                      <TableHead>{t.upstream}</TableHead>
                      {kind === "select" && <TableHead className="w-28 text-right">{t.preferred}</TableHead>}
                      {balanced && <TableHead className="w-24 text-right">{t.weight}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.map((n, i) => {
                      const p = ov.providers.find((x) => x.name === n);
                      const on = members.includes(n);
                      const mark = reorder.marker(i, order.length);
                      const s = upstreamState(p);
                      const id = `group-member-${i}`;
                      return (
                        <TableRow
                          key={n}
                          data-reorder-row={i}
                          className={cn(
                            "group/member hover:bg-muted/40",
                            reorder.dragging === i && "opacity-50",
                            mark === "before" && "shadow-[inset_0_2px_0_var(--color-foreground)]",
                            mark === "after" && "shadow-[inset_0_-2px_0_var(--color-foreground)]",
                          )}
                        >
                          <TableCell
                            className="px-0 pl-2 text-muted-foreground/60"
                            aria-label={t.dragMember(n)}
                            {...reorder.handle(i)}
                          >
                            <GripVerticalIcon className="size-3.5" />
                          </TableCell>
                          <TableCell className="px-0">
                            <Checkbox
                              id={id}
                              aria-label={t.toggleMember(on, n)}
                              checked={on}
                              onCheckedChange={(v) =>
                                setMembers((m) => (v === true ? [...m, n] : m.filter((x) => x !== n)))
                              }
                            />
                          </TableCell>
                          <TableCell className="py-1.5">
                            <label htmlFor={id} className="flex min-w-0 cursor-pointer items-center gap-2">
                              <TargetIcon name={n} providers={ov.providers} size={16} />
                              <span className="min-w-0">
                                <span
                                  className={cn(
                                    "flex items-center gap-1.5",
                                    on ? "font-medium" : "text-muted-foreground",
                                  )}
                                >
                                  <span className="truncate">{n}</span>
                                  {s && <StatusDot tone={s.tone} label={s.label} />}
                                </span>
                                {p && (
                                  <span className="block tw-label text-muted-foreground">
                                    {protocolLabel(p.protocol)} · {billingLabel(p.billing)}
                                    {p.disabled && t.disabledSuffix}
                                  </span>
                                )}
                              </span>
                            </label>
                          </TableCell>
                          {kind === "select" && (
                            <TableCell className="text-right">
                              {on &&
                                (preferred === n ? (
                                  <Badge variant="secondary">{t.preferred}</Badge>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    className="text-muted-foreground opacity-0 transition-opacity group-hover/member:opacity-100 focus-visible:opacity-100"
                                    onClick={() => setSelected(n)}
                                  >
                                    {t.setPreferred}
                                  </Button>
                                ))}
                            </TableCell>
                          )}
                          {balanced && (
                            <TableCell className="py-1 text-right">
                              {on && (
                                <Input
                                  aria-label={t.weightOf(n)}
                                  className="ml-auto w-16 text-right font-mono"
                                  inputMode="numeric"
                                  value={weightText(n)}
                                  aria-invalid={parseWeight(weightText(n)) == null || undefined}
                                  onChange={(e) => setWeights((w) => ({ ...w, [n]: e.target.value }))}
                                />
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <Note>
              {kind === "select"
                ? t.orderSelect
                : kind === "fallback"
                  ? t.orderFallback
                  : balanced
                    ? t.orderBalance
                    : t.orderOther}
            </Note>
          </div>
        </div>

        <Banner layout="inline" tone="error" show={error !== null}>
          {error !== null && errorText(error)}
        </Banner>

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            {ct.cancel}
          </Button>
          <Button onClick={() => void save()} pending={saving} disabled={missing != null}>
            {mode.kind === "edit" ? ct.save : rt.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
