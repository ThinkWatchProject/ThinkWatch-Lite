import { useState, type ReactNode } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
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
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/ui/native-select";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { PROBES, conditionName, formatLabel, probeLabel, targetLabel } from "@/labels";
import type { ConditionField, ConditionView, Overview } from "@/types";
import { Segmented } from "@/ui/segmented";
import { FormItem, Note } from "@/upstreams/parts";
import { GroupDialog } from "./GroupDialog";
import { ModelInput, ToggleChips, onOpenFocus } from "./fields";
import { TargetIcon } from "./parts";
import {
  COND_FIELDS,
  DIALECTS,
  addOnsText,
  blankCondition,
  blankPinned,
  compareOps,
  condField,
  condGroupLabel,
  describeTarget,
  isPhaseTwo,
  isPinned,
  ruleProblem,
  splitCompare,
  type Action,
  type RuleDraft,
  type ToKind,
} from "./model";
import { PinnedModels } from "./PinnedModels";
import type { KnownModelX } from "./provisional";
import { routingText } from "./routing.i18n";
import { ruleDialogText } from "./RuleDialog.i18n";
import { modelHint, type ModelHint } from "./target";

/** 目标下拉里「新建策略组…」那一项的值。只活在这个下拉里，不会写进配置 */
const NEW_GROUP = "::new-group";

/**
 * 添加与编辑一条规则。
 *
 * **按读规则的顺序排**：条件（什么样的请求）→ 命中后（转发、拒绝，或继续
 * 匹配）→ 附加项（改写参数、安全要求）。保存只更新路由对话框里的草稿，
 * 路由对话框保存时才写入配置。
 *
 * 转发有两种去向：上游或策略组（发出的模型名按别名表对到各上游），或者指定模型（几个
 * 「上游 + 模型」按顺序备用，模型名原样发出）。指定模型时「模型改为」不出现。
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
  models: KnownModelX[];
  configVersion: string;
  /** 在这里新建了策略组：外面要重读概览，路由对话框接着用写完的版本 `version` */
  onChanged: (version: string) => void;
  onClose: () => void;
  onSave: (rule: RuleDraft) => void;
}) {
  const t = useText(ruleDialogText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const [d, setD] = useState<RuleDraft>(initial);
  const set = (patch: Partial<RuleDraft>) => setD((x) => ({ ...x, ...patch }));
  const [rewriteOpen, setRewriteOpen] = useState(
    () => initial.model !== "" || initial.maxTokens !== "" || initial.thinking !== "keep",
  );
  const [newGroup, setNewGroup] = useState(false);

  const phaseTwo = isPhaseTwo(d);
  const pinned = isPinned(d);
  const problem = ruleProblem(d, takenNames);

  /**
   * 辅助请求条件里点名的、设为本地应答的类别：它们到不了路由，这个条件对它们永远不成立。
   * 选了「任一辅助请求」就不提 —— 那是在说「转发的那几类里随便哪一类」，本地应答的连通性
   * 检查、预热本来就不在里面
   */
  const intent = d.conditions.find((c) => c.field === "intent");
  const anyProbe = intent?.values.includes("assistant_internal") ?? false;
  const intercepted = anyProbe
    ? []
    : (intent?.values ?? []).filter((id) => ov.client_probes.find((p) => p.id === id)?.mode === "intercept");

  const rewriteSummary = addOnsText(d, models);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[640px]"
        onOpenAutoFocus={(e) => onOpenFocus(e, !create)}
      >
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
                  models={models}
                  onChange={(nc) => set({ conditions: d.conditions.map((x, j) => (j === i ? nc : x)) })}
                  onRemove={() => set({ conditions: d.conditions.filter((_, j) => j !== i) })}
                />
              ))}
              <Banner
                layout="inline"
                tone="warning"
                show={intercepted.length > 0}
                title={t.intercepted(intercepted.map(probeLabel))}
              >
                {t.toForward}
              </Banner>
              <AddCondition
                used={d.conditions.map((c) => c.field)}
                onAdd={(id) => set({ conditions: [...d.conditions, blankCondition(id)] })}
              />
            </div>
          </div>

          <FormItem label={t.onMatch}>
            <Segmented<Action>
              label={t.onMatch}
              value={d.action}
              onChange={(a) => set({ action: a })}
              options={[
                { id: "forward", label: t.forward, disabled: phaseTwo },
                { id: "deny", label: rt.deny },
                { id: "continue", label: rt.continueMatching },
              ]}
            />
            {d.action === "continue" && <p className="tw-label text-muted-foreground">{t.continueDesc}</p>}
          </FormItem>
          {d.action === "forward" && (
            <FormItem
              label={t.forwardTo}
              desc={!pinned && d.to ? describeTarget(d.to, ov.groups, ov.providers) : undefined}
            >
              <Segmented<ToKind>
                label={t.forwardTo}
                value={d.toKind}
                onChange={(k) =>
                  set({
                    toKind: k,
                    // 头一回切到指定模型：先给一行；原来指的是一个上游，就从它开始
                    pinned:
                      k === "pinned" && d.pinned.length === 0
                        ? [blankPinned(ov.providers.some((p) => p.name === d.to) ? d.to : "")]
                        : d.pinned,
                  })
                }
                options={[
                  { id: "target", label: t.toTarget },
                  { id: "pinned", label: t.toPinned },
                ]}
              />
              {pinned ? (
                <PinnedModels
                  value={d.pinned}
                  onChange={(p) => set({ pinned: p })}
                  providers={ov.providers}
                  known={models}
                />
              ) : (
                <NativeSelect
                  id="rule-to"
                  aria-label={t.forwardTo}
                  className="w-80"
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
              )}
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
          {phaseTwo && <Note>{t.phaseTwo}</Note>}

          {d.action !== "deny" && (
            <div className="flex flex-col">
              <Section
                title={t.rewrite}
                summary={rewriteSummary || t.notSet}
                open={rewriteOpen}
                onToggle={() => setRewriteOpen((o) => !o)}
              >
                <div
                  className={cn(
                    "grid items-start gap-3",
                    pinned
                      ? "grid-cols-[minmax(0,180px)_auto]"
                      : "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]",
                  )}
                >
                  {/* 指定模型：模型名原样发出，「模型改为」不起作用 */}
                  {!pinned && (
                    <FormItem label={t.setModel} htmlFor="rw-model">
                      <ModelInput
                        id="rw-model"
                        value={d.model}
                        onChange={(v) => set({ model: v })}
                        models={models}
                        placeholder={t.unchanged}
                      />
                    </FormItem>
                  )}
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
                {!pinned && d.model.trim() && <Note>{t.modelChangeNote}</Note>}
              </Section>
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          {problem && <span className="mr-auto tw-label text-muted-foreground">{problem}</span>}
          <Button variant="outline" onClick={onClose}>
            {ct.cancel}
          </Button>
          <Button disabled={problem != null} onClick={() => onSave(d)}>
            {create ? t.add : ct.save}
          </Button>
        </DialogFooter>

        {newGroup && (
          <GroupDialog
            mode={{ kind: "create" }}
            ov={ov}
            configVersion={configVersion}
            onClose={() => setNewGroup(false)}
            onSaved={(name, version) => {
              setNewGroup(false);
              set({ to: name });
              onChanged(version);
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
    <Collapsible open={open} onOpenChange={onToggle} className="border-t border-border">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 w-full justify-start gap-2 rounded-none px-0 font-normal hover:bg-transparent aria-expanded:bg-transparent"
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-(--motion-fast) ease-(--motion-ease) motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="font-medium">{title}</span>
          <span className="flex-1" />
          {!open && <span className="min-w-0 truncate tw-label text-muted-foreground">{summary}</span>}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pb-3 pl-5.5 motion-fade">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** 「添加条件」：按请求、特征、来源、上游分组，已有的不再列出 */
function AddCondition({ used, onAdd }: { used: ConditionField[]; onAdd: (field: ConditionField) => void }) {
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
  models: KnownModelX[];
  onChange: (c: ConditionView) => void;
  onRemove: () => void;
}) {
  const t = useText(ruleDialogText);
  const ct = useText(commonText);
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
      const h = modelHint(v0, models);
      if (h) hint = modelHintText(h);
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
            label={name}
            options={[
              { id: "assistant_internal", label: t.anyProbe },
              ...PROBES.map((p) => ({ id: p.id, label: p.label })),
            ]}
            value={c.values}
            onChange={(u) => onChange({ ...c, values: u(c.values) })}
          />
        ) : (
          <ToggleChips
            label={name}
            options={ov.providers.map((p) => ({
              id: p.name,
              icon: <TargetIcon name={p.name} providers={ov.providers} size={12} className="text-current" />,
            }))}
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
        {/* 写成字：对话框右上角的 × 是关闭，同一个面板里不能再有一个 × 表示删除 */}
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 text-muted-foreground"
          aria-label={t.removeCondition(name)}
          onClick={onRemove}
        >
          {ct.delete}
        </Button>
      </div>
      {hint && <p className="pl-26 tw-label text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * 模型条件下面的那一句。写别名：只匹配用这个别名的请求；写上游模型名：匹配几个已知模型，
 * 以及指向它的别名（继承只从真名到别名）
 */
function modelHintText(h: ModelHint): string {
  const t = textOf(ruleDialogText);
  if (h.kind === "alias") return t.aliasOnly(h.alias);
  const parts: string[] = [];
  if (h.matches > 0) parts.push(t.globMatches(h.matches));
  else if (h.inherited.length === 0) parts.push(t.globNone);
  if (h.inherited.length > 0) parts.push(h.exact ? t.alsoAliasesOf(h.inherited) : t.alsoAliases(h.inherited));
  // 英文里「也匹配……」可能排在第一句
  const text = parts.join(t.hintSep);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
