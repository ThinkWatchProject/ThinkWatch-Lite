import { useMemo, useState } from "react";
import { CircleAlertIcon, FlaskConicalIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Badge } from "@/ui/badge";
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
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { ALL_UPSTREAMS, conditionText, targetLabel } from "@/labels";
import type { KnownModel, Overview, RouteInput } from "@/types";
import { errorText } from "@/upstreams/labels";
import { Boxed, FormItem, NameChips } from "@/upstreams/parts";
import { api } from "./api";
import { ToggleChips } from "./fields";
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
import { routeDialogText } from "./RouteDialog.i18n";
import { routingText } from "./routing.i18n";
import { RuleDialog } from "./RuleDialog";
import { useReorder } from "./useReorder";

export type RouteDialogMode =
  | { kind: "create" }
  | { kind: "edit"; name: string }
  | { kind: "duplicate"; from: string };

/** 正在编辑的规则：`index` 为空是新加的，放在 `at` */
type Editing = null | { index: number | null; at: number; draft: RuleDraft };

/**
 * 新建、编辑、复制路由。
 *
 * **一次保存就是整条路由**：名称、使用它的密钥、规则的顺序，一个配置版本。
 * 取消不写入任何东西。规则在嵌套的规则对话框里编辑，那边的「保存」只改
 * 这里的草稿。
 */
export function RouteDialog({
  mode,
  ov,
  models,
  configVersion,
  onChanged,
  onClose,
  onSaved,
  onDryRun,
}: {
  mode: RouteDialogMode;
  ov: Overview;
  models: KnownModel[];
  configVersion: string | null;
  onChanged: () => void;
  onClose: () => void;
  onSaved: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const reorder = useReorder((from, to) => setRules((r) => move(r, from, to)));

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
        base_version: configVersion ?? undefined,
        // 默认路由的使用者是「没指定路由的密钥」，这里不改
        keys: isDefault ? undefined : keys,
        route_probes: probes,
      };
      if (mode.kind === "edit") await api.updateRoute(mode.name, save);
      else await api.createRoute(save);
      onSaved();
    } catch (e) {
      setError(errorText(e));
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

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>{t.intro}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-1">
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
                  <NameChips names={original} empty={t.allAssigned} />
                </div>
              </FormItem>
            ) : (
              <FormItem
                label={t.keys}
                desc={joining.length || leaving.length ? t.keyMoves(joining, leaving) : undefined}
              >
                <div className="flex min-h-8 items-center">
                  <ToggleChips
                    options={ov.clients.map((c) => ({
                      id: c.name,
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
              <span className="tw-body font-medium">{t.rules}</span>
              <span className="tw-label tabular-nums text-muted-foreground">{rules.length}</span>
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

            <Boxed>
              <table className="w-full table-fixed tw-body">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="w-7" />
                    <th className="w-6 font-medium">#</th>
                    <th className="w-40 py-2 font-medium">{t.rule}</th>
                    <th className="font-medium">{t.conditions}</th>
                    <th className="w-60 font-medium">{t.onMatch}</th>
                    <th className="w-9" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => {
                    const n = notes[i]!;
                    const mark = reorder.marker(i, rules.length);
                    const items = rowMenu(i);
                    return (
                      <RowMenu key={r.key} items={items}>
                        <tr
                          data-reorder-row={i}
                          onDoubleClick={() => setEditing({ index: i, at: i, draft: r })}
                          className={cn(
                            "cursor-default border-b border-border last:border-b-0 hover:bg-muted/40",
                            reorder.dragging === i && "opacity-50",
                            mark === "before" && "shadow-[inset_0_2px_0_var(--color-foreground)]",
                            mark === "after" && "shadow-[inset_0_-2px_0_var(--color-foreground)]",
                          )}
                        >
                          <td
                            className="pl-2 text-muted-foreground/60"
                            aria-label={t.dragRule(r.name)}
                            {...reorder.handle(i)}
                          >
                            <GripVerticalIcon className="size-3.5" />
                          </td>
                          <td className="tabular-nums text-muted-foreground">{i + 1}</td>
                          <td className="py-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate font-medium">{r.name}</span>
                              {n.shadowed && <Badge variant="warning">{t.noEffect}</Badge>}
                              {n.phaseTwo && <Badge variant="outline">{t.phaseTwo}</Badge>}
                            </div>
                          </td>
                          <td className="truncate pr-3" title={conditionsText(r)}>
                            {r.conditions.length === 0 ? (
                              <span className="text-muted-foreground">{rt.allRequests}</span>
                            ) : (
                              conditionsText(r)
                            )}
                          </td>
                          <td className="py-2 pr-2">
                            <Action r={r} ov={ov} />
                          </td>
                          <td className="text-right">
                            <RowMenuButton items={items} label={t.ruleActions(r.name)} />
                          </td>
                        </tr>
                      </RowMenu>
                    );
                  })}
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-muted-foreground">
                        {t.noRules}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Boxed>

            {shadowed.length > 0 && (
              <div className="flex items-center gap-2 tw-label text-warning">
                <CircleAlertIcon className="size-3.5 shrink-0" />
                <span>{t.shadowed(shadowed.map((r) => r.name))}</span>
                <Button variant="link" size="xs" className="h-auto p-0" onClick={() => setRules(liftShadowed)}>
                  {t.liftShadowed}
                </Button>
              </div>
            )}
            {!hasCatchAll(rules) && (
              <div className="flex items-center gap-2 tw-label text-warning">
                <CircleAlertIcon className="size-3.5 shrink-0" />
                <span>{t.noCatchAll}</span>
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto p-0"
                  onClick={() => add(rules.length, { name: uniqueName(t.catchAllName, rules) })}
                >
                  {t.addCatchAll}
                </Button>
              </div>
            )}
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
        <div className="text-destructive">{rt.deny}</div>
        <div className="truncate tw-label text-muted-foreground" title={r.deny}>
          {r.deny}
        </div>
      </div>
    );
  }
  if (r.action === "continue") {
    return (
      <div className="min-w-0">
        <div className="text-muted-foreground">{rt.continueMatching}</div>
        <div className="truncate tw-label text-muted-foreground" title={addOns}>
          {addOns}
        </div>
      </div>
    );
  }
  const sub = [describeTarget(r.to, ov.groups, ov.providers), addOns].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <span className="text-muted-foreground">→</span>
        <span className="truncate font-medium">{targetLabel(r.to)}</span>
      </div>
      <div className="truncate tw-label text-muted-foreground" title={sub}>
        {sub}
      </div>
    </div>
  );
}

/** `兜底`、`兜底 2`：同一条路由里规则名不能重复 */
function uniqueName(base: string, rules: RuleDraft[]): string {
  const taken = new Set(rules.map((r) => r.name.trim()));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
