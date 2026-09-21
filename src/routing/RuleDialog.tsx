import { useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Field, FieldLabel } from "@/ui/field";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/ui/native-select";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { PROBES, conditionName, formatLabel, probeLabel, targetLabel } from "@/labels";
import type { ConditionView, KnownModel, Overview } from "@/types";
import { globMatch } from "@/upstreams/glob";
import { FormItem, Note, Segmented } from "@/upstreams/parts";
import { GroupDialog } from "./GroupDialog";
import { ModelInput, ToggleChips } from "./fields";
import {
  COND_FIELDS,
  DIALECTS,
  PROBE_IDS,
  addOnsText,
  blankCondition,
  compareOps,
  condField,
  condGroupLabel,
  describeTarget,
  isPhaseTwo,
  ruleProblem,
  splitCompare,
  type Action,
  type RuleDraft,
} from "./model";
import { routingText } from "./routing.i18n";
import { ruleDialogText } from "./RuleDialog.i18n";

/** 目标下拉里「新建策略组…」那一项的值。只活在这个下拉里，不会写进配置 */
const NEW_GROUP = "::new-group";

/**
 * 添加与编辑一条规则。
 *
 * **按读规则的顺序排**：条件（什么样的请求）→ 命中后（转发、拒绝，或继续
 * 匹配）→ 附加项（改写参数、安全要求）。保存只更新路由对话框里的草稿，
 * 路由对话框保存时才写入配置。
 */
export function RuleDialog({
  initial,
  create,
  routeName,
  position,
  takenNames,
  ov,
  models,
  configVersion,
  onChanged,
  onClose,
  onSave,
}: {
  initial: RuleDraft;
  create: boolean;
  routeName: string;
  /** 第几条，从 1 开始 */
  position: number;
  /** 同一条路由里其余规则的名字 */
  takenNames: string[];
  ov: Overview;
  models: KnownModel[];
  configVersion: string | null;
  /** 在这里新建了策略组：外面要重读概览 */
  onChanged: () => void;
  onClose: () => void;
  /** `routeProbes`：保存路由时一并设为「交给路由」的辅助请求类别 */
  onSave: (rule: RuleDraft, routeProbes: string[]) => void;
}) {
  const t = useText(ruleDialogText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const [d, setD] = useState<RuleDraft>(initial);
  const set = (patch: Partial<RuleDraft>) => setD((x) => ({ ...x, ...patch }));
  const [rewriteOpen, setRewriteOpen] = useState(
    () => initial.model !== "" || initial.maxTokens !== "" || initial.thinking !== "keep",
  );
  const [routeProbes, setRouteProbes] = useState<boolean | null>(null);
  const [newGroup, setNewGroup] = useState(false);

  const modelIds = useMemo(() => models.map((m) => m.id), [models]);
  const phaseTwo = isPhaseTwo(d);
  const problem = ruleProblem(d, takenNames);

  // 辅助请求条件里还没交给路由的类别：不交给路由，这个条件永远不满足
  const intent = d.conditions.find((c) => c.field === "intent");
  const anyProbe = intent?.values.includes("assistant_internal") ?? false;
  const unrouted = (anyProbe ? PROBE_IDS : (intent?.values ?? [])).filter(
    (id) => (ov.client_probes ?? []).find((p) => p.id === id)?.mode !== "route",
  );
  // 「任一辅助请求」时不默认勾选：连通性检查和预热原本由网关本地应答，改为交给路由会产生费用
  const routing = routeProbes ?? !anyProbe;

  const rewriteSummary = addOnsText(d);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{create ? rt.addRule : t.editTitle(initial.name)}</DialogTitle>
          <DialogDescription>{t.position(routeName, position)}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-1">
          <FormItem label={rt.name} htmlFor="rule-name">
            <Input
              id="rule-name"
              autoFocus={create}
              value={d.name}
              placeholder={t.namePlaceholder}
              onChange={(e) => set({ name: e.target.value })}
            />
          </FormItem>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="tw-body font-medium">{t.conditions}</span>
              {d.conditions.length > 1 && (
                <span className="tw-label text-muted-foreground">{t.allOf}</span>
              )}
            </div>
            <div className="flex flex-col gap-2.5 rounded-lg border border-border p-2.5">
              {d.conditions.length === 0 && (
                <p className="tw-body text-muted-foreground">{rt.allRequests}</p>
              )}
              {d.conditions.map((c, i) => (
                <ConditionRow
                  key={c.field}
                  c={c}
                  ov={ov}
                  models={modelIds}
                  onChange={(nc) => set({ conditions: d.conditions.map((x, j) => (j === i ? nc : x)) })}
                  onRemove={() => set({ conditions: d.conditions.filter((_, j) => j !== i) })}
                />
              ))}
              {unrouted.length > 0 && (
                <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-2">
                  <Note tone="warning">{t.unrouted(unrouted.map(probeLabel))}</Note>
                  <Field orientation="horizontal" className="w-auto">
                    <Checkbox
                      id="rule-route-probes"
                      checked={routing}
                      onCheckedChange={(v) => setRouteProbes(v === true)}
                    />
                    <FieldLabel htmlFor="rule-route-probes">{t.routeProbes}</FieldLabel>
                  </Field>
                </div>
              )}
              <AddCondition
                used={d.conditions.map((c) => c.field)}
                onAdd={(id) => set({ conditions: [...d.conditions, blankCondition(id)] })}
              />
            </div>
          </div>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
            <FormItem label={t.onMatch}>
              <Segmented<Action>
                value={d.action}
                onChange={(a) => set({ action: a })}
                options={[
                  { id: "forward", label: t.forward, disabled: phaseTwo },
                  { id: "deny", label: rt.deny },
                  { id: "continue", label: rt.continueMatching },
                ]}
              />
            </FormItem>
            {d.action === "forward" && (
              <FormItem
                label={t.forwardTo}
                htmlFor="rule-to"
                desc={d.to ? describeTarget(d.to, ov.groups, ov.providers) : undefined}
              >
                <NativeSelect
                  id="rule-to"
                  className="w-full"
                  value={d.to}
                  onChange={(e) =>
                    e.target.value === NEW_GROUP ? setNewGroup(true) : set({ to: e.target.value })
                  }
                >
                  {!d.to && <NativeSelectOption value="">{t.chooseTarget}</NativeSelectOption>}
                  <NativeSelectOptGroup label={t.groups}>
                    {ov.groups.map((g) => (
                      <NativeSelectOption key={g.name} value={g.name}>
                        {targetLabel(g.name)}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value={NEW_GROUP}>{t.newGroupMenu}</NativeSelectOption>
                  </NativeSelectOptGroup>
                  <NativeSelectOptGroup label={t.upstreams}>
                    {ov.providers.map((p) => (
                      <NativeSelectOption key={p.name} value={p.name}>
                        {p.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                </NativeSelect>
              </FormItem>
            )}
            {d.action === "deny" && (
              <FormItem label={t.denyReason} htmlFor="rule-deny" desc={t.denyReasonDesc}>
                <Input
                  id="rule-deny"
                  value={d.deny}
                  placeholder={t.denyPlaceholder}
                  onChange={(e) => set({ deny: e.target.value })}
                />
              </FormItem>
            )}
            {d.action === "continue" && (
              <p className="self-end pb-1.5 tw-label text-muted-foreground">{t.continueDesc}</p>
            )}
          </div>
          {phaseTwo && <Note>{t.phaseTwo}</Note>}

          {d.action !== "deny" && (
            <div className="flex flex-col">
              <Section
                title={t.rewrite}
                summary={rewriteSummary || t.notSet}
                open={rewriteOpen}
                onToggle={() => setRewriteOpen((o) => !o)}
              >
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-start gap-3">
                  <FormItem label={t.setModel} htmlFor="rw-model">
                    <ModelInput
                      id="rw-model"
                      value={d.model}
                      onChange={(v) => set({ model: v })}
                      models={modelIds}
                      placeholder={t.unchanged}
                    />
                  </FormItem>
                  <FormItem label="max_tokens" htmlFor="rw-max">
                    <Input
                      id="rw-max"
                      className="font-mono"
                      inputMode="numeric"
                      placeholder={t.unchanged}
                      value={d.maxTokens}
                      onChange={(e) => set({ maxTokens: e.target.value })}
                    />
                  </FormItem>
                  <FormItem label={t.thinking}>
                    <Segmented<RuleDraft["thinking"]>
                      value={d.thinking}
                      onChange={(v) => set({ thinking: v })}
                      options={[
                        { id: "keep", label: t.unchanged },
                        { id: "on", label: t.on },
                        { id: "off", label: t.off },
                      ]}
                    />
                  </FormItem>
                </div>
                {d.model.trim() && <Note>{t.modelChangeNote}</Note>}
              </Section>
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          {problem && <span className="mr-auto tw-label text-muted-foreground">{problem}</span>}
          <Button variant="outline" onClick={onClose}>
            {ct.cancel}
          </Button>
          <Button disabled={problem != null} onClick={() => onSave(d, routing ? unrouted : [])}>
            {create ? t.add : ct.save}
          </Button>
        </DialogFooter>

        {newGroup && (
          <GroupDialog
            mode={{ kind: "create" }}
            ov={ov}
            configVersion={configVersion}
            onClose={() => setNewGroup(false)}
            onSaved={(name) => {
              setNewGroup(false);
              set({ to: name });
              onChanged();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 附加项的一节：标题一行可以展开，收起时显示已设置的摘要 */
function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 tw-body"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRightIcon className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-medium">{title}</span>
        <span className="flex-1" />
        {!open && <span className="truncate tw-label text-muted-foreground">{summary}</span>}
      </button>
      {open && <div className="flex flex-col gap-3 pb-3 pl-5.5">{children}</div>}
    </div>
  );
}

/** 「添加条件」：按请求、特征、来源、上游分组，已有的不再列出 */
function AddCondition({ used, onAdd }: { used: string[]; onAdd: (field: string) => void }) {
  const t = useText(ruleDialogText);
  const left = COND_FIELDS.filter((f) => !used.includes(f.id));
  if (left.length === 0) return null;
  const groups = [...new Set(left.map((f) => f.group))];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground">
          <PlusIcon />
          {t.addCondition}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {groups.map((g, i) => (
          <div key={g}>
            {i > 0 && <DropdownMenuSeparator />}
            <div className="px-1.5 pt-1 pb-0.5 tw-label text-muted-foreground">{condGroupLabel(g)}</div>
            {left
              .filter((f) => f.group === g)
              .map((f) => (
                <DropdownMenuItem key={f.id} onSelect={() => onAdd(f.id)}>
                  {conditionName(f.id)}
                </DropdownMenuItem>
              ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 一个条件：名称、取值控件、删除。**控件随条件的类型变**，不是一个通用输入框 */
function ConditionRow({
  c,
  ov,
  models,
  onChange,
  onRemove,
}: {
  c: ConditionView;
  ov: Overview;
  models: string[];
  onChange: (c: ConditionView) => void;
  onRemove: () => void;
}) {
  const t = useText(ruleDialogText);
  const f = condField(c.field);
  const name = conditionName(c.field);
  const v0 = c.values[0] ?? "";
  let control: ReactNode;
  let hint: string | null = null;
  switch (f.kind) {
    case "glob": {
      control = (
        <ModelInput
          value={v0}
          onChange={(v) => onChange({ ...c, values: [v] })}
          models={models}
          placeholder={t.globPlaceholder}
        />
      );
      if (v0.trim() && models.length > 0) {
        const n = models.filter((m) => globMatch(v0.trim(), m)).length;
        hint = n > 0 ? t.globMatches(n) : t.globNone;
      }
      break;
    }
    case "compare": {
      const [op, amount] = splitCompare(v0);
      control = (
        <>
          <NativeSelect
            aria-label={t.compareOp(name)}
            value={op}
            onChange={(e) => onChange({ ...c, values: [`${e.target.value}${amount}`] })}
          >
            {compareOps().map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label={t.compareAmount(name)}
            className="w-28 font-mono"
            placeholder="200k"
            value={amount}
            onChange={(e) => onChange({ ...c, values: [`${op}${e.target.value}`] })}
          />
        </>
      );
      break;
    }
    case "flag":
      control = (
        <Segmented<string>
          value={v0 === "false" ? "false" : "true"}
          onChange={(v) => onChange({ ...c, values: [v] })}
          options={[
            { id: "true", label: t.yes },
            { id: "false", label: t.no },
          ]}
        />
      );
      break;
    case "one":
      control =
        c.field === "dialect" ? (
          <NativeSelect aria-label={name} value={v0} onChange={(e) => onChange({ ...c, values: [e.target.value] })}>
            {DIALECTS.map((d) => (
              <NativeSelectOption key={d} value={d}>
                {formatLabel(d)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <NativeSelect aria-label={name} value={v0} onChange={(e) => onChange({ ...c, values: [e.target.value] })}>
            {!v0 && <NativeSelectOption value="">{t.chooseKey}</NativeSelectOption>}
            {ov.clients.map((k) => (
              <NativeSelectOption key={k.name} value={k.name}>
                {k.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        );
      break;
    case "many":
      control =
        c.field === "intent" ? (
          <ToggleChips
            mono={false}
            options={[
              { id: "assistant_internal", label: t.anyProbe },
              ...PROBES.map((p) => ({ id: p.id, label: p.label })),
            ]}
            value={c.values}
            onChange={(u) => onChange({ ...c, values: u(c.values) })}
          />
        ) : (
          <ToggleChips
            options={ov.providers.map((p) => ({ id: p.name }))}
            value={c.values}
            onChange={(u) => onChange({ ...c, values: u(c.values) })}
          />
        );
      break;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <span className="w-24 shrink-0 pt-1.5 tw-body text-muted-foreground">{name}</span>
        <div className={cn("flex min-w-0 flex-1 flex-wrap items-center gap-2", f.kind === "many" && "pt-1")}>
          {control}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={t.removeCondition(name)}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      {hint && <p className="pl-26 tw-label text-muted-foreground">{hint}</p>}
    </div>
  );
}
