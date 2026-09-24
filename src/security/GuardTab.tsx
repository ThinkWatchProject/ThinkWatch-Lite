import { Fragment } from "react";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { rowMotion, usePresentList } from "@/ui/motion";
import { PageSection } from "@/ui/page";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { TableSkeleton } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { Guard, GuardDetail, GuardMode, RuleGuard, SecurityRuleView } from "@/types";
import { hasAction, hasCustom, type ActionGuard } from "./api";
import { Code, MatcherText, modeTone, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { guardTabText } from "./GuardTab.i18n";
import { GroupRow, ROW_FOCUS, rowNav, stop } from "./rows";

const MODES: readonly GuardMode[] = ["off", "observe", "enforce"];

/** 规则表上能做的事。**都由页面接住** —— 它们要写配置、要开对话框 */
export interface RuleActions {
  mode: (mode: GuardMode) => void;
  toggle: (r: SecurityRuleView, enabled: boolean) => void;
  /** 这条规则的开关正在写 */
  pending: (r: SecurityRuleView) => boolean;
  /** 内置规则：只读查看；自定义规则：编辑 */
  open: (r: SecurityRuleView) => void;
  /** 复制成自定义规则。只有写得出等价写法的那几项有 */
  copy?: (r: SecurityRuleView) => void;
  remove: (r: SecurityRuleView) => void;
  create: () => void;
  test: () => void;
}

/** 规则在表里的键：内置和自定义可以同名 */
const keyOf = (r: SecurityRuleView) => `${r.custom ? "c" : "b"}:${r.id}`;

/**
 * 一项防护的档位：名字、一句它做什么，右边三档；下面一行是现在的样子（状态点
 * 和页头、标签上的同色），再下面把「切到拦截」的代价说在切之前。
 */
export function ModeCard({
  guard,
  mode,
  pending,
  onMode,
}: {
  guard: Guard;
  mode: GuardMode;
  /** 档位正在写 */
  pending: boolean;
  onMode: (mode: GuardMode) => void;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const copy = t[guard];
  return (
    <section data-slot="mode-card" className="rounded-lg border border-border bg-surface/40 px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="tw-head text-foreground">{lt.guards[guard]}</h2>
          <p className="mt-0.5 tw-body text-muted-foreground">{copy.lead}</p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <Spinner className="size-3.5 text-muted-foreground" aria-hidden />}
          <Segmented<GuardMode>
            label={t.modeFor(lt.guards[guard])}
            value={mode}
            options={MODES.map((m) => ({ id: m, label: lt.modes[m] }))}
            onChange={(v) => v !== mode && onMode(v)}
          />
        </div>
      </div>
      <div className="mt-3 border-t border-border/70 pt-3">
        <p className="flex items-start gap-2 tw-body text-foreground">
          <StatusDot tone={modeTone(mode)} className="mt-[7px]" />
          <span key={mode} className="motion-fade">
            {copy.now[mode]}
          </span>
        </p>
        <p className="mt-1 pl-3.5 tw-label text-muted-foreground">
          {mode === "enforce" ? copy.risk : t.ifEnforced(copy.effect, copy.risk)}
        </p>
      </div>
    </section>
  );
}

/** 档位那一块和规则表还没读到时的样子：和读到之后同一个形状，不跳 */
export function GuardSkeleton({ rules }: { rules: boolean }) {
  return (
    <div className="flex flex-col" role="status" aria-busy="true">
      <div className="rounded-lg border border-border bg-surface/40 px-4 py-3.5">
        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-3.5 w-28 rounded-sm" />
            <Skeleton className="h-3 w-64 max-w-full rounded-sm" />
          </div>
          <Skeleton className="h-7 w-40 rounded-lg" />
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3">
          <Skeleton className="h-3 w-3/5 rounded-sm" />
          <Skeleton className="h-2.5 w-4/5 rounded-sm opacity-70" />
        </div>
      </div>
      {rules && (
        <div className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-12 rounded-sm" />
              <Skeleton className="h-3 w-32 rounded-sm opacity-70" />
            </div>
            <Skeleton className="h-7 w-44 rounded-lg" />
          </div>
          <TableSkeleton rows={6} cols={3} />
        </div>
      )}
    </div>
  );
}

/**
 * 一项有规则的防护：上面是档位，下面是全部规则。
 *
 * **档位和规则都是全局的**，对所有上游、所有密钥一样。这一页没有「按上游」
 * 的任何设置 —— 同一个请求走哪家，不该决定它里面的密钥会不会被换掉。
 *
 * 内置规则可以启停；工具调用和内容规则还能改拦截时的处置，改写法要先复制成
 * 自定义规则。自定义规则在对话框里改。隐藏字符只有那两种，没有自定义规则。
 * 每次改动由 core 写成一个配置版本。点一行打开它（内置的查看或改处置，
 * 自定义的编辑）。
 */
export function GuardTab({
  guard,
  detail,
  modePending,
  actions,
}: {
  guard: RuleGuard;
  detail: GuardDetail;
  modePending: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const on = detail.rules.filter((r) => r.enabled).length;

  return (
    <div className="flex flex-col">
      <ModeCard guard={guard} mode={detail.mode} pending={modePending} onMode={actions.mode} />

      <PageSection
        title={t.rules}
        description={t.ruleCount(on, detail.rules.length)}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={actions.test}>
              <FlaskConicalIcon />
              {t.test}
            </Button>
            {hasCustom(guard) && (
              <Button size="sm" onClick={actions.create}>
                <PlusIcon />
                {t.newRule}
              </Button>
            )}
          </>
        }
      >
        {guard === "redact" ? (
          <RedactRules rules={detail.rules} actions={actions} />
        ) : guard === "hidden_text" ? (
          <HiddenRules rules={detail.rules} actions={actions} />
        ) : (
          <ActionRules guard={guard} rules={detail.rules} actions={actions} />
        )}
      </PageSection>
    </div>
  );
}

/** 行菜单：内置的查看或编辑、复制；自定义的编辑、删除 */
function useMenu(guard: RuleGuard, actions: RuleActions) {
  const t = useText(guardTabText);
  const common = useText(commonText);
  return (r: SecurityRuleView): MenuItems => {
    const toggle = {
      kind: "item" as const,
      label: r.enabled ? t.turnOff : t.turnOn,
      onSelect: () => actions.toggle(r, !r.enabled),
      disabled: actions.pending(r),
    };
    if (r.custom)
      return [
        { kind: "item", label: common.edit, onSelect: () => actions.open(r) },
        toggle,
        { kind: "sep" },
        { kind: "item", label: common.delete, onSelect: () => actions.remove(r), danger: true },
      ];
    // 出站脱敏、隐藏字符的内置规则只能启停，也写不出等价的自定义规则
    if (!hasAction(guard)) return [{ kind: "item", label: t.view, onSelect: () => actions.open(r) }, toggle];
    const copy = actions.copy;
    return [
      // 内置的工具调用和内容规则能改拦截时的处置，所以是「编辑」不是「查看」
      { kind: "item", label: common.edit, onSelect: () => actions.open(r) },
      toggle,
      ...(copy ? [{ kind: "sep" as const }, { kind: "item" as const, label: t.copyAsCustom, onSelect: () => copy(r) }] : []),
    ];
  };
}

/** 按顺序把规则分成几段，每段一个标题。core 给的顺序就是界面的顺序 */
function groups<K extends string, T extends { item: SecurityRuleView }>(rows: T[], key: (r: SecurityRuleView) => K) {
  const out: { key: K; rows: T[] }[] = [];
  for (const row of rows) {
    const k = key(row.item);
    const last = out[out.length - 1];
    if (last && last.key === k) last.rows.push(row);
    else out.push({ key: k, rows: [row] });
  }
  return out;
}

function RuleSwitch({ r, name, actions }: { r: SecurityRuleView; name: string; actions: RuleActions }) {
  const t = useText(guardTabText);
  return (
    <Switch
      size="sm"
      checked={r.enabled}
      pending={actions.pending(r)}
      aria-label={t.toggleFor(name)}
      onCheckedChange={(v) => actions.toggle(r, v)}
    />
  );
}

/** 一行规则：点它、按 Enter 打开，右键和行尾是同一份菜单 */
function RuleRow({
  r,
  presence,
  items,
  actions,
  children,
}: {
  r: SecurityRuleView;
  presence: Parameters<typeof rowMotion>[0];
  items: MenuItems;
  actions: RuleActions;
  children: React.ReactNode;
}) {
  return (
    <RowMenu items={items}>
      <TableRow
        className={cn("cursor-default", ROW_FOCUS, rowMotion(presence))}
        onClick={() => actions.open(r)}
        {...rowNav(() => actions.open(r))}
      >
        {children}
      </TableRow>
    </RowMenu>
  );
}

/** 启用开关和行尾菜单那两格 */
function RuleTail({ r, name, items, actions }: { r: SecurityRuleView; name: string; items: MenuItems; actions: RuleActions }) {
  const t = useText(guardTabText);
  return (
    <>
      <TableCell className="text-right" {...stop}>
        <RuleSwitch r={r} name={name} actions={actions} />
      </TableCell>
      <TableCell className="text-right" {...stop}>
        <RowMenuButton items={items} label={t.actionsFor(name)} />
      </TableCell>
    </>
  );
}

function RuleName({ r, name, why }: { r: SecurityRuleView; name: string; why?: string }) {
  return (
    <>
      <div className={cn("truncate", r.enabled ? "text-foreground" : "text-muted-foreground")}>{name}</div>
      {why && (
        <div className="truncate tw-label text-muted-foreground" title={why}>
          {why}
        </div>
      )}
    </>
  );
}

function RedactRules({ rules, actions }: { rules: SecurityRuleView[]; actions: RuleActions }) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const menu = useMenu("redact", actions);
  const shown = usePresentList(rules, keyOf);
  return (
    <Table className="table-fixed min-w-[560px]">
      <colgroup>
        <col className="w-[210px]" />
        <col />
        <col className="w-14" />
        <col className="w-9" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>{t.rule}</TableHead>
          <TableHead>{t.match}</TableHead>
          <TableHead className="text-right">{t.enabled}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups(shown, (r) => r.kind).map((g) => (
          <Fragment key={g.key}>
            <GroupRow span={4} title={lt.kinds[g.key] ?? g.key} count={g.rows.length > 1 ? g.rows.length : undefined} />
            {g.rows.map(({ item: r, key, presence }) => {
              const items = menu(r);
              const name = viewName("redact", r);
              return (
                <RuleRow key={key} r={r} presence={presence} items={items} actions={actions}>
                  <TableCell>
                    <RuleName r={r} name={name} />
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    <MatcherText m={r.matcher} />
                  </TableCell>
                  <RuleTail r={r} name={name} items={items} actions={actions} />
                </RuleRow>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * 工具调用审查、内容过滤：规则、写法、拦截时做什么。
 *
 * 工具调用的内置规则一组；内容规则按 core 给的类别分组（指令覆盖、身份与
 * 提示词、中文说法），自定义的在最后。
 */
function ActionRules({ guard, rules, actions }: { guard: ActionGuard; rules: SecurityRuleView[]; actions: RuleActions }) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const menu = useMenu(guard, actions);
  const content = guard === "content";
  const key = (r: SecurityRuleView) => (r.custom ? "custom" : content ? r.kind : "builtin");
  const shown = usePresentList(rules, keyOf);
  return (
    <Table className="table-fixed min-w-[640px]">
      <colgroup>
        <col className="w-[230px]" />
        <col />
        <col className="w-[84px]" />
        <col className="w-14" />
        <col className="w-9" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>{t.rule}</TableHead>
          <TableHead>{content ? t.match : t.regex}</TableHead>
          <TableHead>{t.whenEnforced}</TableHead>
          <TableHead className="text-right">{t.enabled}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups(shown, key).map((g) => (
          <Fragment key={g.key}>
            <GroupRow
              span={5}
              title={g.key === "builtin" ? t.builtinGroup : (lt.kinds[g.key] ?? g.key)}
              count={g.rows.length > 1 ? g.rows.length : undefined}
            />
            {g.rows.map(({ item: r, key: k, presence }) => {
              const items = menu(r);
              const name = viewName(guard, r);
              const pattern = r.matcher.kind === "regex" ? r.matcher.pattern : "";
              const hard = r.action === "cut" || r.action === "block";
              return (
                <RuleRow key={k} r={r} presence={presence} items={items} actions={actions}>
                  <TableCell className="py-2">
                    <RuleName r={r} name={name} why={ruleWhy(r)} />
                  </TableCell>
                  {content ? (
                    <TableCell className="truncate text-muted-foreground">
                      {/* 表里只写那段文字；「不区分大小写」对每一条都一样，在对话框里说 */}
                      {r.matcher.kind === "contains" ? <Code>{r.matcher.text}</Code> : <MatcherText m={r.matcher} />}
                    </TableCell>
                  ) : (
                    <TableCell className="truncate font-mono tw-label text-muted-foreground" title={pattern}>
                      {pattern}
                    </TableCell>
                  )}
                  <TableCell className={hard ? "text-destructive" : "text-muted-foreground"}>
                    {lt.ruleActions[r.action ?? "record"] ?? r.action}
                  </TableCell>
                  <RuleTail r={r} name={name} items={items} actions={actions} />
                </RuleRow>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

/** 隐藏字符：那两种字符，各是哪几段码位、为什么值得查 */
function HiddenRules({ rules, actions }: { rules: SecurityRuleView[]; actions: RuleActions }) {
  const t = useText(guardTabText);
  const menu = useMenu("hidden_text", actions);
  const shown = usePresentList(rules, keyOf);
  return (
    <Table className="table-fixed min-w-[560px]">
      <colgroup>
        <col />
        <col className="w-[230px]" />
        <col className="w-14" />
        <col className="w-9" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>{t.rule}</TableHead>
          <TableHead>{t.codepoints}</TableHead>
          <TableHead className="text-right">{t.enabled}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map(({ item: r, key, presence }) => {
          const items = menu(r);
          const name = viewName("hidden_text", r);
          const ranges = r.matcher.kind === "codepoints" ? r.matcher.ranges : [];
          return (
            <RuleRow key={key} r={r} presence={presence} items={items} actions={actions}>
              <TableCell className="py-2">
                <RuleName r={r} name={name} why={ruleWhy(r)} />
              </TableCell>
              <TableCell className="truncate font-mono tw-label text-muted-foreground">{ranges.join(", ")}</TableCell>
              <RuleTail r={r} name={name} items={items} actions={actions} />
            </RuleRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
