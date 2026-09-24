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
import type { Guard, SecurityRuleView, SecurityTestHit } from "@/types";
import type { CustomRuleSave } from "./api";
import { Highlight, lineOf, type Mark } from "./Highlight";
import { MatcherText, ruleName, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { ruleDialogText } from "./RuleDialog.i18n";
import { useTrial, type Trial } from "./useTrial";

type Action = "cut" | "record";
/** core 按字符串发拦截时的动作；只认这两个 */
export const asAction = (s: string | null | undefined): Action | undefined =>
  s === "cut" || s === "record" ? s : undefined;

/** 新建时预先填好的内容。「复制为自定义规则」从内置规则带过来 */
export interface RuleSeed {
  name: string;
  pattern: string;
  action?: Action;
}

/** 一处命中标成什么颜色：会被切断的红，会被替换或记录的黄 */
function tone(guard: Guard, action: string | null | undefined): Mark["tone"] {
  return guard === "inspect_tools" && action === "cut" ? "bad" : "warn";
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
 * 拦截档下做什么：切断，还是只记录。**自定义规则和内置规则用同一个** ——
 * 内置规则提供的只是一条正则，命中之后怎么处置和自定义规则一样由用户定。
 */
function ActionField({
  value,
  onChange,
  factory,
}: {
  value: Action;
  onChange: (a: Action) => void;
  /** 内置规则出厂时的处置。改过的话在下面说一句 */
  factory?: Action | null;
}) {
  const t = useText(ruleDialogText);
  const what = value === "cut" ? t.cutWhat : t.recordWhat;
  return (
    <Field
      label={t.whenEnforced}
      hint={factory && factory !== value ? what + t.factory(factory === "cut" ? t.cut : t.record) : what}
    >
      <Segmented<Action>
        label={t.whenEnforced}
        value={value}
        options={[
          { id: "cut", label: t.cut },
          { id: "record", label: t.record },
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
  guard,
  action,
}: {
  trial: Trial;
  sample: string;
  guard: Guard;
  /** 标成什么颜色。不给就按每一处自己的处置 */
  action?: Action;
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
  const bad = hits.some((h) => tone(guard, action ?? h.action) === "bad");
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
          marks={hits.map((h) => ({ start: h.start, end: h.end, tone: tone(guard, action ?? h.action) }))}
        />
      )}
    </div>
  );
}

/**
 * 新建或编辑一条自定义规则。
 *
 * **正则由 core 编译**：保存时写错了当场拒绝，并说明错在哪；测试文本随输入
 * 标出命中，用的也是 core，和网关用同一个正则引擎。
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
  onSave: (save: Omit<CustomRuleSave, "base_version">) => Promise<void>;
}) {
  const t = useText(ruleDialogText);
  const common = useText(commonText);
  const [name, setName] = useState(editing?.id ?? seed?.name ?? "");
  const [pattern, setPattern] = useState(
    editing?.matcher.kind === "regex" ? editing.matcher.pattern : (seed?.pattern ?? ""),
  );
  // 新建的审查规则默认切断：专门写一条规则，多半就是要拦它
  const [action, setAction] = useState<Action>(
    asAction(editing?.action) ?? seed?.action ?? "cut",
  );
  const [sample, setSample] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trial = useTrial(guard, sample, { pattern }, pattern.length > 0);

  const clash = taken.includes(name.trim());
  const missing =
    name.trim().length === 0
      ? t.nameRequired
      : clash
        ? t.nameTaken
        : pattern.length === 0
          ? t.patternRequired
          : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        pattern,
        action: guard === "inspect_tools" ? action : undefined,
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
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePlaceholder[guard]}
              aria-invalid={clash}
            />
          </Field>

          <Field label={t.pattern} htmlFor="rule-pattern" hint={t.patternHint[guard]}>
            <Input
              id="rule-pattern"
              className="font-mono"
              value={pattern}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(e) => setPattern(e.target.value)}
            />
          </Field>

          {guard === "inspect_tools" && <ActionField value={action} onChange={setAction} />}

          <Field label={t.sample} htmlFor="rule-sample">
            <Textarea
              id="rule-sample"
              className="min-h-16 font-mono"
              value={sample}
              spellCheck={false}
              placeholder={t.samplePlaceholder[guard]}
              onChange={(e) => setSample(e.target.value)}
            />
            <TrialBox trial={trial} sample={sample} guard={guard} action={action} />
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
 * 一条内置规则：只读，可以试，可以复制成自定义规则再改。
 *
 * **停用着的也能试** —— 出厂停用的那几条（内网地址），就是要先试过才知道
 * 该不该开。
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
  onCopy: () => void;
  /** 改拦截时的处置。只有工具调用审查的规则有 */
  onSaveAction: (a: Action) => Promise<void>;
}) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const [action, setAction] = useState<Action>((rule.action as Action | null | undefined) ?? "record");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trial = useTrial(guard, sample, { rule: rule.id });
  const why = ruleWhy(rule);
  const regex = rule.matcher.kind === "regex" ? rule.matcher.pattern : null;
  const tools = guard === "inspect_tools";
  const changed = tools && action !== (rule.action ?? "record");

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
          <DialogDescription>
            {guard === "inspect_tools" ? why : t.category(lt.kinds[rule.kind] ?? rule.kind)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={regex != null ? t.pattern : t.match}>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 tw-body">
              {regex != null ? (
                <span className="font-mono tw-label break-all">{regex}</span>
              ) : (
                <MatcherText m={rule.matcher} />
              )}
            </div>
          </Field>

          {tools && (
            <ActionField value={action} onChange={setAction} factory={asAction(rule.default_action) ?? null} />
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
            <TrialBox trial={trial} sample={sample} guard={guard} action={tools ? action : undefined} />
          </Field>
        </div>

        {error && <p className="tw-body text-destructive">{error}</p>}

        <DialogFooter className="items-center sm:justify-between">
          {regex != null ? (
            <Button variant="outline" onClick={onCopy}>
              <CopyIcon />
              {t.copyAsCustom}
            </Button>
          ) : (
            <span />
          )}
          {tools ? (
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
export function TestDialog({ guard, onClose }: { guard: Guard; onClose: () => void }) {
  const t = useText(ruleDialogText);
  const lt = useText(securityLabelsText);
  const common = useText(commonText);
  const [sample, setSample] = useState("");
  const trial = useTrial(guard, sample, {});
  const hits = trial.state === "done" ? trial.hits : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.title[guard].test}</DialogTitle>
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
              <TrialBox trial={trial} sample={sample} guard={guard} />
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
                      <TableHead>{guard === "inspect_tools" ? t.whenEnforced : t.position}</TableHead>
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
                        {guard === "inspect_tools" ? (
                          <TableCell className={h.action === "cut" ? "text-destructive" : "text-muted-foreground"}>
                            {lt.ruleActions[h.action ?? "record"]}
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
