import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ChevronRightIcon, FlaskConicalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { rowMotion, usePresentList } from "@/ui/motion";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
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
import { ACTIONS } from "./api";
import type { Guard, GuardDetail, GuardMode, RuleAction, SecurityKindView, SecurityRuleView } from "@/types";
import { kindName, modeName, modeTone, RuleMatchText, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { guardTabText, nowText } from "./GuardTab.i18n";
import { patternOf } from "./RuleDialog";
import {
  actionAllowed,
  actionOf,
  DEFAULT_REPLACEMENT,
  groupOpen,
  groupRules,
  hitsFirst,
  hitsOf,
  readOpenGroups,
  ruleKey,
  ruleMatches,
  scopeChoice,
  scopeOf,
  writeOpenGroups,
  type RuleHits,
} from "./rules";
import { disclosureNav, ROW_FOCUS, rowNav, stop } from "./rows";
import { useRuleHits } from "./useSecurityLog";

/** 状态的先后，和规格的示意一致：开启、监控、关闭 */
const MODES: readonly GuardMode[] = ["enforce", "observe", "off"];

/** 规则表上能做的事。**都由页面接住** —— 它们要写配置、要开对话框 */
export interface RuleActions {
  mode: (mode: GuardMode) => void;
  toggle: (r: SecurityRuleView, enabled: boolean) => void;
  /** 行内改一条规则的动作 */
  setAction: (r: SecurityRuleView, action: RuleAction) => void;
  /** 这条规则正在写（开关、动作） */
  pending: (r: SecurityRuleView) => boolean;
  /** 打开对话框：内置规则改动作、试；自定义规则编辑 */
  open: (r: SecurityRuleView) => void;
  /** 复制成自定义规则。只给写得出等价写法的规则（见 `patternOf`） */
  copy?: (r: SecurityRuleView) => void;
  remove: (r: SecurityRuleView) => void;
  create: () => void;
  test: () => void;
}

/**
 * 一项防护的状态：开启、监控、关闭，右边一句当前状态下命中之后怎样，以及启用了几条规则。
 * 圆点和页签上的同色。
 */
export function ModeBar({
  guard,
  mode,
  on,
  all,
  pending,
  onMode,
}: {
  guard: Guard;
  mode: GuardMode;
  /** 启用的规则条数 */
  on: number;
  all: number;
  /** 状态正在写 */
  pending: boolean;
  onMode: (mode: GuardMode) => void;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  return (
    <section data-slot="mode-bar" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Segmented<GuardMode>
        label={t.modeFor(lt.guards[guard])}
        value={mode}
        options={MODES.map((m) => ({ id: m, label: modeName(m) }))}
        onChange={(v) => v !== mode && onMode(v)}
      />
      {pending && <Spinner className="size-3.5 text-muted-foreground" aria-hidden />}
      <p className="flex min-w-0 flex-1 items-start gap-2 tw-body">
        <StatusDot tone={modeTone(mode)} className="mt-[7px]" />
        <span key={mode} className="min-w-0 motion-fade">
          <span className="text-foreground">{nowText(t, guard, mode)}</span>{" "}
          <span className="text-muted-foreground">{t.ruleCount(on, all)}</span>
        </span>
      </p>
    </section>
  );
}

/** 状态那一行和规则表还没读到时的样子：和读到之后同一个形状，不跳 */
export function GuardSkeleton() {
  return (
    <div className="flex flex-col" role="status" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-36 rounded-lg" />
        <Skeleton className="h-3 w-80 max-w-full rounded-sm" />
      </div>
      <div className="mt-5">
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-7 w-56 rounded-lg" />
          <Skeleton className="h-7 w-44 rounded-lg" />
        </div>
        <TableSkeleton rows={6} cols={4} />
      </div>
    </div>
  );
}

/**
 * 一项防护：上面是状态，下面是全部规则。
 *
 * **状态和规则都是全局的**，对所有上游、所有密钥一样。
 *
 * 规则的实际处理按这个顺序定（规格 §4.3）：防护关闭不检查；规则停用不检查；防护处于
 * 「监控」时一律仅记录（动作列照写用户设的动作，后面标「监控中」）；其余按规则的动作。
 *
 * 内置规则按类别分组，**各组默认收起**，组标题写名字、条数、启用条数和最近 7 天的命中次数，
 * 没有开关；有命中的组排在内置规则的最前面，自定义规则在最后一组。检索框按名字和写法筛，
 * 匹配的组自动展开。每一行的开关、动作就地改；点一行打开它的对话框。
 */
export function GuardTab({
  guard,
  detail,
  modePending,
  actions,
  below,
}: {
  guard: Guard;
  detail: GuardDetail;
  modePending: boolean;
  actions: RuleActions;
  /** 规则表下方的一节（密钥与隐私：例外） */
  below?: ReactNode;
}) {
  const t = useText(guardTabText);
  const [query, setQuery] = useState("");
  const on = detail.rules.filter((r) => r.enabled).length;
  const hits = useRuleHits(guard);

  return (
    <div className="flex flex-col">
      <ModeBar
        guard={guard}
        mode={detail.mode}
        on={on}
        all={detail.rules.length}
        pending={modePending}
        onMode={actions.mode}
      />

      <div className="mt-5 mb-3 flex flex-wrap items-center gap-2">
        <InputGroup className="h-7 w-64 rounded-[min(var(--radius-md),10px)]">
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            className="h-full py-0.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
            spellCheck={false}
          />
        </InputGroup>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={actions.test}>
          <FlaskConicalIcon />
          {t.test}
        </Button>
        <Button size="sm" onClick={actions.create}>
          <PlusIcon />
          {t.newRule}
        </Button>
      </div>

      <RuleTable
        guard={guard}
        mode={detail.mode}
        rules={detail.rules}
        kinds={detail.kinds}
        query={query}
        hits={hits}
        actions={actions}
      />
      {below}
    </div>
  );
}

/** 行菜单：内置的编辑、启停、复制；自定义的编辑、启停、删除 */
function useMenu(actions: RuleActions) {
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
    // 写不出等价写法的（出站的凭据种类、代码里做的检查）没有可抄的
    const copy = patternOf(r) ? actions.copy : undefined;
    return [
      // 内置规则能改动作，所以是「编辑」不是「查看」
      { kind: "item", label: common.edit, onSelect: () => actions.open(r) },
      toggle,
      ...(copy ? [{ kind: "sep" as const }, { kind: "item" as const, label: t.copyAsCustom, onSelect: () => copy(r) }] : []),
    ];
  };
}

/**
 * 全部规则，一张表：启用、规则、匹配内容、（内容过滤：检查对象）、动作。
 *
 * **动作一列三种颜色**：拒绝、切断是红的（请求或回答的结局变了），删除、替换、替换为占位符
 * 是正文色（改了内容照常发出），仅记录是次要色。
 *
 * **各组默认收起。**点组头、在组头上按 Enter / 空格展开或收起（→ 展开、← 收起），记在这台
 * 机器上（`readOpenGroups`）；收起的组里的行不画，`↑` `↓` 在组头和展开的行之间走。检索时
 * 匹配的组一律展开，这一次检索里收起的不记。
 */
export function RuleTable({
  guard,
  mode,
  rules,
  kinds,
  query,
  hits,
  actions,
}: {
  guard: Guard;
  mode: GuardMode;
  rules: SecurityRuleView[];
  /** 分组和分组名，core 给的（旧的 core 不给） */
  kinds: SecurityKindView[] | undefined;
  query: string;
  /** 最近 7 天每条规则的命中次数。还没读到、读不到是 `undefined`：组头不写次数，组照 core 的顺序 */
  hits: RuleHits | undefined;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const menu = useMenu(actions);
  const content = guard === "content";
  const span = content ? 6 : 5;
  const searching = query.trim().length > 0;
  const [open, setOpen] = useState(() => readOpenGroups(guard));
  // 这一次检索里收起的组。换了检索词就不算了
  const [closed, setClosed] = useState<{ query: string; keys: ReadonlySet<string> }>({ query, keys: new Set() });
  const closedInSearch = closed.query === query ? closed.keys : new Set<string>();
  const toggle = (key: string) => {
    if (searching) {
      const keys = new Set(closedInSearch);
      if (!keys.delete(key)) keys.add(key);
      setClosed({ query, keys });
      return;
    }
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
    writeOpenGroups(guard, next);
  };
  // 淡入淡出按全部规则算：检索筛掉的行直接不画，不播淡出
  const present = usePresentList(rules, ruleKey);
  /*
    **组的先后按全部规则的命中定，不按筛出来的**：一边打字一边换位置，眼睛跟不上。
  */
  const hitKinds = useMemo(() => {
    const ks = new Set<string>();
    for (const g of groupRules(rules, (r) => r)) if ((hitsOf(hits, g.rows) ?? 0) > 0) ks.add(g.key);
    return ks;
  }, [rules, hits]);
  const groups = useMemo(() => {
    const shown = present.filter(
      ({ item: r, presence }) => presence === "exit" || ruleMatches(r, viewName(r), query),
    );
    return hitsFirst(groupRules(shown, (p) => p.item), (g) => hitKinds.has(g.key));
  }, [present, guard, query, hitKinds]);

  return (
    <Table className={cn("table-fixed", content ? "min-w-[760px]" : "min-w-[660px]")}>
      <colgroup>
        <col className="w-12" />
        <col className="w-[220px]" />
        <col />
        {content && <col className="w-[104px]" />}
        <col className="w-[196px]" />
        <col className="w-9" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>{t.enabled}</TableHead>
          <TableHead>{t.rule}</TableHead>
          <TableHead>{t.match}</TableHead>
          {content && <TableHead>{t.scope}</TableHead>}
          <TableHead>{t.action}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.length === 0 && (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={span} className="h-16 text-center text-muted-foreground">
              {t.noMatch}
            </TableCell>
          </TableRow>
        )}
        {groups.map((g) => {
          const live = g.rows.filter((p) => p.presence !== "exit").map((p) => p.item);
          // 分组名由 core 给（`kinds`），按界面语言取
          const title = kindName(kinds, g.key);
          const expanded = groupOpen(g.key, searching, open, closedInSearch);
          return (
            <Fragment key={g.key}>
              <GroupHead
                span={span}
                title={title}
                rules={live}
                hits={hitsOf(hits, live)}
                open={expanded}
                onToggle={() => toggle(g.key)}
              />
              {expanded && g.rows.map(({ item: r, key, presence }) => (
                <RuleRow
                  key={key}
                  guard={guard}
                  mode={mode}
                  r={r}
                  presence={presence}
                  items={menu(r)}
                  actions={actions}
                />
              ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * 一组的标题行：「隐藏字符 · 3 条 · 已开 2 条 · 最近 7 天命中 5 次」，前面一个展开记号。组本身
 * 没有开关，逐条启停。**整行是展开、收起的按钮**：点它，或者聚焦时按 Enter / 空格（→ 展开、
 * ← 收起），`↑` `↓` 和规则行一起走。没有命中（或者还没数出来）的不写次数
 */
function GroupHead({
  span,
  title,
  rules,
  hits,
  open,
  onToggle,
}: {
  span: number;
  title: string;
  rules: SecurityRuleView[];
  hits: number | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useText(guardTabText);
  const on = rules.filter((r) => r.enabled).length;
  return (
    <TableRow
      className={cn("cursor-default bg-surface/70 hover:bg-surface", HEAD_FOCUS)}
      data-slot="rule-group"
      onClick={onToggle}
      {...disclosureNav(open, onToggle)}
    >
      <TableCell colSpan={span} className="h-8 py-0 tw-label text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 motion-bar", open && "rotate-90")}
          />
          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground/80">{title}</span>
            {` · ${t.groupCount(rules.length, on)}`}
            {hits != null && hits > 0 && ` · ${t.groupHits(hits)}`}
          </span>
        </span>
      </TableCell>
    </TableRow>
  );
}

/** 组头的键盘焦点：和规则行一样左边一道竖线（底色本来就深一档，不再加深） */
const HEAD_FOCUS =
  "outline-none focus-visible:bg-surface focus-visible:shadow-[inset_2px_0_0_0_color-mix(in_oklab,var(--foreground)_60%,transparent)]";

/** 一行规则：点它、按 Enter 打开，右键和行尾是同一份菜单 */
function RuleRow({
  guard,
  mode,
  r,
  presence,
  items,
  actions,
}: {
  guard: Guard;
  mode: GuardMode;
  r: SecurityRuleView;
  presence: Parameters<typeof rowMotion>[0];
  items: MenuItems;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const name = viewName(r);
  const why = ruleWhy(guard, r);
  const pattern = r.matcher.kind === "regex" ? r.matcher.pattern : "";
  return (
    <RowMenu items={items}>
      <TableRow
        className={cn("cursor-default", ROW_FOCUS, rowMotion(presence))}
        onClick={() => actions.open(r)}
        {...rowNav(() => actions.open(r))}
      >
        <TableCell {...stop}>
          <Switch
            size="sm"
            checked={r.enabled}
            pending={actions.pending(r)}
            aria-label={t.toggleFor(name)}
            onCheckedChange={(v) => actions.toggle(r, v)}
          />
        </TableCell>
        <TableCell className="py-2">
          <div className={cn("truncate", r.enabled ? "text-foreground" : "text-muted-foreground")}>{name}</div>
          {why && (
            <div className="truncate tw-label text-muted-foreground" title={why}>
              {why}
            </div>
          )}
        </TableCell>
        {guard === "inspect_tools" && r.matcher.kind === "regex" ? (
          // 工具调用的正则又长又密：照写，悬停看全
          <TableCell className="truncate font-mono tw-label text-muted-foreground" title={pattern}>
            {pattern}
          </TableCell>
        ) : (
          <TableCell className="truncate text-muted-foreground">
            <RuleMatchText r={r} />
          </TableCell>
        )}
        {guard === "content" && (
          <TableCell>
            <span className="flex gap-1">
              {scopeOf(r).map((s) => (
                <Badge key={s} variant="outline">
                  {lt.directions[s]}
                </Badge>
              ))}
            </span>
          </TableCell>
        )}
        <TableCell {...stop}>
          <ActionCell guard={guard} mode={mode} r={r} name={name} actions={actions} />
        </TableCell>
        <TableCell className="text-right" {...stop}>
          <RowMenuButton items={items} label={t.actionsFor(name)} />
        </TableCell>
      </TableRow>
    </RowMenu>
  );
}

/**
 * 动作那一格：就地改的选择。**防护处于「监控」时照写用户设的动作**，后面淡色标「监控中」 ——
 * 实际只记录，切回「开启」就按这里的动作处理。查回答的内容规则不能选「拒绝」（选项置灰）
 */
function ActionCell({
  guard,
  mode,
  r,
  name,
  actions,
}: {
  guard: Guard;
  mode: GuardMode;
  r: SecurityRuleView;
  name: string;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const action = actionOf(guard, r);
  const scope = scopeChoice(scopeOf(r));
  const hard = action === "cut" || action === "block";
  const soft = action === "record";
  const label = (a: RuleAction) =>
    a === "replace" ? t.replaceWith(clipped(r.replacement ?? DEFAULT_REPLACEMENT)) : (lt.ruleActions[a] ?? a);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <NativeSelect
        size="inline"
        className={cn(
          "min-w-0 shrink",
          hard ? "text-destructive" : soft ? "text-muted-foreground" : "text-foreground",
        )}
        value={action}
        disabled={actions.pending(r)}
        aria-label={t.actionFor(name)}
        onChange={(e) => actions.setAction(r, e.target.value as RuleAction)}
      >
        {ACTIONS[guard].map((a) => (
          <NativeSelectOption key={a} value={a} disabled={!actionAllowed(guard, a, scope)}>
            {label(a)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {mode === "observe" && (
        <span className="shrink-0 tw-label text-muted-foreground">{lt.monitoring}</span>
      )}
    </span>
  );
}

/** 行内选项里的替换文字：太长的截一截，全文在对话框里 */
function clipped(s: string): string {
  return [...s].length > 12 ? `${[...s].slice(0, 12).join("")}…` : s;
}
