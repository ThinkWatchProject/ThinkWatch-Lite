import { Fragment } from "react";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Switch } from "@/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Segmented } from "@/ui/segmented";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { Guard, GuardDetail, RuleGuard, SecurityRuleView } from "@/types";
import { hasAction, hasCustom, type ActionGuard } from "./api";
import { Code, MatcherText, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { guardTabText } from "./GuardTab.i18n";

export type Mode = "off" | "observe" | "enforce";
const MODES: Mode[] = ["off", "observe", "enforce"];
export const asMode = (s: string): Mode => ((MODES as string[]).includes(s) ? (s as Mode) : "observe");

/** 规则表上能做的事。**都由页面接住** —— 它们要写配置、要开对话框 */
export interface RuleActions {
  mode: (mode: Mode) => void;
  toggle: (r: SecurityRuleView, enabled: boolean) => void;
  /** 内置规则：只读查看；自定义规则：编辑 */
  open: (r: SecurityRuleView) => void;
  /** 复制成自定义规则。只有写得出等价写法的那几项有 */
  copy?: (r: SecurityRuleView) => void;
  remove: (r: SecurityRuleView) => void;
  create: () => void;
  test: () => void;
}

/**
 * 一项防护的档位。「当前」一句随档变，「切换到拦截后」一句把代价说在切之前。
 */
export function ModeCard({
  guard,
  mode,
  busy,
  onMode,
}: {
  guard: Guard;
  mode: Mode;
  busy: boolean;
  onMode: (mode: Mode) => void;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const copy = t[guard];
  return (
    <section className="rounded-lg border border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="tw-body font-medium">{copy.lead}</p>
        <div className="flex-1" />
        <Segmented<Mode>
          label={t.modeFor(lt.guards[guard])}
          value={mode}
          disabled={busy}
          options={MODES.map((m) => ({ id: m, label: lt.modes[m] }))}
          onChange={(v) => v !== mode && onMode(v)}
        />
      </div>
      <p className="mt-2 tw-body">{copy.now[mode]}</p>
      <p className="mt-0.5 tw-label text-muted-foreground">
        {mode === "enforce" ? copy.risk : t.ifEnforced(copy.effect, copy.risk)}
      </p>
    </section>
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
 * 每次改动由 core 写成一个配置版本。
 */
export function GuardTab({
  guard,
  detail,
  busy,
  actions,
}: {
  guard: RuleGuard;
  detail: GuardDetail;
  busy: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const on = detail.rules.filter((r) => r.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      <ModeCard guard={guard} mode={asMode(detail.mode)} busy={busy} onMode={actions.mode} />

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="tw-head">{t.rules}</h3>
          <span className="tw-label tabular-nums text-muted-foreground">
            {t.ruleCount(on, detail.rules.length)}
          </span>
          <div className="flex-1" />
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
        </div>

        {guard === "redact" ? (
          <RedactRules rules={detail.rules} busy={busy} actions={actions} />
        ) : guard === "hidden_text" ? (
          <HiddenRules rules={detail.rules} busy={busy} actions={actions} />
        ) : (
          <ActionRules guard={guard} rules={detail.rules} busy={busy} actions={actions} />
        )}
      </section>
    </div>
  );
}

/** 行菜单：内置的查看或编辑、复制；自定义的编辑、删除 */
function useMenu(guard: RuleGuard, actions: RuleActions) {
  const t = useText(guardTabText);
  const common = useText(commonText);
  return (r: SecurityRuleView): MenuItems => {
    if (r.custom)
      return [
        { kind: "item", label: common.edit, onSelect: () => actions.open(r) },
        { kind: "sep" },
        { kind: "item", label: common.delete, onSelect: () => actions.remove(r), danger: true },
      ];
    // 出站脱敏、隐藏字符的内置规则只能启停，也写不出等价的自定义规则
    if (!hasAction(guard)) return [{ kind: "item", label: t.view, onSelect: () => actions.open(r) }];
    const copy = actions.copy;
    return [
      // 内置的工具调用和内容规则能改拦截时的处置，所以是「编辑」不是「查看」
      { kind: "item", label: common.edit, onSelect: () => actions.open(r) },
      ...(copy ? [{ kind: "item" as const, label: t.copyAsCustom, onSelect: () => copy(r) }] : []),
    ];
  };
}

/** 按顺序把规则分成几段，每段一个标题。core 给的顺序就是界面的顺序 */
function groups<K extends string>(rules: SecurityRuleView[], key: (r: SecurityRuleView) => K) {
  const out: { key: K; rules: SecurityRuleView[] }[] = [];
  for (const r of rules) {
    const k = key(r);
    const last = out[out.length - 1];
    if (last && last.key === k) last.rules.push(r);
    else out.push({ key: k, rules: [r] });
  }
  return out;
}

function GroupRow({ label, n, span }: { label: string; n: number; span: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={span} className="bg-muted/40 py-1 tw-label text-muted-foreground">
        {label}
        {n > 1 && <span className="ml-1.5 tabular-nums">{n}</span>}
      </TableCell>
    </TableRow>
  );
}

function RuleSwitch({
  r,
  name,
  busy,
  actions,
}: {
  r: SecurityRuleView;
  name: string;
  busy: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  return (
    <Switch
      size="sm"
      checked={r.enabled}
      disabled={busy}
      aria-label={t.toggleFor(name)}
      onCheckedChange={(v) => actions.toggle(r, v)}
    />
  );
}

function RedactRules({
  rules,
  busy,
  actions,
}: {
  rules: SecurityRuleView[];
  busy: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const menu = useMenu("redact", actions);
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
        {groups(rules, (r) => r.kind).map((g) => (
          <Fragment key={g.key}>
            <GroupRow label={lt.kinds[g.key] ?? g.key} n={g.rules.length} span={4} />
            {g.rules.map((r) => {
              const items = menu(r);
              const name = viewName("redact", r);
              return (
                <RowMenu key={`${r.custom ? "c" : "b"}:${r.id}`} items={items}>
                  <TableRow className="cursor-default" onDoubleClick={() => actions.open(r)}>
                    <TableCell className={"truncate " + (r.enabled ? "" : "text-muted-foreground")}>
                      {name}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      <MatcherText m={r.matcher} />
                    </TableCell>
                    <TableCell className="text-right" onDoubleClick={(e) => e.stopPropagation()}>
                      <RuleSwitch r={r} name={name} busy={busy} actions={actions} />
                    </TableCell>
                    <TableCell className="text-right" onDoubleClick={(e) => e.stopPropagation()}>
                      <RowMenuButton items={items} label={t.actionsFor(name)} />
                    </TableCell>
                  </TableRow>
                </RowMenu>
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
function ActionRules({
  guard,
  rules,
  busy,
  actions,
}: {
  guard: ActionGuard;
  rules: SecurityRuleView[];
  busy: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const menu = useMenu(guard, actions);
  const content = guard === "content";
  const key = (r: SecurityRuleView) => (r.custom ? "custom" : content ? r.kind : "builtin");
  return (
    <Table className="table-fixed min-w-[640px]">
      <colgroup>
        <col className="w-[230px]" />
        <col />
        <col className="w-[76px]" />
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
        {groups(rules, key).map((g) => (
          <Fragment key={g.key}>
            <GroupRow
              label={g.key === "builtin" ? t.builtinGroup : (lt.kinds[g.key] ?? g.key)}
              n={g.rules.length}
              span={5}
            />
            {g.rules.map((r) => {
              const items = menu(r);
              const name = viewName(guard, r);
              const why = ruleWhy(r);
              const pattern = r.matcher.kind === "regex" ? r.matcher.pattern : "";
              const hard = r.action === "cut" || r.action === "block";
              return (
                <RowMenu key={`${r.custom ? "c" : "b"}:${r.id}`} items={items}>
                  <TableRow className="cursor-default" onDoubleClick={() => actions.open(r)}>
                    <TableCell className="py-2">
                      <div className={"truncate " + (r.enabled ? "" : "text-muted-foreground")}>{name}</div>
                      {why && <div className="truncate tw-label text-muted-foreground">{why}</div>}
                    </TableCell>
                    {content ? (
                      <TableCell className="truncate text-muted-foreground">
                        {/* 表里只写那段文字；「不区分大小写」对每一条都一样，在对话框里说 */}
                        {r.matcher.kind === "contains" ? (
                          <Code>{r.matcher.text}</Code>
                        ) : (
                          <MatcherText m={r.matcher} />
                        )}
                      </TableCell>
                    ) : (
                      <TableCell className="truncate font-mono tw-label" title={pattern}>
                        {pattern}
                      </TableCell>
                    )}
                    <TableCell className={hard ? "text-destructive" : "text-muted-foreground"}>
                      {lt.ruleActions[r.action ?? "record"] ?? r.action}
                    </TableCell>
                    <TableCell className="text-right" onDoubleClick={(e) => e.stopPropagation()}>
                      <RuleSwitch r={r} name={name} busy={busy} actions={actions} />
                    </TableCell>
                    <TableCell className="text-right" onDoubleClick={(e) => e.stopPropagation()}>
                      <RowMenuButton items={items} label={t.actionsFor(name)} />
                    </TableCell>
                  </TableRow>
                </RowMenu>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

/** 隐藏字符：那两种字符，各是哪几段码位、为什么值得查 */
function HiddenRules({
  rules,
  busy,
  actions,
}: {
  rules: SecurityRuleView[];
  busy: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const menu = useMenu("hidden_text", actions);
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
        {rules.map((r) => {
          const items = menu(r);
          const name = viewName("hidden_text", r);
          const ranges = r.matcher.kind === "codepoints" ? r.matcher.ranges : [];
          return (
            <RowMenu key={r.id} items={items}>
              <TableRow className="cursor-default" onDoubleClick={() => actions.open(r)}>
                <TableCell className="py-2">
                  <div className={"truncate " + (r.enabled ? "" : "text-muted-foreground")}>{name}</div>
                  <div className="truncate tw-label text-muted-foreground" title={ruleWhy(r)}>
                    {ruleWhy(r)}
                  </div>
                </TableCell>
                <TableCell className="truncate font-mono tw-label text-muted-foreground">
                  {ranges.join(", ")}
                </TableCell>
                <TableCell className="text-right" onDoubleClick={(e) => e.stopPropagation()}>
                  <RuleSwitch r={r} name={name} busy={busy} actions={actions} />
                </TableCell>
                <TableCell className="text-right" onDoubleClick={(e) => e.stopPropagation()}>
                  <RowMenuButton items={items} label={t.actionsFor(name)} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}
