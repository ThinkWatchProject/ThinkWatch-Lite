import { Fragment } from "react";
import { FlaskConicalIcon, PlusIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Switch } from "@/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { Guard, GuardDetail, SecurityRuleView } from "@/types";
import { Code, MatcherText, ruleWhy, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { guardTabText } from "./GuardTab.i18n";

type Mode = "off" | "observe" | "enforce";
const MODES: Mode[] = ["off", "observe", "enforce"];

/** 规则表上能做的事。**都由页面接住** —— 它们要写配置、要开对话框 */
export interface RuleActions {
  mode: (mode: Mode) => void;
  toggle: (r: SecurityRuleView, enabled: boolean) => void;
  /** 内置规则：只读查看；自定义规则：编辑 */
  open: (r: SecurityRuleView) => void;
  copy: (r: SecurityRuleView) => void;
  remove: (r: SecurityRuleView) => void;
  create: () => void;
  test: () => void;
}

/**
 * 一项防护：上面是档位，下面是全部规则。
 *
 * **档位和规则都是全局的**，对所有上游、所有密钥一样。这一页没有「按上游」
 * 的任何设置 —— 同一个请求走哪家，不该决定它里面的密钥会不会被换掉。
 *
 * 内置规则只能启停，改写法要先复制成自定义规则；自定义规则在对话框里改。
 * 每次改动由 core 写成一个配置版本。
 */
export function GuardTab({
  guard,
  detail,
  busy,
  actions,
}: {
  guard: Guard;
  detail: GuardDetail;
  busy: boolean;
  actions: RuleActions;
}) {
  const t = useText(guardTabText);
  const lt = useText(securityLabelsText);
  const copy = t[guard];
  const mode = (MODES as string[]).includes(detail.mode) ? (detail.mode as Mode) : "observe";
  const on = detail.rules.filter((r) => r.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      {/* 档位。「当前」一句随档变，「切换到拦截后」一句把代价说在切之前 */}
      <section className="rounded-lg border border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="tw-body font-medium">{copy.lead}</p>
          <div className="flex-1" />
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            disabled={busy}
            aria-label={t.modeFor(lt.guards[guard])}
            onValueChange={(v) => v && v !== mode && actions.mode(v as Mode)}
          >
            {MODES.map((m) => (
              <ToggleGroupItem key={m} value={m}>
                {lt.modes[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <p className="mt-2 tw-body">{copy.now[mode]}</p>
        <p className="mt-0.5 tw-label text-muted-foreground">
          {mode === "enforce" ? copy.risk : t.ifEnforced(copy.effect, copy.risk)}
        </p>
      </section>

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
          <Button size="sm" onClick={actions.create}>
            <PlusIcon />
            {t.newRule}
          </Button>
        </div>

        {detail.unknown && detail.unknown.length > 0 && (
          <Alert variant="warning" className="px-3 py-2">
            <AlertDescription>
              {t.unknown(
                detail.unknown.map((id, i) => (
                  <Fragment key={id}>
                    {i > 0 && t.listSep}
                    <Code>{id}</Code>
                  </Fragment>
                )),
              )}
            </AlertDescription>
          </Alert>
        )}

        {guard === "redact" ? (
          <RedactRules rules={detail.rules} busy={busy} actions={actions} />
        ) : (
          <ToolRules rules={detail.rules} busy={busy} actions={actions} />
        )}
      </section>
    </div>
  );
}

/** 行菜单：内置的只读查看、复制；自定义的编辑、删除 */
function useMenu(guard: Guard, actions: RuleActions) {
  const t = useText(guardTabText);
  const common = useText(commonText);
  return (r: SecurityRuleView): MenuItems =>
    r.custom
      ? [
          { kind: "item", label: common.edit, onSelect: () => actions.open(r) },
          { kind: "sep" },
          { kind: "item", label: common.delete, onSelect: () => actions.remove(r), danger: true },
        ]
      : [
          { kind: "item", label: t.view, onSelect: () => actions.open(r) },
          // 出站脱敏的内置规则不是一条正则，复制过去写不出等价的写法
          ...(guard === "inspect_tools"
            ? [{ kind: "item" as const, label: t.copyAsCustom, onSelect: () => actions.copy(r) }]
            : []),
        ];
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

function ToolRules({
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
  const menu = useMenu("inspect_tools", actions);
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
          <TableHead>{t.regex}</TableHead>
          <TableHead>{t.whenEnforced}</TableHead>
          <TableHead className="text-right">{t.enabled}</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups(rules, (r) => (r.custom ? "custom" : "builtin")).map((g) => (
          <Fragment key={g.key}>
            <GroupRow
              label={g.key === "custom" ? lt.custom : t.builtinGroup}
              n={g.rules.length}
              span={5}
            />
            {g.rules.map((r) => {
              const items = menu(r);
              const name = viewName("inspect_tools", r);
              const why = ruleWhy(r);
              const pattern = r.matcher.kind === "regex" ? r.matcher.pattern : "";
              return (
                <RowMenu key={`${r.custom ? "c" : "b"}:${r.id}`} items={items}>
                  <TableRow className="cursor-default" onDoubleClick={() => actions.open(r)}>
                    <TableCell className="py-2">
                      <div className={"truncate " + (r.enabled ? "" : "text-muted-foreground")}>{name}</div>
                      {why && <div className="truncate tw-label text-muted-foreground">{why}</div>}
                    </TableCell>
                    <TableCell className="truncate font-mono tw-label" title={pattern}>
                      {pattern}
                    </TableCell>
                    <TableCell className={r.action === "cut" ? "text-destructive" : "text-muted-foreground"}>
                      {lt.ruleActions[r.action ?? "record"]}
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
