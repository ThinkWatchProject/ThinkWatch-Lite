import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { FlaskConicalIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Count } from "@/ui/count";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { IconDenied } from "@/ui/icons";
import { Input } from "@/ui/input";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { ALL_UPSTREAMS, conditionText, targetLabel } from "@/labels";
import type { KnownModel, Overview, RouteInput } from "@/types";
import { FormItem } from "@/upstreams/parts";
import { api } from "./api";
import { ToggleChips, onOpenFocus } from "./fields";
import {
  addOnsText,
  blankRule,
  copyDraft,
  describeTarget,
  draftFromView,
  draftNotes,
  draftToInput,
  hasCatchAll,
  insertIndex,
  liftShadowed,
  move,
  usersOf,
  type RuleDraft,
} from "./model";
import { KeyChips, KeyIcon, TargetIcon } from "./parts";
import { routeDialogText } from "./RouteDialog.i18n";
import { routingText } from "./routing.i18n";
import { RuleDialog } from "./RuleDialog";
import { useReorder } from "./useReorder";
import { hitsOfRoute, hitsOfRule, type HitSpan, type RouteHitsWindow } from "./useRouteHits";

export type RouteDialogMode =
  | { kind: "create" }
  | { kind: "edit"; name: string }
  | { kind: "duplicate"; from: string };

/** 正在编辑的规则：`index` 为空是新加的，放在 `at` */
type Editing = null | { index: number | null; at: number; draft: RuleDraft };

/** 行尾菜单按钮、拖动把手在行里：点它们不该再冒泡成「打开这条规则」 */
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

/**
 * 新建、编辑、复制路由。
 *
 * **一次保存就是整条路由**：名称、使用它的密钥、规则的顺序，一个配置版本。
 * 取消不写入任何东西。规则在嵌套的规则对话框里编辑（单击一行打开），那边的
 * 「保存」只改这里的草稿。
 *
 * 编辑时每条规则名下写着它最近几天命中了多少（只附加改写的、选定上游之后才判断的
 * 也算），哪条用不上了一眼看得出。
 */
export function RouteDialog({
  mode,
  ov,
  models,
  hits,
  configVersion,
  onChanged,
  onClose,
  onSaved,
  onDryRun,
}: {
  mode: RouteDialogMode;
  ov: Overview;
  models: KnownModel[];
  /** 最近一段时间的命中数（`useRouteHits`） */
  hits: RouteHitsWindow;
  configVersion: string;
  onChanged: () => void;
  onClose: () => void;
  /** 保存成功，带着保存后的名字 */
  onSaved: (name: string) => void;
  /** 按对话框里还没保存的内容试算 */
  onDryRun: (draft: RouteInput, keys: string[]) => void;
}) {
  const t = useText(routeDialogText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const source =
    mode.kind === "edit"
      ? ov.routes.find((r) => r.name === mode.name)
      : mode.kind === "duplicate"
        ? ov.routes.find((r) => r.name === mode.from)
        : undefined;
  const isDefault = mode.kind === "edit" && !!source?.default;
  // 只有已保存的路由有命中数；这段时间整条路由都没有请求、一条请求记录都没有时不逐条写
  // 「未命中」（同路由列表）
  const span = hits.state === "counted" ? hits.span : null;
  const routeHits = mode.kind === "edit" && hits.state === "counted" ? hitsOfRoute(hits.routes, mode.name) : null;
  const original = mode.kind === "edit" && source ? usersOf(source, ov.clients) : [];

  const [name, setName] = useState(
    mode.kind === "edit" ? mode.name : mode.kind === "duplicate" ? rt.copyName(mode.from) : "",
  );
  const [keys, setKeys] = useState<string[]>(
    mode.kind === "edit" && source ? ov.clients.filter((c) => c.route === source.name).map((c) => c.name) : [],
  );
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    source ? source.rules.map(draftFromView) : [{ ...blankRule(ALL_UPSTREAMS), name: t.catchAllName }],
  );
  const [probes, setProbes] = useState<string[]>([]);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const reorder = useReorder((from, to) => setRules((r) => move(r, from, to)));
  const shown = usePresentList(rules, (r) => r.key);

  const notes = useMemo(() => draftNotes(rules), [rules]);
  const shadowed = rules.filter((_, i) => notes[i]!.shadowed);
  const trimmed = name.trim();
  const takenByOther = ov.routes.some(
    (r) => r.name === trimmed && !(mode.kind === "edit" && r.name === mode.name),
  );
  const missing = !trimmed
    ? rt.nameMissing
    : trimmed.startsWith("__")
      ? rt.nameReserved
      : takenByOther
        ? rt.nameTaken(trimmed)
        : null;

  // 保存之后密钥的去向变化，说在字段下面
  const joining = keys.filter(
    (k) => mode.kind !== "edit" || ov.clients.find((c) => c.name === k)?.route !== mode.name,
  );
  const leaving =
    mode.kind === "edit" && !isDefault ? original.filter((k) => !keys.includes(k)) : [];

  function input(): RouteInput {
    return { name: trimmed, rules: rules.map(draftToInput) };
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const save = {
        route: input(),
        base_version: configVersion,
        // 默认路由的使用者是「没指定路由的密钥」，这里不改
        keys: isDefault ? undefined : keys,
        route_probes: probes,
      };
      if (mode.kind === "edit") await api.updateRoute(mode.name, save);
      else await api.createRoute(save);
      onSaved(trimmed);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }

  function add(at: number, prefill?: Partial<RuleDraft>) {
    setEditing({ index: null, at, draft: { ...blankRule(), ...prefill } });
  }

  function rowMenu(i: number): MenuItems {
    return [
      { kind: "item", label: rt.editMenu, onSelect: () => setEditing({ index: i, at: i, draft: rules[i]! }) },
      { kind: "item", label: t.insertAbove, onSelect: () => add(i) },
      {
        kind: "item",
        label: t.duplicate,
        onSelect: () =>
          setRules((r) => {
            const c = { ...copyDraft(r[i]!), name: uniqueName(rt.copyName(r[i]!.name), r) };
            return [...r.slice(0, i + 1), c, ...r.slice(i + 1)];
          }),
      },
      { kind: "sep" },
      { kind: "item", label: t.moveUp, disabled: i === 0, onSelect: () => setRules((r) => move(r, i, i - 1)) },
      {
        kind: "item",
        label: t.moveDown,
        disabled: i === rules.length - 1,
        onSelect: () => setRules((r) => move(r, i, i + 1)),
      },
      { kind: "sep" },
      { kind: "item", label: ct.delete, danger: true, onSelect: () => setRules((r) => r.filter((_, j) => j !== i)) },
    ];
  }

  const title =
    mode.kind === "edit" ? t.editTitle(mode.name) : mode.kind === "duplicate" ? t.duplicateTitle : rt.newRoute;
  const keyViews = (names: string[]) => ov.clients.filter((c) => names.includes(c.name));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[860px]"
        onOpenAutoFocus={(e) => onOpenFocus(e, mode.kind === "edit")}
      >
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>{t.intro}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-1">
          <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-4">
            <FormItem label={rt.name} htmlFor="route-name">
              <Input
                id="route-name"
                autoFocus={mode.kind !== "edit"}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </FormItem>
            {isDefault ? (
              <FormItem label={t.keys} desc={t.defaultKeys}>
                <div className="flex min-h-8 items-center">
                  <KeyChips keys={keyViews(original)} empty={t.allAssigned} />
                </div>
              </FormItem>
            ) : (
              <FormItem
                label={t.keys}
                desc={joining.length || leaving.length ? t.keyMoves(joining, leaving) : undefined}
              >
                <div className="flex min-h-8 items-center">
                  <ToggleChips
                    label={t.keys}
                    options={ov.clients.map((c) => ({
                      id: c.name,
                      icon: <KeyIcon k={c} size={12} className="text-current" />,
                      title:
                        c.route && c.route !== source?.name
                          ? t.usesRoute(c.route)
                          : !c.route
                            ? t.usesDefault
                            : undefined,
                    }))}
                    value={keys}
                    onChange={setKeys}
                  />
                </div>
              </FormItem>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="tw-head">{t.rules}</span>
              <Count n={rules.length} />
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDryRun(input(), isDefault ? original : keys)}
              >
                <FlaskConicalIcon />
                {rt.dryRun}
              </Button>
              <Button variant="outline" size="sm" onClick={() => add(insertIndex(rules))}>
                <PlusIcon />
                {rt.addRule}
              </Button>
            </div>

            {shown.length === 0 ? (
              <EmptyState
                variant="outlined"
                title={t.noRules}
                action={
                  <Button size="sm" variant="outline" onClick={() => add(0, { name: t.catchAllName })}>
                    <PlusIcon />
                    {rt.addRule}
                  </Button>
                }
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-surface/60 hover:bg-surface/60">
                      <TableHead className="w-7 px-0" />
                      <TableHead className="w-7 px-0">#</TableHead>
                      <TableHead className="w-[26%]">{t.rule}</TableHead>
                      <TableHead>{t.conditions}</TableHead>
                      <TableHead className="w-[30%]">{t.onMatch}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map(({ item: r, key, presence }) => {
                      const i = rules.indexOf(r);
                      // 正在淡出的那一行：已经不在草稿里，不能再点、再拖
                      if (i < 0) {
                        return (
                          <TableRow key={key} className={rowMotion(presence)}>
                            <TableCell />
                            <TableCell />
                            <TableCell className="truncate py-2 font-medium">{r.name}</TableCell>
                            <TableCell colSpan={3} />
                          </TableRow>
                        );
                      }
                      const n = notes[i]!;
                      const mark = reorder.marker(i, rules.length);
                      const items = rowMenu(i);
                      const edit = () => setEditing({ index: i, at: i, draft: r });
                      return (
                        <RowMenu key={key} items={items}>
                          <TableRow
                            data-reorder-row={i}
                            tabIndex={0}
                            onClick={edit}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                              e.preventDefault();
                              edit();
                            }}
                            className={cn(
                              "cursor-pointer outline-none focus-visible:bg-muted/60",
                              rowMotion(presence),
                              reorder.dragging === i && "opacity-50",
                              mark === "before" && "shadow-[inset_0_2px_0_var(--color-foreground)]",
                              mark === "after" && "shadow-[inset_0_-2px_0_var(--color-foreground)]",
                            )}
                          >
                            <TableCell
                              className="px-0 pl-2 text-muted-foreground/60"
                              aria-label={t.dragRule(r.name)}
                              onClick={stop}
                              {...reorder.handle(i)}
                            >
                              <GripVerticalIcon className="size-3.5" />
                            </TableCell>
                            <TableCell className="px-0 tw-num text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="py-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium">{r.name}</span>
                                {n.shadowed && <Badge variant="warning">{t.noEffect}</Badge>}
                                {n.phaseTwo && <Badge variant="outline">{t.phaseTwo}</Badge>}
                              </div>
                              {span && routeHits && r.saved != null && (
                                <RuleHitsLine n={hitsOfRule(routeHits, r.saved).requests} span={span} />
                              )}
                            </TableCell>
                            <TableCell className="truncate">
                              {r.conditions.length === 0 ? (
                                <span className="text-muted-foreground">{rt.allRequests}</span>
                              ) : (
                                conditionsText(r)
                              )}
                            </TableCell>
                            <TableCell className="py-2">
                              <Action r={r} ov={ov} />
                            </TableCell>
                            <TableCell className="text-right" onClick={stop} onKeyDown={stop}>
                              <RowMenuButton items={items} label={t.ruleActions(r.name)} />
                            </TableCell>
                          </TableRow>
                        </RowMenu>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <Banner
              layout="inline"
              tone="warning"
              show={shadowed.length > 0}
              actions={
                <Button variant="outline" size="sm" onClick={() => setRules(liftShadowed)}>
                  {t.liftShadowed}
                </Button>
              }
            >
              {t.shadowed(shadowed.map((r) => r.name))}
            </Banner>
            <Banner
              layout="inline"
              tone="warning"
              show={rules.length > 0 && !hasCatchAll(rules)}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => add(rules.length, { name: uniqueName(t.catchAllName, rules) })}
                >
                  {t.addCatchAll}
                </Button>
              }
            >
              {t.noCatchAll}
            </Banner>
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

        {editing && (
          <RuleDialog
            initial={editing.draft}
            create={editing.index == null}
            routeName={trimmed || t.untitled}
            position={editing.at + 1}
            takenNames={rules.filter((_, j) => j !== editing.index).map((x) => x.name.trim())}
            ov={ov}
            models={models}
            configVersion={configVersion}
            onChanged={onChanged}
            onClose={() => setEditing(null)}
            onSave={(d, routeProbes) => {
              setRules((r) =>
                editing.index == null
                  ? [...r.slice(0, editing.at), d, ...r.slice(editing.at)]
                  : r.map((x, j) => (j === editing.index ? d : x)),
              );
              if (routeProbes.length) setProbes((p) => [...new Set([...p, ...routeProbes])]);
              setEditing(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 规则名下面那一行：最近一段时间命中了多少。一次都没命中的照样写出来 —— 这正是决定
 * 删不删、挪不挪它的时候要看的
 */
function RuleHitsLine({ n, span }: { n: number; span: HitSpan }) {
  const t = useText(routeDialogText);
  return (
    <div className="truncate tw-label tw-num text-muted-foreground">
      {n > 0 ? t.hits(span, n) : t.noHits(span)}
    </div>
  );
}

function conditionsText(r: RuleDraft): string {
  return r.conditions.map(conditionText).join(textOf(routeDialogText).conditionJoin);
}

/** 「命中后」一栏：去向（或拒绝、继续匹配），次行是去向的说明或附加项 */
function Action({ r, ov }: { r: RuleDraft; ov: Overview }) {
  const rt = useText(routingText);
  const addOns = addOnsText(r);
  if (r.action === "deny") {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-destructive">
          <IconDenied aria-hidden className="size-3.5 shrink-0" />
          {rt.deny}
        </div>
        <div className="truncate tw-label text-muted-foreground">{r.deny}</div>
      </div>
    );
  }
  if (r.action === "continue") {
    return (
      <div className="min-w-0">
        <div className="text-muted-foreground">{rt.continueMatching}</div>
        <div className="truncate tw-label text-muted-foreground">{addOns}</div>
      </div>
    );
  }
  const sub = [describeTarget(r.to, ov.groups, ov.providers), addOns].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <TargetIcon name={r.to} providers={ov.providers} size={13} />
        <span className="truncate font-medium">{targetLabel(r.to)}</span>
      </div>
      <div className="truncate tw-label text-muted-foreground">{sub}</div>
    </div>
  );
}

/** `兜底`、`兜底 2`：同一条路由里规则名不能重复 */
function uniqueName(base: string, rules: RuleDraft[]): string {
  const taken = new Set(rules.map((r) => r.name.trim()));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
