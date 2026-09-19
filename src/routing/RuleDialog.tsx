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
import { PROBES, conditionName, formatLabel, probeLabel, targetLabel } from "@/labels";
import type { ConditionView, KnownModel, Overview } from "@/types";
import { globMatch } from "@/upstreams/glob";
import { REDACT_KINDS } from "@/upstreams/labels";
import { FormItem, Note, Segmented } from "@/upstreams/parts";
import { GroupDialog } from "./GroupDialog";
import { ModelInput, ToggleChips } from "./fields";
import {
  COMPARE_OPS,
  COND_FIELDS,
  DIALECTS,
  PROBE_IDS,
  addOnsText,
  blankCondition,
  condField,
  describeTarget,
  isPhaseTwo,
  ruleProblem,
  splitCompare,
  type Action,
  type RuleDraft,
} from "./model";

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
  const [d, setD] = useState<RuleDraft>(initial);
  const set = (patch: Partial<RuleDraft>) => setD((x) => ({ ...x, ...patch }));
  const [rewriteOpen, setRewriteOpen] = useState(
    () => initial.model !== "" || initial.maxTokens !== "" || initial.thinking !== "keep",
  );
  const [guardOpen, setGuardOpen] = useState(() => initial.redact.length > 0 || initial.untrusted);
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

  const rewriteSummary = addOnsText({ ...d, redact: [], untrusted: false });
  const guardSummary = addOnsText({ ...d, model: "", maxTokens: "", thinking: "keep" });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{create ? "添加规则" : `编辑规则「${initial.name}」`}</DialogTitle>
          <DialogDescription>
            路由「{routeName}」· 第 {position} 条
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-1">
          <FormItem label="名称" htmlFor="rule-name">
            <Input
              id="rule-name"
              autoFocus={create}
              value={d.name}
              placeholder="例如 长上下文"
              onChange={(e) => set({ name: e.target.value })}
            />
          </FormItem>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2">
              <span className="tw-body font-medium">条件</span>
              {d.conditions.length > 1 && (
                <span className="tw-label text-muted-foreground">同时满足以下条件</span>
              )}
            </div>
            <div className="flex flex-col gap-2.5 rounded-lg border border-border p-2.5">
              {d.conditions.length === 0 && (
                <p className="tw-body text-muted-foreground">全部请求（兜底）</p>
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
                  <Note tone="warning">
                    {unrouted.map(probeLabel).join("、")}当前未设为交给路由，此条件不会满足。
                  </Note>
                  <Field orientation="horizontal" className="w-auto">
                    <Checkbox
                      id="rule-route-probes"
                      checked={routing}
                      onCheckedChange={(v) => setRouteProbes(v === true)}
                    />
                    <FieldLabel htmlFor="rule-route-probes">保存时将这些类别改为交给路由</FieldLabel>
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
            <FormItem label="命中后">
              <Segmented<Action>
                value={d.action}
                onChange={(a) => set({ action: a })}
                options={[
                  { id: "forward", label: "转发", disabled: phaseTwo },
                  { id: "deny", label: "拒绝" },
                  { id: "continue", label: "继续匹配" },
                ]}
              />
            </FormItem>
            {d.action === "forward" && (
              <FormItem
                label="转发至"
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
                  {!d.to && <NativeSelectOption value="">选择去向</NativeSelectOption>}
                  <NativeSelectOptGroup label="策略组">
                    {ov.groups.map((g) => (
                      <NativeSelectOption key={g.name} value={g.name}>
                        {targetLabel(g.name)}
                      </NativeSelectOption>
                    ))}
                    <NativeSelectOption value={NEW_GROUP}>新建策略组…</NativeSelectOption>
                  </NativeSelectOptGroup>
                  <NativeSelectOptGroup label="上游">
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
              <FormItem label="拒绝原因" htmlFor="rule-deny" desc="返回给客户端。">
                <Input
                  id="rule-deny"
                  value={d.deny}
                  placeholder="例如 此密钥不提供 Opus 模型"
                  onChange={(e) => set({ deny: e.target.value })}
                />
              </FormItem>
            )}
            {d.action === "continue" && (
              <p className="self-end pb-1.5 tw-label text-muted-foreground">
                应用下方的改写参数与安全要求，然后继续匹配后续规则。
              </p>
            )}
          </div>
          {phaseTwo && (
            <Note>含「选定上游」条件的规则在选定上游之后判断，只能拒绝或继续匹配。</Note>
          )}

          {d.action !== "deny" && (
            <div className="flex flex-col">
              <Section
                title="改写参数"
                summary={rewriteSummary || "未设置"}
                open={rewriteOpen}
                onToggle={() => setRewriteOpen((o) => !o)}
              >
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-start gap-3">
                  <FormItem label="模型改为" htmlFor="rw-model">
                    <ModelInput
                      id="rw-model"
                      value={d.model}
                      onChange={(v) => set({ model: v })}
                      models={modelIds}
                      placeholder="不改变"
                    />
                  </FormItem>
                  <FormItem label="max_tokens" htmlFor="rw-max">
                    <Input
                      id="rw-max"
                      className="font-mono"
                      inputMode="numeric"
                      placeholder="不改变"
                      value={d.maxTokens}
                      onChange={(e) => set({ maxTokens: e.target.value })}
                    />
                  </FormItem>
                  <FormItem label="扩展思考">
                    <Segmented<RuleDraft["thinking"]>
                      value={d.thinking}
                      onChange={(v) => set({ thinking: v })}
                      options={[
                        { id: "keep", label: "不改变" },
                        { id: "on", label: "开启" },
                        { id: "off", label: "关闭" },
                      ]}
                    />
                  </FormItem>
                </div>
                {d.model.trim() && <Note>更换模型后，已缓存的 prompt 不再命中。</Note>}
              </Section>
              <Section
                title="安全要求"
                summary={guardSummary || "未设置"}
                open={guardOpen}
                onToggle={() => setGuardOpen((o) => !o)}
              >
                <FormItem label="额外脱敏" desc="与上游自身的设置合并，只增加保护。">
                  <ToggleChips
                    mono={false}
                    options={REDACT_KINDS.map((k) => ({ id: k.id, label: k.label }))}
                    value={d.redact}
                    onChange={(u) => setD((x) => ({ ...x, redact: u(x.redact) }))}
                  />
                </FormItem>
                <Field orientation="horizontal" className="w-auto">
                  <Checkbox
                    id="rule-untrusted"
                    checked={d.untrusted}
                    onCheckedChange={(v) => set({ untrusted: v === true })}
                  />
                  <FieldLabel htmlFor="rule-untrusted">按非官方端点处理</FieldLabel>
                </Field>
              </Section>
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          {problem && <span className="mr-auto tw-label text-muted-foreground">{problem}</span>}
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={problem != null} onClick={() => onSave(d, routing ? unrouted : [])}>
            {create ? "添加" : "保存"}
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
  const left = COND_FIELDS.filter((f) => !used.includes(f.id));
  if (left.length === 0) return null;
  const groups = [...new Set(left.map((f) => f.group))];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="self-start text-muted-foreground">
          <PlusIcon />
          添加条件
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {groups.map((g, i) => (
          <div key={g}>
            {i > 0 && <DropdownMenuSeparator />}
            <div className="px-1.5 pt-1 pb-0.5 tw-label text-muted-foreground">{g}</div>
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
          placeholder="例如 claude-opus-*"
        />
      );
      if (v0.trim() && models.length > 0) {
        const n = models.filter((m) => globMatch(v0.trim(), m)).length;
        hint = n > 0 ? `匹配 ${n} 个已知模型` : "不匹配任何已知模型";
      }
      break;
    }
    case "compare": {
      const [op, amount] = splitCompare(v0);
      control = (
        <>
          <NativeSelect
            aria-label={`${name}的比较方式`}
            value={op}
            onChange={(e) => onChange({ ...c, values: [`${e.target.value}${amount}`] })}
          >
            {COMPARE_OPS.map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label={`${name}的数值`}
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
            { id: "true", label: "是" },
            { id: "false", label: "否" },
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
            {!v0 && <NativeSelectOption value="">选择密钥</NativeSelectOption>}
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
              { id: "assistant_internal", label: "任一辅助请求" },
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
          aria-label={`删除条件 ${name}`}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      {hint && <p className="pl-26 tw-label text-muted-foreground">{hint}</p>}
    </div>
  );
}
