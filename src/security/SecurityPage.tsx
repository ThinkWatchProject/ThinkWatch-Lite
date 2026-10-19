import { useCallback, useEffect, useRef, useState } from "react";
import { useResource } from "@/lib/resource";
import { AnimatedNumber } from "@/ui/motion";
import { notify, undoable } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { useRange, type Range } from "@/ui/range";
import { Skeleton } from "@/ui/skeleton";
import { Loadable } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { useText } from "@/i18n";
import { GUARDS } from "@/types";
import { api, type RuleSave } from "./api";
import type { ConfigWritten, Guard, GuardMode, RuleAction, SecurityDetail, SecurityRuleView } from "@/types";
import { actionOf, scopeOf } from "./rules";
import { GuardSkeleton, GuardTab, type RuleActions } from "./GuardTab";
import { modeName, modeTone, OUTCOMES, outcomeTone, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { LogTab, type LogActions } from "./LogTab";
import { BuiltinRuleDialog, DeleteRuleDialog, patternOf, RuleDialog, TestDialog, type RuleSeed } from "./RuleDialog";
import { securityPageText } from "./SecurityPage.i18n";
import { narrowed, useSecurityLog, type SecurityLog } from "./useSecurityLog";
import { ObserveHint } from "@/guide/PageHints";

export type SecurityTab = "log" | Guard;

/** 从别处跳进日志时带着的：看哪段时间 */
export interface LogFocus {
  range: Range;
  /** 每跳一次都不一样 —— 同样的参数再点一次，也要把页面拨回日志 */
  at: number;
}

type DialogState =
  | null
  | { kind: "rule"; guard: Guard; editing: SecurityRuleView | null; seed?: RuleSeed }
  | { kind: "builtin"; guard: Guard; rule: SecurityRuleView }
  | { kind: "test"; guard: Guard }
  | { kind: "delete"; guard: Guard; rule: SecurityRuleView };

/** 自定义规则现在的样子，改一处（启停、动作）时其余原样带回去 */
function saveOf(guard: Guard, r: SecurityRuleView, enabled: boolean, action = actionOf(guard, r)): RuleSave {
  const written = patternOf(r);
  // 工具调用的自定义规则只有正则一种写法，不带怎么认、分不分大小写
  const choosable = guard !== "inspect_tools";
  return {
    name: r.id,
    pattern: written?.pattern ?? "",
    action,
    match: choosable ? written?.match : undefined,
    case_sensitive: choosable && written?.match !== "codepoints" ? written?.cased : undefined,
    label: guard === "redact" ? (r.label ?? undefined) : undefined,
    scope: guard === "content" ? scopeOf(r) : undefined,
    replacement: guard === "content" ? (r.replacement ?? undefined) : undefined,
    enabled,
  };
}

/** 同一条规则：内置和自定义可以同名 */
const same = (a: SecurityRuleView, b: SecurityRuleView) => a.id === b.id && a.custom === b.custom;
const ruleKey = (guard: Guard, r: SecurityRuleView) => `${guard}/${r.custom ? "c" : "b"}/${r.id}`;

/**
 * 安全页：日志，以及三项防护 —— 密钥与隐私、危险命令、内容过滤。密钥与隐私管
 * 发出去的凭据和个人信息，危险命令管回答里的工具调用，内容过滤管请求和回答的正文
 * （每条规则自己定查哪一边；隐藏字符是它的一组内置规则）。
 *
 * **各项防护都是全局的。**档位和规则对所有上游、所有密钥一样，上游、路由、
 * 密钥上没有任何安全设置。MCP 服务器、技能、钩子这些客户端配置的检查在
 * MCP 页，不在这里：这一页只管经过网关的请求。
 *
 * 页头一行是全貌：几项开启、几项监控、几项关闭（状态点和页签上的同色），以及日志
 * 那段时间里一共命中了几次、各做了什么。日志在第一个页签：开着一项防护却不知道它查到
 * 了什么，等于没开。
 *
 * **改动先画出来再写**：启停规则（一条或一组）、改动作、换状态都是先改界面，写完给一个
 * 带「撤销」的提示；几处连着改时一个接一个写（每一次写都要带上一次写完的版本号）。
 */
export default function SecurityPage({
  configVersion,
  tick,
  focus,
  onChanged,
}: {
  configVersion: string;
  /** 库里多了请求就涨一次。日志跟着重读 */
  tick: number;
  /** 从概览点进来时带的筛选 */
  focus: LogFocus | null;
  onChanged: () => void;
}) {
  const t = useText(securityPageText);
  const lt = useText(securityLabelsText);
  const [tab, setTab] = useState<SecurityTab>("log");
  const detail = useResource<SecurityDetail>("security-detail", () => api.detail(), { deps: [configVersion] });
  // 日志的区间放在这一层：页头的命中次数和日志是同一次读取
  const [range, setRange] = useRange("tw-security-range", "1d");
  /** 日志「类型」列头上筛着的那一项。离开这一页就回到全部 */
  const [guard, setGuard] = useState<Guard | null>(null);
  /*
    **页头说的一直是全部类型**：它是整页的全貌，不跟着日志的筛选变。全部的那一份一直
    挂着，不筛时日志就用它（还是同一次读取）；筛着一类时另读那一类的
  */
  const all = useSecurityLog(range, tick);
  const only = useSecurityLog(range, tick, guard, guard === null);
  const log = guard === null ? all : narrowed(only, all, guard);
  const [dialog, setDialog] = useState<DialogState>(null);

  /*
    从概览跳过来：落到日志，带上区间。**`at` 每次都不同**，同一个计数
    连点两次也会把页面拨回来。
  */
  useEffect(() => {
    if (!focus) return;
    setTab("log");
    setRange(focus.range);
    // 概览上的数是全部类型的：点进来看到的条数要对得上
    setGuard(null);
  }, [focus, setRange]);

  /*
    **连着改几处时，一个接一个写，下一次带上一次写完的版本号。**只等
    config_reloaded 推过来的话，快手连点两个开关，第二下会撞上「配置已被修改」；
    同时发出去的话，两次带的是同一个旧版本号。
  */
  const version = useRef(configVersion);
  useEffect(() => {
    version.current = configVersion;
  }, [configVersion]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const write = useCallback((run: (base: string) => Promise<ConfigWritten>) => {
    const p = queue.current
      .then(() => run(version.current))
      .then((w) => {
        version.current = w.version;
        return w;
      });
    queue.current = p.catch(() => {});
    return p;
  }, []);

  /** 正在写的开关、动作和状态。开关画成「进行中」，状态旁边转一个圈。一组一起写时组内每一条都算 */
  const [pending, setPending] = useState<Record<string, number>>({});
  async function tracked<T>(keys: string | string[], run: () => Promise<T>): Promise<T> {
    const ks = typeof keys === "string" ? [keys] : keys;
    const bump = (d: number) =>
      setPending((p) => {
        const next = { ...p };
        for (const k of ks) next[k] = Math.max(0, (next[k] ?? 0) + d);
        return next;
      });
    bump(1);
    try {
      return await run();
    } finally {
      bump(-1);
    }
  }
  const busy = (key: string) => (pending[key] ?? 0) > 0;

  /** 写完（或者撤销完）：外壳重读概览，这一页重读规则 */
  const settle = () => {
    onChanged();
    void detail.reload();
  };

  const find = (guard: Guard, id: string, custom: boolean) =>
    detail.data?.[guard].rules.find((r) => r.id === id && r.custom === custom);

  function sendRule(guard: Guard, r: SecurityRuleView, enabled: boolean) {
    return tracked(ruleKey(guard, r), () =>
      write((base) =>
        r.custom
          ? api.updateRule(guard, r.id, { ...saveOf(guard, r, enabled), base_version: base })
          : api.toggleBuiltin(guard, r.id, enabled, base),
      ),
    );
  }

  /** 启用、停用一条规则。可撤销：先拨过去，写完给「撤销」 */
  function toggle(guard: Guard, r: SecurityRuleView, enabled: boolean) {
    const name = viewName(guard, r);
    void undoable({
      message: enabled ? t.ruleOn(name) : t.ruleOff(name),
      apply: () =>
        detail.mutate((d) => ({
          ...d!,
          [guard]: { ...d![guard], rules: d![guard].rules.map((x) => (same(x, r) ? { ...x, enabled } : x)) },
        })),
      do: () => sendRule(guard, r, enabled),
      undo: () => sendRule(guard, r, !enabled),
      after: settle,
    });
  }

  /** 行内改一条规则的动作。可撤销 */
  function setAction(guard: Guard, r: SecurityRuleView, action: RuleAction) {
    const before = actionOf(guard, r);
    if (before === action) return;
    const send = (a: RuleAction) =>
      tracked(ruleKey(guard, r), () =>
        write((base) =>
          r.custom
            ? api.updateRule(guard, r.id, { ...saveOf(guard, r, r.enabled, a), base_version: base })
            : api.setAction(guard, r.id, a, base),
        ),
      );
    void undoable({
      message: t.actionSet(viewName(guard, r), lt.ruleActions[action] ?? action),
      apply: () =>
        detail.mutate((d) => ({
          ...d!,
          [guard]: { ...d![guard], rules: d![guard].rules.map((x) => (same(x, r) ? { ...x, action } : x)) },
        })),
      do: () => send(action),
      undo: () => send(before),
      after: settle,
    });
  }

  /** 换状态。可撤销：切到「开启」会改变请求的结局，切错了要能一下回去 */
  function setMode(guard: Guard, mode: GuardMode) {
    const before = detail.data?.[guard].mode;
    if (!before || before === mode) return;
    const send = (m: GuardMode) => tracked(`mode/${guard}`, () => write((base) => api.setMode(guard, m, base)));
    void undoable({
      message: t.modeSet(lt.guards[guard], modeName(mode)),
      apply: () => detail.mutate((d) => ({ ...d!, [guard]: { ...d![guard], mode } })),
      do: () => send(mode),
      undo: () => send(before),
      after: settle,
    });
  }

  const actions = (guard: Guard): RuleActions => ({
    mode: (mode) => setMode(guard, mode),
    toggle: (r, enabled) => toggle(guard, r, enabled),
    setAction: (r, a) => setAction(guard, r, a),
    pending: (r) => busy(ruleKey(guard, r)),
    open: (r) =>
      setDialog(r.custom ? { kind: "rule", guard, editing: r } : { kind: "builtin", guard, rule: r }),
    // 写得出等价写法的内置规则（工具调用的正则、内容规则的文字和码位）可以复制成自定义规则
    copy: (r) => {
      const written = patternOf(r);
      setDialog({
        kind: "rule",
        guard,
        editing: null,
        seed: {
          name: viewName(guard, r),
          pattern: written?.pattern ?? "",
          match: written?.match,
          cased: written?.cased,
          action: r.action ?? undefined,
        },
      });
    },
    remove: (r) => setDialog({ kind: "delete", guard, rule: r }),
    create: () => setDialog({ kind: "rule", guard, editing: null }),
    test: () => setDialog({ kind: "test", guard }),
  });

  const logActions: LogActions = {
    viewRule: (guard, id, custom) => {
      const r = find(guard, id, custom);
      if (!r) return;
      setTab(guard);
      actions(guard).open(r);
    },
    disableRule: (guard, id, custom) => {
      const r = find(guard, id, custom);
      if (r) toggle(guard, r, false);
    },
    showGuard: (g) => setTab(g),
  };

  /** 自定义规则保存。**失败时对话框留着**，把 core 的话显示在里面 */
  async function saveRule(guard: Guard, editing: SecurityRuleView | null, save: RuleSave) {
    await write((base) =>
      editing
        ? api.updateRule(guard, editing.id, { ...save, base_version: base })
        : api.createRule(guard, { ...save, base_version: base }),
    );
    setDialog(null);
    // 新规则排在表的最后，多半在屏幕外：说一声。编辑的那一行就在眼前，不用说
    if (!editing) notify.success(t.ruleCreated(save.name));
    settle();
  }

  /** 内置规则对话框里的「复制为自定义规则」。写不出等价写法的不给 */
  const copyOf = (guard: Guard, r: SecurityRuleView) => {
    const copy = actions(guard).copy;
    return copy && patternOf(r) ? () => copy(r) : undefined;
  };

  const d = detail.data;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SecurityTab)} className="gap-0">
      <Page>
        <PageHeader
          summary={<Summary detail={d} loading={detail.loading} log={all} range={range} />}
          tabs={
            <TabsList variant="line">
              <TabsTrigger value="log">{t.log}</TabsTrigger>
              {GUARDS.map((g) => (
                <TabsTrigger key={g} value={g}>
                  {/* 名字前面的圆点是这一项的状态：开启绿、监控黄、关闭灰 */}
                  {d && <StatusDot tone={modeTone(d[g].mode)} label={modeName(d[g].mode)} />}
                  {lt.guards[g]}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />

        {/* 有防护处于「监控」：说一句确认没有误报之后可以开启 */}
        <ObserveHint count={d ? GUARDS.filter((g) => d[g].mode === "observe").length : 0} className="mt-4" />

        <TabsContent value="log" className="pt-4">
          <LogTab
            log={log}
            range={range}
            onRange={setRange}
            guard={guard}
            onGuard={setGuard}
            detail={d}
            actions={logActions}
          />
        </TabsContent>

        {GUARDS.map((g) => (
          <TabsContent key={g} value={g} className="pt-4">
            <Loadable r={detail} loading={<GuardSkeleton />} errorTitle={t.loadFailed}>
              {(data) => (
                <GuardTab guard={g} detail={data[g]} modePending={busy(`mode/${g}`)} actions={actions(g)} />
              )}
            </Loadable>
          </TabsContent>
        ))}
      </Page>

      {dialog?.kind === "rule" && (
        <RuleDialog
          guard={dialog.guard}
          editing={dialog.editing}
          seed={dialog.seed}
          mode={d?.[dialog.guard].mode ?? "observe"}
          taken={(d?.[dialog.guard].rules ?? [])
            .filter((r) => r.custom && r.id !== dialog.editing?.id)
            .map((r) => r.id)}
          onClose={() => setDialog(null)}
          onSave={(save) => saveRule(dialog.guard, dialog.editing, save)}
        />
      )}
      {dialog?.kind === "builtin" && (
        <BuiltinRuleDialog
          guard={dialog.guard}
          rule={dialog.rule}
          onClose={() => setDialog(null)}
          onCopy={copyOf(dialog.guard, dialog.rule)}
          mode={d?.[dialog.guard].mode ?? "observe"}
          onSaveAction={async (a) => {
            const g = dialog.guard;
            await write((base) => api.setAction(g, dialog.rule.id, a, base));
            setDialog(null);
            settle();
          }}
        />
      )}
      {dialog?.kind === "test" && <TestDialog guard={dialog.guard} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <DeleteRuleDialog
          name={dialog.rule.id}
          onClose={() => setDialog(null)}
          onDelete={async () => {
            await write((base) => api.deleteRule(dialog.guard, dialog.rule.id, base));
            setDialog(null);
            settle();
          }}
        />
      )}
    </Tabs>
  );
}

/**
 * 页头的一行：几项防护各在哪一档（和标签上的点同色）；日志那段时间里一共命中了
 * 几次、各做了什么（和日志「处置」一栏同色）。
 *
 * **条数是 core 按整段时间数的**（`total`、`by_outcome`），不是日志读到了几条：
 * 日志往下翻多少页，这几个数都不变；来了新记录、日志重读时跟着走。换了区间
 * 直接落到新值，不从旧区间的数滚过去（`scope`）。
 */
function Summary({
  detail,
  loading,
  log,
  range,
}: {
  detail: SecurityDetail | undefined;
  loading: boolean;
  log: SecurityLog;
  range: Range;
}) {
  const t = useText(securityPageText);
  const page = log.r.data;
  if (!detail && loading) return <Skeleton className="my-1 h-3 w-56 rounded-sm" />;
  const counts: Record<GuardMode, number> = { enforce: 0, observe: 0, off: 0 };
  if (detail) for (const g of GUARDS) counts[detail[g].mode] += 1;
  // 日志还在读（开页、换了没读过的区间）：先占住数字的位置；读不到时日志那里说
  const hits = page ? (
    // 总数和各做了什么是一句话：窗口窄、一行放不下时整句换到下一行，不从中间断开
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
      {/* 不能是 flex：flex 会吞掉数字两边的空格 */}
      <span className="whitespace-nowrap">
        {t.hits(
          page.total,
          <AnimatedNumber value={page.total} scope={log.scope} className="font-medium text-foreground" />,
          range.label,
          range.custom === true,
        )}
      </span>
      {OUTCOMES.filter((o) => page.by_outcome[o] > 0).map((o) => (
        <SummaryItem
          key={o}
          lead={<StatusDot tone={outcomeTone(o)} />}
          value={<AnimatedNumber value={page.by_outcome[o]} scope={log.scope} />}
          label={t.outcomes[o]}
        />
      ))}
    </span>
  ) : log.r.loading ? (
    <Skeleton className="my-1 h-3 w-40 rounded-sm" />
  ) : null;
  return (
    <>
      {detail &&
        (["enforce", "observe", "off"] as const)
          .filter((m) => counts[m] > 0)
          .map((m) => (
            <SummaryItem key={m} lead={<StatusDot tone={modeTone(m)} />} value={counts[m]} label={t.modes[m]} />
          ))}
      {detail && hits && <span aria-hidden className="h-3 w-px bg-border" />}
      {hits}
    </>
  );
}
