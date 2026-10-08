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
import { Textarea } from "@/ui/textarea";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ContentMatch, Guard, RuleAction, SecurityRuleView, SecurityTestHit } from "@/types";
import { hasAction, type ActionGuard, type RuleSave } from "./api";
import { checkCodepoints, DEFAULT_LABEL, labelOk, MAX_CODEPOINT_ITEMS, placeholderOf, type CodepointsProblem } from "./check";
import { Highlight, lineOf, type Mark } from "./Highlight";
import { MatcherText, modeName, ruleName, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { ruleDialogText } from "./RuleDialog.i18n";
import { useTrial, type Trial } from "./useTrial";

/** 每一项防护的规则在第三档下能做的几件事，按选项的顺序 */
const ACTIONS: Record<ActionGuard, readonly RuleAction[]> = {
  inspect_tools: ["cut", "record"],
  content: ["block", "strip", "record"],
};

/** 内容规则的三种写法 */
const MATCHES: readonly ContentMatch[] = ["contains", "regex", "codepoints"];

/**
 * 一条规则写的是什么，以及怎么认。码位写成一行，和输入框里的写法一样。
 *
 * **写不出来的是 `null`**：出站脱敏那几种（前缀、PEM、身份证号…）和代码里做的检查
 * （`builtin`）没有一条能填进自定义规则的写法，所以也没有「复制为自定义规则」。
 */
export function patternOf(r: SecurityRuleView): { pattern: string; match: ContentMatch } | null {
  switch (r.matcher.kind) {
    case "regex":
      return { pattern: r.matcher.pattern, match: "regex" };
    case "contains":
      return { pattern: r.matcher.text, match: "contains" };
    case "codepoints":
      return { pattern: r.matcher.ranges.join(", "), match: "codepoints" };
    default:
      return null;
  }
}

/** 新建时预先填好的内容。「复制为自定义规则」从内置规则带过来 */
export interface RuleSeed {
  name: string;
  pattern: string;
  match?: ContentMatch;
  action?: RuleAction;
}

/** 一处命中标成什么样：会被切断、拒绝的红，会被删掉的划掉，会被替换或只记录的黄 */
function tone(action: string | null | undefined): Mark["tone"] {
  return action === "cut" || action === "block" ? "bad" : action === "strip" ? "strip" : "warn";
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  /** 写错了：代替说明，红字 */
  error?: string | null;
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
    </div>
  );
}

/**
 * 第三档下做什么：工具调用是切断或仅记录，内容规则是拒绝、删除或仅记录。**自定义规则和
 * 内置规则用同一个** —— 内置规则提供的只是一条写法，命中之后怎么处置和自定义规则一样
 * 由用户定。
 */
function ActionField({
  guard,
  value,
  onChange,
  factory,
}: {
  guard: ActionGuard;
  value: RuleAction;
  onChange: (a: RuleAction) => void;
  /** 内置规则出厂时的处置，标在下面那一句里 */
  factory?: RuleAction | null;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const what = value === "record" ? t.actionWhat.record[guard] : t.actionWhat[value];
  return (
    <Field label={t.action} hint={factory ? what + t.factory(lt.ruleActions[factory] ?? factory) : what}>
      <Segmented<RuleAction>
        label={t.action}
        value={value}
        options={ACTIONS[guard].map((a) => ({ id: a, label: lt.ruleActions[a] ?? a }))}
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
 * 试出来的结果：命中几处，在原文里标出来；替换、删除之后真正发出去的那一份；第三档下
 * 会不会被拒。
 *
 * **标的是 core 给的位置**（见 `Highlight`），发出去的样子也是 core 给的 —— 界面不自己
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
  /** 标成什么颜色。不给就按每一处自己的处置 */
  action?: RuleAction;
  /** 显示发出去的样子（core 给了的话） */
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

/**
 * 新建或编辑一条自定义规则。
 *
 * **写法由 core 检查**：保存时写错了当场拒绝，并说明错在哪；测试文本随输入
 * 标出命中，用的也是 core，和网关用同一个引擎。码位和占位符名称的写法简单、
 * 写错的样子固定，敲完就在框下面说（见 `check.ts`），不用等保存。
 */
export function RuleDialog({
  guard,
  editing,
  seed,
  taken,
  onClose,
  onSave,
}: {
  guard: Guard;
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
  // 只有内容过滤能选；别的两项的自定义规则都是正则
  const [match, setMatch] = useState<ContentMatch>(content ? (was?.match ?? seed?.match ?? "contains") : "regex");
  // 新建的规则默认是最重的那一种：专门写一条规则，多半就是要拦它
  const acts = hasAction(guard) ? guard : null;
  const [action, setAction] = useState<RuleAction>(
    editing?.action ?? seed?.action ?? (acts ? ACTIONS[acts][0]! : "record"),
  );
  // 出站脱敏：占位符名称。默认值显式填在框里，不留空
  const [label, setLabel] = useState(editing?.label ?? DEFAULT_LABEL);
  const [sample, setSample] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codepoints = content && match === "codepoints";
  const cpProblem = codepoints && pattern.length > 0 ? checkCodepoints(pattern) : null;
  const labelValid = labelOk(label);
  const labelError = redact && label.length > 0 && !labelValid ? t.labelBad : null;
  // 选着的处置一起带上：发出去的样子、会不会被拒按它算
  const trial = useTrial(
    guard,
    sample,
    {
      pattern,
      match: content ? match : undefined,
      label: redact && labelValid ? label : undefined,
      action: acts ? action : undefined,
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
          : redact && label.length === 0
            ? t.labelRequired
            : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        pattern,
        action: acts ? action : undefined,
        match: content ? match : undefined,
        label: redact ? label : undefined,
        enabled: editing?.enabled ?? true,
      });
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t.title[guard][editing ? "edit" : "create"]}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={t.name} htmlFor="rule-name" hint={t.nameHint[guard]}>
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
            <Field label={t.matchKind}>
              <Segmented<ContentMatch>
                label={t.matchKind}
                value={match}
                options={MATCHES.map((m) => ({ id: m, label: t.matchKinds[m] }))}
                onChange={(m) => {
                  setError(null);
                  setMatch(m);
                }}
              />
            </Field>
          )}

          <Field
            label={t.patternLabel[match]}
            htmlFor="rule-pattern"
            hint={content ? t.contentHint[match] : t.patternHint[guard === "redact" ? "redact" : "inspect_tools"]}
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

          {redact && (
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

          {acts && <ActionField guard={acts} value={action} onChange={setAction} />}

          <Field label={t.sample} htmlFor="rule-sample">
            <Textarea
              id="rule-sample"
              className="min-h-16 font-mono"
              value={sample}
              spellCheck={false}
              placeholder={t.samplePlaceholder[guard]}
              onChange={(e) => setSample(e.target.value)}
            />
            <TrialBox
              trial={trial}
              sample={sample}
              action={acts ? action : undefined}
              output={labelValid}
              refusal={content ? t.refused(modeName("content", "enforce")) : undefined}
            />
          </Field>
        </div>

        <Banner layout="inline" tone="error" title={t.saveFailed} show={error !== null}>
          {error}
        </Banner>

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
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
 * 一条内置规则：可以试，可以复制成自定义规则再改；工具调用和内容规则还能改
 * 第三档下的处置（出厂是哪一种标在下面）。出站脱敏的规则写明换成的占位符。
 *
 * **停用着的也能试** —— 出厂停用的那几条，就是要先试过才知道该不该开。
 */
export function BuiltinRuleDialog({
  guard,
  rule,
  onClose,
  onCopy,
  onSaveAction,
}: {
  guard: Guard;
  rule: SecurityRuleView;
  onClose: () => void;
  /** 复制成自定义规则。写不出等价写法的（出站脱敏）不给 */
  onCopy?: () => void;
  /** 改第三档下的处置。只有工具调用审查和内容过滤的规则有 */
  onSaveAction: (a: RuleAction) => Promise<void>;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const [action, setAction] = useState<RuleAction>(rule.action ?? "record");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const written = patternOf(rule);
  const acts = hasAction(guard) ? guard : null;
  // 改了处置还没保存：按选着的那一种试
  const trial = useTrial(guard, sample, { rule: rule.id, action: acts ? action : undefined });
  const why = ruleWhy(guard, rule);
  const changed = acts != null && action !== (rule.action ?? "record");

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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {viewName(guard, rule)}
            <Badge variant="secondary">{t.builtin}</Badge>
          </DialogTitle>
          <DialogDescription>{why || t.category(lt.kinds[rule.kind] ?? rule.kind)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={written?.match === "regex" ? t.patternLabel.regex : t.match}>
            <div className="rounded-md border border-border bg-surface/60 px-3 py-2 tw-body">
              {written?.match === "regex" ? (
                <span className="font-mono tw-label break-all">{written.pattern}</span>
              ) : (
                <MatcherText m={rule.matcher} />
              )}
            </div>
          </Field>

          {acts && (
            <ActionField guard={acts} value={action} onChange={setAction} factory={rule.default_action ?? null} />
          )}

          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-1 tw-body">
            <dt className="text-muted-foreground">{t.state}</dt>
            <dd>
              <StatusLabel tone={rule.enabled ? "ok" : "idle"} muted>
                {rule.enabled ? t.on : t.off}
              </StatusLabel>
            </dd>
            {rule.label && (
              <>
                <dt className="text-muted-foreground">{t.replacedWith}</dt>
                <dd className="font-mono">{placeholderOf(rule.label)}</dd>
              </>
            )}
          </dl>

          <Field label={t.sample} htmlFor="builtin-sample">
            <Textarea
              id="builtin-sample"
              className="min-h-16 font-mono"
              value={sample}
              spellCheck={false}
              placeholder={t.samplePlaceholder[guard]}
              onChange={(e) => setSample(e.target.value)}
            />
            <TrialBox
              trial={trial}
              sample={sample}
              action={acts ? action : undefined}
              refusal={guard === "content" ? t.refused(modeName("content", "enforce")) : undefined}
            />
          </Field>
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
          {acts ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                {common.cancel}
              </Button>
              <Button onClick={() => void save()} pending={saving} disabled={!changed}>
                {common.save}
              </Button>
            </div>
          ) : (
            <Button onClick={onClose}>{common.close}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 按现在启用的全部规则试一段文本。**不发出任何请求** —— 试的是网关手里的
 * 那一份规则，结论和真的请求一致：命中了哪几条，替换、删除之后发出去的是什么，
 * 内容过滤在第三档下会不会拒掉它。
 */
export function TestDialog({ guard, onClose }: { guard: Guard; onClose: () => void }) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const trial = useTrial(guard, sample, {});
  const hits = trial.state === "done" ? trial.hits : [];
  const acts = hasAction(guard);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.testTitle[guard]}</DialogTitle>
          <DialogDescription>{t.testDesc}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={t.sample} htmlFor="test-sample">
            <Textarea
              id="test-sample"
              className="min-h-24 font-mono"
              value={sample}
              spellCheck={false}
              placeholder={t.samplePlaceholder[guard]}
              onChange={(e) => setSample(e.target.value)}
            />
          </Field>

          {trial.state !== "idle" && (
            <div className="flex flex-col gap-2">
              <TrialBox
                trial={trial}
                sample={sample}
                refusal={guard === "content" ? t.refused(modeName("content", "enforce")) : undefined}
              />
              {hits.length > 0 && (
                <Table className="table-fixed">
                  <colgroup>
                    <col className="w-[200px]" />
                    <col />
                    <col className="w-[88px]" />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.rule}</TableHead>
                      <TableHead>{t.content}</TableHead>
                      <TableHead>{acts ? t.action : t.position}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hits.map((h, i) => (
                      <TableRow key={`${h.rule}:${h.start}:${i}`}>
                        <TableCell className="truncate">
                          {ruleName(guard, h.rule, h.custom)}
                          {h.custom && (
                            <Badge variant="outline" className="ml-1.5">
                              {lt.custom}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="truncate font-mono tw-label text-muted-foreground">{h.excerpt}</TableCell>
                        {acts ? (
                          <TableCell className={tone(h.action) === "bad" ? "text-destructive" : "text-muted-foreground"}>
                            {lt.ruleActions[h.action ?? "record"] ?? h.action}
                          </TableCell>
                        ) : (
                          <TableCell className="text-muted-foreground">{t.line(lineOf(sample, h.start))}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
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
