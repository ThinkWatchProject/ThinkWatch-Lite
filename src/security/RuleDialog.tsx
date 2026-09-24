import { useState } from "react";
import { CopyIcon } from "lucide-react";
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
import { Spinner } from "@/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Segmented } from "@/ui/segmented";
import { Textarea } from "@/ui/textarea";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ContentMatch, RuleAction, RuleGuard, SecurityRuleView, SecurityTestHit } from "@/types";
import { hasAction, type ActionGuard, type CustomGuard, type RuleSave } from "./api";
import { Highlight, lineOf, type Mark } from "./Highlight";
import { MatcherText, ruleName, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { ruleDialogText } from "./RuleDialog.i18n";
import { useTrial, type Trial } from "./useTrial";

/** 这一项防护上「拦」的那一个词 */
const strong = (guard: ActionGuard): RuleAction => (guard === "content" ? "block" : "cut");

/** 一条规则写的是什么，以及怎么认 */
export function patternOf(r: SecurityRuleView): { pattern: string; match: ContentMatch } | null {
  switch (r.matcher.kind) {
    case "regex":
      return { pattern: r.matcher.pattern, match: "regex" };
    case "contains":
      return { pattern: r.matcher.text, match: "contains" };
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

/** 一处命中标成什么颜色：会被切断、拒绝的红，会被替换或记录的黄 */
function tone(action: string | null | undefined): Mark["tone"] {
  return action === "cut" || action === "block" ? "bad" : "warn";
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="tw-body font-medium" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="tw-label text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * 拦截档下做什么：拦，还是只记录。**自定义规则和内置规则用同一个** ——
 * 内置规则提供的只是一条写法，命中之后怎么处置和自定义规则一样由用户定。
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
  /** 内置规则出厂时的处置。改过的话在下面说一句 */
  factory?: RuleAction | null;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const hard = strong(guard);
  const what = value === "record" ? t.recordWhat[guard] : t.strongWhat[guard];
  return (
    <Field
      label={t.whenEnforced}
      hint={factory && factory !== value ? what + t.factory(lt.ruleActions[factory] ?? factory) : what}
    >
      <Segmented<RuleAction>
        label={t.whenEnforced}
        value={value}
        options={[
          { id: hard, label: lt.ruleActions[hard] },
          { id: "record", label: lt.ruleActions.record },
        ]}
        onChange={onChange}
      />
    </Field>
  );
}

/**
 * 试出来的结果：命中几处，在原文里标出来。
 *
 * **标的是 core 给的位置**（见 `Highlight`），不是界面自己再找一遍。
 */
function TrialBox({
  trial,
  sample,
  action,
}: {
  trial: Trial;
  sample: string;
  /** 标成什么颜色。不给就按每一处自己的处置 */
  action?: RuleAction;
}) {
  const t = useText(ruleDialogText);
  if (trial.state === "idle") return null;
  if (trial.state === "failed") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 tw-label text-destructive">
        {trial.error}
      </div>
    );
  }
  const hits: SecurityTestHit[] = trial.state === "done" ? trial.hits : [];
  const bad = hits.some((h) => tone(action ?? h.action) === "bad");
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2">
      <p
        className={
          "tw-label " +
          (trial.state === "running"
            ? "text-muted-foreground"
            : hits.length === 0
              ? "text-muted-foreground"
              : bad
                ? "text-destructive"
                : "text-success")
        }
      >
        {trial.state === "running" ? <Spinner /> : hits.length > 0 ? t.hits(hits.length) : t.noHit}
      </p>
      {hits.length > 0 && (
        <Highlight
          text={sample}
          marks={hits.map((h) => ({ start: h.start, end: h.end, tone: tone(action ?? h.action) }))}
        />
      )}
    </div>
  );
}

/**
 * 新建或编辑一条自定义规则。
 *
 * **写法由 core 检查**：保存时写错了当场拒绝，并说明错在哪；测试文本随输入
 * 标出命中，用的也是 core，和网关用同一个引擎。
 */
export function RuleDialog({
  guard,
  editing,
  seed,
  taken,
  onClose,
  onSave,
}: {
  guard: CustomGuard;
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
  const [name, setName] = useState(editing?.id ?? seed?.name ?? "");
  const [pattern, setPattern] = useState(was?.pattern ?? seed?.pattern ?? "");
  // 只有内容过滤能选；别的两项的自定义规则都是正则
  const [match, setMatch] = useState<ContentMatch>(
    guard === "content" ? (was?.match ?? seed?.match ?? "contains") : "regex",
  );
  // 新建的规则默认拦：专门写一条规则，多半就是要拦它
  const acts = hasAction(guard) ? guard : null;
  const [action, setAction] = useState<RuleAction>(
    editing?.action ?? seed?.action ?? (acts ? strong(acts) : "record"),
  );
  const [sample, setSample] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const content = guard === "content";
  const trial = useTrial(
    guard,
    sample,
    { pattern, match: content ? match : undefined },
    pattern.length > 0,
  );

  const clash = taken.includes(name.trim());
  const missing =
    name.trim().length === 0
      ? t.nameRequired
      : clash
        ? t.nameTaken
        : pattern.length === 0
          ? t.patternRequired[match]
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
                options={[
                  { id: "contains", label: t.contains },
                  { id: "regex", label: t.regexKind },
                ]}
                onChange={setMatch}
              />
            </Field>
          )}

          <Field
            label={t.patternLabel[match]}
            htmlFor="rule-pattern"
            hint={guard === "content" ? t.contentHint[match] : t.patternHint[guard]}
          >
            <Input
              id="rule-pattern"
              className="font-mono"
              value={pattern}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => {
                setError(null);
                setPattern(e.target.value);
              }}
            />
          </Field>

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
            <TrialBox trial={trial} sample={sample} action={acts ? action : undefined} />
          </Field>
        </div>

        {error && <p className="tw-body text-destructive">{error}</p>}

        <DialogFooter className="items-center">
          {missing && <span className="mr-auto tw-label text-muted-foreground">{missing}</span>}
          <Button variant="outline" onClick={onClose}>
            {common.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={saving || missing != null}>
            {saving && <Spinner />}
            {editing ? common.save : t.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 一条内置规则：可以试，可以复制成自定义规则再改；工具调用和内容规则还能改
 * 拦截时的处置。
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
  guard: RuleGuard;
  rule: SecurityRuleView;
  onClose: () => void;
  /** 复制成自定义规则。写不出等价写法的（出站脱敏、隐藏字符）不给 */
  onCopy?: () => void;
  /** 改拦截时的处置。只有工具调用审查和内容过滤的规则有 */
  onSaveAction: (a: RuleAction) => Promise<void>;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const [action, setAction] = useState<RuleAction>(rule.action ?? "record");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trial = useTrial(guard, sample, { rule: rule.id });
  const why = ruleWhy(rule);
  const written = patternOf(rule);
  const acts = hasAction(guard) ? guard : null;
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
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 tw-body">
              {written?.match === "regex" ? (
                <span className="font-mono tw-label break-all">{written.pattern}</span>
              ) : (
                <MatcherText m={rule.matcher} />
              )}
            </div>
          </Field>

          {acts && (
            <ActionField
              guard={acts}
              value={action}
              onChange={setAction}
              factory={rule.default_action ?? null}
            />
          )}

          <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-1 tw-body">
            <dt className="text-muted-foreground">{t.state}</dt>
            <dd>{rule.enabled ? t.on : t.off}</dd>
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
            <TrialBox trial={trial} sample={sample} action={acts ? action : undefined} />
          </Field>
        </div>

        {error && <p className="tw-body text-destructive">{error}</p>}

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
              <Button onClick={() => void save()} disabled={saving || !changed}>
                {saving && <Spinner />}
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
 * 那一份规则，结论和真的请求一致。
 */
export function TestDialog({ guard, onClose }: { guard: RuleGuard; onClose: () => void }) {
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
              <TrialBox trial={trial} sample={sample} />
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
                      <TableHead>{acts ? t.whenEnforced : t.position}</TableHead>
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
