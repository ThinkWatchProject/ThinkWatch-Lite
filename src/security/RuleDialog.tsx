import { useState } from "react";
import { CopyIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogConfirm,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
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
import { Spinner } from "@/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { ACTIONS, type RuleSave } from "./api";
import { checkCodepoints, DEFAULT_LABEL, labelOk, MAX_CODEPOINT_ITEMS, placeholderOf, type CodepointsProblem } from "./check";
import type {
  ContentMatch,
  ContentScope,
  Guard,
  GuardMode,
  RuleAction,
  SecurityRuleView,
  SecurityTestHit,
} from "@/types";
import { Highlight, lineOf, type Mark } from "./Highlight";
import { MatcherText, modeName, ruleName, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { ruleDialogText } from "./RuleDialog.i18n";
import {
  actionAllowed,
  actionOf,
  adjustForScope,
  coversAnswer,
  DEFAULT_REPLACEMENT,
  matchAllowed,
  scopeChoice,
  scopeOf,
  scopeOfChoice,
  type ScopeChoice,
} from "./rules";
import { useTrial, type Trial } from "./useTrial";

/** 自定义规则能选的写法：内容规则三种，密钥与隐私不认码位。危险命令只有正则，不选 */
const MATCHES: Record<"redact" | "content", readonly ContentMatch[]> = {
  redact: ["contains", "regex"],
  content: ["contains", "regex", "codepoints"],
};

const SCOPES: readonly ScopeChoice[] = ["request", "response", "both"];

/** 新建的规则缺省做什么：内容规则仅记录（规格 §5.1），密钥与隐私替换为占位符，危险命令切断 */
const NEW_ACTION: Record<Guard, RuleAction> = { redact: "placeholder", inspect_tools: "cut", content: "record" };

/**
 * 一条规则写的是什么，以及怎么认、分不分大小写。码位写成一行，和输入框里的写法一样。
 *
 * **写不出来的是 `null`**：密钥与隐私那几种（前缀、PEM、身份证号…）和代码里做的检查
 * （`builtin`）没有一条能填进自定义规则的写法，所以也没有「复制为自定义规则」。
 */
export function patternOf(r: SecurityRuleView): { pattern: string; match: ContentMatch; cased: boolean } | null {
  switch (r.matcher.kind) {
    case "regex":
      return { pattern: r.matcher.pattern, match: "regex", cased: r.matcher.case_sensitive ?? false };
    case "contains":
      return { pattern: r.matcher.text, match: "contains", cased: r.matcher.case_sensitive ?? false };
    case "codepoints":
      return { pattern: r.matcher.ranges.join(", "), match: "codepoints", cased: false };
    default:
      return null;
  }
}

/** 新建时预先填好的内容。「复制为自定义规则」从内置规则带过来 */
export interface RuleSeed {
  name: string;
  pattern: string;
  match?: ContentMatch;
  cased?: boolean;
  action?: RuleAction;
}

/** 一处命中标成什么样：会被切断、拒绝的红，会被删掉的划掉，替换和只记录的黄 */
function tone(action: string | null | undefined): Mark["tone"] {
  return action === "cut" || action === "block" ? "bad" : action === "strip" ? "strip" : "warn";
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  notes,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  /** 写错了：代替说明，红字 */
  error?: string | null;
  /** 说明下面再接的几句：不可选的原因（淡色）、自动换了哪一项（提醒色） */
  notes?: { text: string; tone?: "muted" | "warn" }[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="tw-body font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="tw-label text-destructive">{error}</p>
      ) : (
        hint && <p className="tw-label text-muted-foreground">{hint}</p>
      )}
      {notes?.map((n) => (
        <p
          key={n.text}
          className={cn("tw-label", n.tone === "warn" ? "text-warning-foreground" : "text-muted-foreground")}
          role={n.tone === "warn" ? "status" : undefined}
        >
          {n.text}
        </p>
      ))}
    </div>
  );
}

/**
 * 规则在「开启」状态下做什么。**自定义规则和内置规则用同一个** —— 内置规则提供的只是一条
 * 写法，命中之后怎么处理由用户定。查回答的内容规则「拒绝」置灰（不隐藏），下面说原因；
 * 换检查对象时自动换掉的，`switched` 说一句
 */
function ActionField({
  guard,
  value,
  onChange,
  scope = "request",
  factory,
  switched = false,
  extra,
}: {
  guard: Guard;
  value: RuleAction;
  onChange: (a: RuleAction) => void;
  scope?: ScopeChoice;
  /** 内置规则出厂时的动作，标在下面那一句里 */
  factory?: RuleAction | null;
  switched?: boolean;
  /** 代替动作说明的那一句（内置规则「替换」：换成的文字固定） */
  extra?: string;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const what = extra ?? (value === "record" ? t.actionWhat.record[guard] : t.actionWhat[value]);
  const notes: { text: string; tone?: "muted" | "warn" }[] = [];
  if (guard === "content" && coversAnswer(scope)) notes.push({ text: t.blockRequestOnly });
  if (switched) notes.push({ text: t.switchedAction, tone: "warn" });
  return (
    <Field label={t.action} hint={factory ? what + t.factory(lt.ruleActions[factory] ?? factory) : what} notes={notes}>
      <Segmented<RuleAction>
        label={t.action}
        value={value}
        options={ACTIONS[guard].map((a) => ({
          id: a,
          label: lt.ruleActions[a] ?? a,
          disabled: !actionAllowed(guard, a, scope),
        }))}
        onChange={onChange}
      />
    </Field>
  );
}

/** 码位写错的那一句 */
function codepointsError(t: typeof ruleDialogText.zh, p: CodepointsProblem | null): string | null {
  if (!p) return null;
  switch (p.kind) {
    case "empty":
      return t.patternRequired.codepoints;
    case "count":
      return t.codepointsBad.count(MAX_CODEPOINT_ITEMS);
    default:
      return t.codepointsBad[p.kind](p.item);
  }
}

/**
 * 测试文本：内容规则先选这段当作请求还是回答来试（规则不查的那一边置灰），下面是文本框
 * 和试出来的结果
 */
function SampleField({
  id,
  guard,
  sample,
  onSample,
  side,
  onSide,
  sides,
  children,
}: {
  id: string;
  guard: Guard;
  sample: string;
  onSample: (s: string) => void;
  side: ContentScope;
  onSide: (s: ContentScope) => void;
  /** 规则查的那几边。不给（测试全部规则、非内容规则）就两边都能选 */
  sides?: readonly ContentScope[];
  children: React.ReactNode;
}) {
  const t = useText(ruleDialogText);
  const content = guard === "content";
  return (
    <Field label={t.sample} htmlFor={id}>
      {content && (
        <Segmented<ContentScope>
          label={t.sample}
          value={side}
          options={(["request", "response"] as const).map((s) => ({
            id: s,
            label: t.testAs[s],
            disabled: sides != null && !sides.includes(s),
          }))}
          onChange={onSide}
        />
      )}
      <Textarea
        id={id}
        className="min-h-16 font-mono"
        value={sample}
        spellCheck={false}
        placeholder={content && side === "response" ? t.sampleAnswer : t.samplePlaceholder[guard]}
        onChange={(e) => onSample(e.target.value)}
      />
      {children}
    </Field>
  );
}

/** 测试那一边：规则查的那几边里，原来选的还在就留着，否则换成它查的第一边 */
function sideWithin(side: ContentScope, sides: readonly ContentScope[]): ContentScope {
  return sides.includes(side) ? side : (sides[0] ?? "request");
}

/**
 * 试出来的结果：命中几处，在原文里标出来；处理后的样子；「开启」状态下会不会被拒。
 *
 * **标的是 core 给的位置**（见 `Highlight`），处理后的样子也是 core 给的 —— 界面不自己
 * 再找一遍、再删一遍。
 */
function TrialBox({
  trial,
  sample,
  action,
  output = true,
  refusal,
}: {
  trial: Trial;
  sample: string;
  /** 标成什么颜色。不给就按每一处自己的动作 */
  action?: RuleAction;
  /** 显示处理后的样子（core 给了的话） */
  output?: boolean;
  /** 会被拒时说的那句话。不给就不说 */
  refusal?: string;
}) {
  const t = useText(ruleDialogText);
  if (trial.state === "idle") return null;
  if (trial.state === "failed") {
    return (
      <Banner layout="inline" tone="error">
        {trial.error}
      </Banner>
    );
  }
  const done = trial.state === "done" ? trial : null;
  const hits: SecurityTestHit[] = done?.hits ?? [];
  const bad = hits.some((h) => tone(action ?? h.action) === "bad");
  const refused = refusal != null && done?.refused === true;
  const sent = output && !refused ? (done?.output ?? null) : null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface/60 px-3 py-2 motion-fade">
      <p
        className={cn(
          "tw-label",
          !done || hits.length === 0 ? "text-muted-foreground" : bad ? "text-destructive" : "text-warning-foreground",
        )}
      >
        {!done ? <Spinner className="size-3" /> : hits.length > 0 ? t.hits(hits.length) : t.noHit}
      </p>
      {hits.length > 0 && (
        <Highlight
          text={sample}
          marks={hits.map((h) => ({ start: h.start, end: h.end, tone: tone(action ?? h.action) }))}
        />
      )}
      {refused && <p className="tw-label text-destructive">{refusal}</p>}
      {sent != null && (
        <div className="mt-1 flex flex-col gap-1 border-t border-border/70 pt-2">
          <p className="tw-label text-muted-foreground">{t.output}</p>
          <div className="font-mono tw-body leading-relaxed break-all whitespace-pre-wrap">{sent}</div>
        </div>
      )}
    </div>
  );
}

/** 对话框底部左边那一句：还缺什么；都齐了、防护处于「监控」时说规则只记录 */
function FooterNote({ missing, mode }: { missing: string | null; mode: GuardMode }) {
  const t = useText(ruleDialogText);
  const text = missing ?? (mode === "observe" ? t.monitoring : null);
  return text ? <span className="mr-auto tw-label text-muted-foreground">{text}</span> : null;
}

/**
 * 新建或编辑一条自定义规则。
 *
 * **写法由 core 检查**：保存时写错了当场拒绝，并说明错在哪；测试文本随输入
 * 标出命中，用的也是 core，和网关用同一个引擎。码位和占位符名称的写法简单、
 * 写错的样子固定，敲完就在框下面说（见 `check.ts`），不用等保存。
 *
 * 内容规则按规格 §5：检查对象、匹配方式（同一行右边是「区分大小写」开关）、匹配内容、
 * 动作、替换文本（动作为「替换」时）、测试文本。检查对象含回答时「拒绝」和「码位」置灰，
 * 已选着的自动换成「删除」「包含」并在控件下方说明。
 */
export function RuleDialog({
  guard,
  mode,
  editing,
  seed,
  taken,
  onClose,
  onSave,
}: {
  guard: Guard;
  /** 这项防护现在的状态。处于「监控」时底部说一句规则只记录 */
  mode: GuardMode;
  /** 编辑哪一条。不给就是新建 */
  editing: SecurityRuleView | null;
  seed?: RuleSeed;
  /** 这项防护里已有的规则名（编辑时不含它自己） */
  taken: string[];
  onClose: () => void;
  onSave: (save: RuleSave) => Promise<void>;
}) {
  const t = useText(ruleDialogText);
  const common = useText(commonText);
  const was = editing ? patternOf(editing) : null;
  const content = guard === "content";
  const redact = guard === "redact";
  const [name, setName] = useState(editing?.id ?? seed?.name ?? "");
  const [pattern, setPattern] = useState(was?.pattern ?? seed?.pattern ?? "");
  // 内容过滤和密钥与隐私能选，缺省按原样找；危险命令的自定义规则都是正则
  const choosable = content ? "content" : redact ? "redact" : null;
  const [match, setMatch] = useState<ContentMatch>(choosable ? (was?.match ?? seed?.match ?? "contains") : "regex");
  // 分不分大小写，缺省不分
  const [cased, setCased] = useState(was?.cased ?? seed?.cased ?? false);
  const [action, setAction] = useState<RuleAction>(
    editing ? actionOf(guard, editing) : (seed?.action ?? NEW_ACTION[guard]),
  );
  // 内容规则：查哪一边、换成什么。缺省值直接填在框里
  const [scope, setScope] = useState<ScopeChoice>(editing ? scopeChoice(scopeOf(editing)) : "request");
  const [replacement, setReplacement] = useState(editing?.replacement ?? DEFAULT_REPLACEMENT);
  /** 换检查对象时自动换掉了哪一项，在那个控件下方说一句；动手改了那一项就不再说 */
  const [switched, setSwitched] = useState({ action: false, match: false });
  // 密钥与隐私：占位符名称。缺省值显式填在框里，不留空
  const [label, setLabel] = useState(editing?.label ?? DEFAULT_LABEL);
  const [sample, setSample] = useState("");
  const [side, setSide] = useState<ContentScope>(scope === "response" ? "response" : "request");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sides = scopeOfChoice(scope);
  const testSide = sideWithin(side, sides);
  const codepoints = match === "codepoints";
  const cpProblem = content && codepoints && pattern.length > 0 ? checkCodepoints(pattern) : null;
  const placeholder = redact && action === "placeholder";
  const labelValid = labelOk(label);
  const labelError = placeholder && label.length > 0 && !labelValid ? t.labelBad : null;
  const replacing = content && action === "replace";
  // 选着的动作一起带上：处理后的样子、会不会被拒按它算
  const trial = useTrial(
    guard,
    sample,
    {
      pattern,
      match: choosable ? match : undefined,
      case_sensitive: choosable && !codepoints ? cased : undefined,
      label: redact && labelValid ? label : undefined,
      action,
      scope: content ? testSide : undefined,
      replacement: replacing ? replacement : undefined,
    },
    pattern.length > 0 && !cpProblem,
  );

  const clash = taken.includes(name.trim());
  const missing =
    name.trim().length === 0
      ? t.nameRequired
      : clash
        ? t.nameTaken
        : pattern.length === 0
          ? t.patternRequired[match]
          : placeholder && label.length === 0
            ? t.labelRequired
            : replacing && replacement.length === 0
              ? t.replacementRequired
              : null;

  function changeScope(c: ScopeChoice) {
    setError(null);
    setScope(c);
    const next = adjustForScope(c, action, match);
    setAction(next.action);
    setMatch(next.match);
    setSwitched({ action: next.changed.action, match: next.changed.match });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        pattern,
        action,
        match: choosable ? match : undefined,
        case_sensitive: choosable && !codepoints ? cased : undefined,
        label: redact ? label : undefined,
        scope: content ? scopeOfChoice(scope) : undefined,
        replacement: replacing ? replacement : undefined,
        enabled: editing?.enabled ?? true,
      });
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  // 匹配方式下面：怎么找、分不分大小写；查回答时码位为何不可选、正则的长度限制、自动换了什么
  const matchNotes: { text: string; tone?: "muted" | "warn" }[] = [];
  if (content && coversAnswer(scope)) {
    matchNotes.push({ text: t.codepointsRequestOnly });
    if (match === "regex") matchNotes.push({ text: t.regexAnswerLimit });
  }
  if (switched.match) matchNotes.push({ text: t.switchedMatch, tone: "warn" });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title[guard][editing ? "edit" : "create"]}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={t.name} htmlFor="rule-name" hint={t.nameHint}>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => {
                setError(null);
                setName(e.target.value);
              }}
              placeholder={t.namePlaceholder[guard]}
              aria-invalid={clash}
            />
          </Field>

          {content && (
            <Field label={t.scope} hint={t.scopeHint}>
              <Segmented<ScopeChoice>
                label={t.scope}
                value={scope}
                options={SCOPES.map((c) => ({ id: c, label: t.scopes[c] }))}
                onChange={changeScope}
              />
            </Field>
          )}

          {choosable && (
            <Field
              label={t.matchKind}
              hint={match === "codepoints" ? t.matchHint.codepoints : t.matchHint[match](cased)}
              notes={matchNotes}
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Segmented<ContentMatch>
                  label={t.matchKind}
                  value={match}
                  options={MATCHES[choosable].map((m) => ({
                    id: m,
                    label: t.matchKinds[m],
                    disabled: !matchAllowed(m, scope),
                  }))}
                  onChange={(m) => {
                    setError(null);
                    setMatch(m);
                    setSwitched((s) => ({ ...s, match: false }));
                  }}
                />
                {/* 开 / 关两态用开关；码位不分大小写，置灰 */}
                <label className="flex items-center gap-2 tw-body">
                  <Switch
                    size="sm"
                    checked={cased && !codepoints}
                    disabled={codepoints}
                    onCheckedChange={(on) => {
                      setError(null);
                      setCased(on);
                    }}
                  />
                  <span className={cn(codepoints && "text-muted-foreground")}>{t.caseSensitive}</span>
                </label>
              </div>
            </Field>
          )}

          <Field
            label={t.patternLabel}
            htmlFor="rule-pattern"
            hint={choosable ? undefined : t.toolHint}
            error={codepointsError(t, cpProblem)}
          >
            <Input
              id="rule-pattern"
              className="font-mono"
              value={pattern}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={codepoints ? t.codepointsExample : undefined}
              aria-invalid={cpProblem != null}
              onChange={(e) => {
                setError(null);
                setPattern(e.target.value);
              }}
            />
          </Field>

          <ActionField
            guard={guard}
            value={action}
            scope={scope}
            switched={switched.action}
            onChange={(a) => {
              setAction(a);
              setSwitched((s) => ({ ...s, action: false }));
            }}
          />

          {replacing && (
            <Field label={t.replacement} htmlFor="rule-replacement" hint={t.replacementHint}>
              <Input
                id="rule-replacement"
                className="w-48 font-mono"
                value={replacement}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => {
                  setError(null);
                  setReplacement(e.target.value);
                }}
              />
            </Field>
          )}

          {placeholder && (
            <Field label={t.label} htmlFor="rule-label" hint={t.labelHint} error={labelError}>
              <div className="flex min-w-0 items-center gap-3">
                <Input
                  id="rule-label"
                  className="w-48 font-mono"
                  value={label}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-invalid={labelError != null}
                  onChange={(e) => {
                    setError(null);
                    setLabel(e.target.value);
                  }}
                />
                {/* 替换之后的样子，跟着输入走 */}
                {labelValid && (
                  <span className="truncate font-mono tw-label text-muted-foreground">{placeholderOf(label)}</span>
                )}
              </div>
            </Field>
          )}

          <SampleField
            id="rule-sample"
            guard={guard}
            sample={sample}
            onSample={setSample}
            side={testSide}
            onSide={setSide}
            sides={sides}
          >
            <TrialBox
              trial={trial}
              sample={sample}
              action={action}
              output={!redact || labelValid}
              refusal={content && testSide === "request" ? t.refused(modeName("enforce")) : undefined}
            />
          </SampleField>
        </div>

        <Banner layout="inline" tone="error" title={t.saveFailed} show={error !== null}>
          {error}
        </Banner>

        <DialogFooter className="items-center">
          <FooterNote missing={missing} mode={mode} />
          <Button variant="outline" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button
            onClick={() => void save()}
            pending={saving}
            disabled={missing != null || cpProblem != null || labelError != null}
          >
            {editing ? common.save : t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 一条内置规则：可以试，可以改「开启」状态下的动作（出厂是哪一种标在下面），可以复制成
 * 自定义规则再改写法。密钥与隐私的规则写明换成的占位符；内置的内容规则只查请求。
 *
 * **停用着的也能试** —— 出厂停用的那几条，就是要先试过才知道该不该开。
 */
export function BuiltinRuleDialog({
  guard,
  mode,
  rule,
  onClose,
  onCopy,
  onSaveAction,
}: {
  guard: Guard;
  mode: GuardMode;
  rule: SecurityRuleView;
  onClose: () => void;
  /** 复制成自定义规则。写不出等价写法的不给 */
  onCopy?: () => void;
  /** 改「开启」状态下的动作 */
  onSaveAction: (a: RuleAction) => Promise<void>;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const was = actionOf(guard, rule);
  const [action, setAction] = useState<RuleAction>(was);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const written = patternOf(rule);
  const sides = scopeOf(rule);
  // 改了动作还没保存：按选着的那一种试
  const trial = useTrial(guard, sample, {
    rule: rule.id,
    action,
    scope: guard === "content" ? sides[0] : undefined,
  });
  const why = ruleWhy(guard, rule);
  const changed = action !== was;
  const replacement = rule.replacement ?? DEFAULT_REPLACEMENT;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSaveAction(action);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {viewName(guard, rule)}
            <Badge variant="secondary">{t.builtin}</Badge>
          </DialogTitle>
          <DialogDescription>{why || t.category(lt.kinds[rule.kind] ?? rule.kind)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={written?.match === "regex" ? t.patternLabel : t.match}>
            <div className="rounded-md border border-border bg-surface/60 px-3 py-2 tw-body">
              {written?.match === "regex" ? (
                <span className="font-mono tw-label break-all">{written.pattern}</span>
              ) : (
                <MatcherText m={rule.matcher} />
              )}
            </div>
          </Field>

          <ActionField
            guard={guard}
            value={action}
            onChange={setAction}
            scope={scopeChoice(sides)}
            factory={rule.default_action ?? null}
            extra={action === "replace" ? t.builtinReplace(replacement) : undefined}
          />

          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-1 tw-body">
            <dt className="text-muted-foreground">{t.state}</dt>
            <dd>
              <StatusLabel tone={rule.enabled ? "ok" : "idle"} muted>
                {rule.enabled ? t.on : t.off}
              </StatusLabel>
            </dd>
            {guard === "content" && (
              <>
                <dt className="text-muted-foreground">{t.scope}</dt>
                <dd>{sides.map((s) => lt.directions[s]).join(" · ")}</dd>
              </>
            )}
            {rule.label && action === "placeholder" && (
              <>
                <dt className="text-muted-foreground">{t.replacedWith}</dt>
                <dd className="font-mono">{placeholderOf(rule.label)}</dd>
              </>
            )}
          </dl>

          <SampleField
            id="builtin-sample"
            guard={guard}
            sample={sample}
            onSample={setSample}
            side={sides[0] ?? "request"}
            onSide={() => {}}
            sides={sides}
          >
            <TrialBox
              trial={trial}
              sample={sample}
              action={action}
              refusal={guard === "content" ? t.refused(modeName("enforce")) : undefined}
            />
          </SampleField>
        </div>

        <Banner layout="inline" tone="error" title={t.saveFailed} show={error !== null}>
          {error}
        </Banner>

        <DialogFooter className="items-center sm:justify-between">
          {onCopy ? (
            <Button variant="outline" onClick={onCopy}>
              <CopyIcon />
              {t.copyAsCustom}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {mode === "observe" && <span className="tw-label text-muted-foreground">{t.monitoring}</span>}
            <Button variant="outline" onClick={onClose}>
              {common.cancel}
            </Button>
            <Button onClick={() => void save()} pending={saving} disabled={!changed}>
              {common.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 按现在启用的全部规则试一段文本。**不发出任何请求** —— 试的是网关手里的
 * 那一份规则，结论和真的请求一致：命中了哪几条，处理后是什么样子，内容过滤在
 * 「开启」状态下会不会拒掉它。内容过滤先选这段当作请求还是回答来试。
 */
export function TestDialog({ guard, onClose }: { guard: Guard; onClose: () => void }) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const [side, setSide] = useState<ContentScope>("request");
  const content = guard === "content";
  const trial = useTrial(guard, sample, { scope: content ? side : undefined });
  const hits = trial.state === "done" ? trial.hits : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.testTitle[guard]}</DialogTitle>
          <DialogDescription>{t.testDesc}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <SampleField id="test-sample" guard={guard} sample={sample} onSample={setSample} side={side} onSide={setSide}>
            {trial.state !== "idle" && (
              <div className="flex flex-col gap-2">
                <TrialBox
                  trial={trial}
                  sample={sample}
                  refusal={content && side === "request" ? t.refused(modeName("enforce")) : undefined}
                />
                {hits.length > 0 && (
                  <Table className="table-fixed">
                    <colgroup>
                      <col className="w-[200px]" />
                      <col />
                      <col className="w-[120px]" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.rule}</TableHead>
                        <TableHead>{t.content}</TableHead>
                        <TableHead>{t.action}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {hits.map((h, i) => {
                        const a = h.action ?? (guard === "redact" ? "placeholder" : "record");
                        return (
                          <TableRow key={`${h.rule}:${h.start}:${i}`}>
                            <TableCell className="truncate">
                              {ruleName(guard, h.rule, h.custom)}
                              {h.custom && (
                                <Badge variant="outline" className="ml-1.5">
                                  {lt.custom}
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="truncate font-mono tw-label text-muted-foreground">
                              {h.excerpt}
                              <span className="ml-1.5 font-sans">· {t.line(lineOf(sample, h.start))}</span>
                            </TableCell>
                            <TableCell
                              className={cn("truncate", tone(a) === "bad" ? "text-destructive" : "text-muted-foreground")}
                            >
                              {lt.ruleActions[a] ?? a}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </SampleField>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>{common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 删除一条自定义规则。**删了就回不来**（写法只在配置里），所以要确认；日志里
 * 已有的记录不受影响。失败时对话框留着，把 core 的话显示在里面。
 */
export function DeleteRuleDialog({
  name,
  onDelete,
  onClose,
}: {
  name: string;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useText(ruleDialogText);
  const common = useText(commonText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.deleteTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription>{t.deleteDesc}</AlertDialogDescription>
        </AlertDialogHeader>
        <Banner layout="inline" tone="error" title={t.deleteFailed} show={error !== null}>
          {error}
        </Banner>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{common.cancel}</AlertDialogCancel>
          <AlertDialogConfirm variant="destructive" pending={busy} onConfirm={() => void run()}>
            {common.delete}
          </AlertDialogConfirm>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
