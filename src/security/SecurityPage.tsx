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
import {
  GUARDS,
  type ConfigWritten,
  type Guard,
  type GuardMode,
  type SecurityDetail,
  type SecurityRuleView,
} from "@/types";
import { api, hasAction, type RuleSave } from "./api";
import { GuardSkeleton, GuardTab, type RuleActions } from "./GuardTab";
import { modeName, modeTone, OUTCOMES, outcomeTone, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { LogTab, type LogActions } from "./LogTab";
import { BuiltinRuleDialog, DeleteRuleDialog, patternOf, RuleDialog, TestDialog, type RuleSeed } from "./RuleDialog";
import { securityPageText } from "./SecurityPage.i18n";
import { useSecurityLog, type SecurityLog } from "./useSecurityLog";
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

/** 自定义规则现在的样子，改一处（启停）时原样带回去 */
function saveOf(guard: Guard, r: SecurityRuleView, enabled: boolean): RuleSave {
  const written = patternOf(r);
  return {
    name: r.id,
    pattern: written?.pattern ?? "",
    action: r.action ?? undefined,
    match: guard === "content" ? written?.match : undefined,
    label: guard === "redact" ? (r.label ?? undefined) : undefined,
    enabled,
  };
}

/** 同一条规则：内置和自定义可以同名 */
const same = (a: SecurityRuleView, b: SecurityRuleView) => a.id === b.id && a.custom === b.custom;
const ruleKey = (guard: Guard, r: SecurityRuleView) => `${guard}/${r.custom ? "c" : "b"}/${r.id}`;

/**
 * 安全页：日志，以及三项防护 —— 出站脱敏、工具调用审查、内容过滤。出站脱敏管
 * 发出去的凭据和个人信息，工具调用审查管回来的工具调用，内容过滤管调用方发来的
 * 正文（隐藏字符是它的一组内置规则）。
 *
 * **各项防护都是全局的。**档位和规则对所有上游、所有密钥一样，上游、路由、
 * 密钥上没有任何安全设置。MCP 服务器、技能、钩子这些客户端配置的检查在
 * MCP 页，不在这里：这一页只管经过网关的请求。
 *
 * 页头一行是全貌：几项在第三档（各项叫法不同，页头统称「处置」）、几项在观察、
 * 几项关着（状态点和标签上的同色），以及日志那段时间里一共命中了几次、各做了
 * 什么。日志在第一个标签：开着一项防护却不知道它查到了什么，等于没开。
 *
 * **改动先画出来再写**：启停规则、换档都是先改界面，写完给一个带「撤销」的
 * 提示；几处连着改时一个接一个写（每一次写都要带上一次写完的版本号）。
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
  const log = useSecurityLog(range, tick);
  const [dialog, setDialog] = useState<DialogState>(null);

  /*
    从概览跳过来：落到日志，带上区间。**`at` 每次都不同**，同一个计数
    连点两次也会把页面拨回来。
  */
  useEffect(() => {
    if (!focus) return;
    setTab("log");
    setRange(focus.range);
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

  /** 正在写的开关和档位。开关画成「进行中」，档位旁边转一个圈 */
  const [pending, setPending] = useState<Record<string, number>>({});
  async function tracked<T>(key: string, run: () => Promise<T>): Promise<T> {
    setPending((p) => ({ ...p, [key]: (p[key] ?? 0) + 1 }));
    try {
      return await run();
    } finally {
      setPending((p) => ({ ...p, [key]: Math.max(0, (p[key] ?? 0) - 1) }));
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

  /** 换档。可撤销：切到第三档会改变请求的结局，切错了要能一下回去 */
  function setMode(guard: Guard, mode: GuardMode) {
    const before = detail.data?.[guard].mode;
    if (!before || before === mode) return;
    const send = (m: GuardMode) => tracked(`mode/${guard}`, () => write((base) => api.setMode(guard, m, base)));
    void undoable({
      message: t.modeSet(lt.guards[guard], modeName(guard, mode)),
      apply: () => detail.mutate((d) => ({ ...d!, [guard]: { ...d![guard], mode } })),
      do: () => send(mode),
      undo: () => send(before),
      after: settle,
    });
  }

  const actions = (guard: Guard): RuleActions => ({
    mode: (mode) => setMode(guard, mode),
    toggle: (r, enabled) => toggle(guard, r, enabled),
    pending: (r) => busy(ruleKey(guard, r)),
    open: (r) =>
      setDialog(r.custom ? { kind: "rule", guard, editing: r } : { kind: "builtin", guard, rule: r }),
    // 内置规则只有工具调用和内容规则写得出等价的自定义规则（内容规则的码位也写得出）
    copy: hasAction(guard)
      ? (r) => {
          const written = patternOf(r);
          setDialog({
            kind: "rule",
            guard,
            editing: null,
            seed: {
              name: viewName(guard, r),
              pattern: written?.pattern ?? "",
              match: written?.match,
              action: r.action ?? undefined,
            },
          });
        }
      : undefined,
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
          summary={<Summary detail={d} loading={detail.loading} log={log} range={range} />}
          tabs={
            <TabsList variant="line">
              <TabsTrigger value="log">{t.log}</TabsTrigger>
              {GUARDS.map((g) => (
                <TabsTrigger key={g} value={g}>
                  {t.tabs[g]}
                  {d && <StatusDot tone={modeTone(d[g].mode)} label={modeName(g, d[g].mode)} />}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />

        {/* 有防护停在「观察」：说一句确认没有误报之后可以切到第三档 */}
        <ObserveHint count={d ? GUARDS.filter((g) => d[g].mode === "observe").length : 0} className="mt-4" />

        <TabsContent value="log" className="pt-4">
          <LogTab log={log} range={range} onRange={setRange} detail={d} actions={logActions} />
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
          onSaveAction={async (a) => {
            const g = dialog.guard;
            if (!hasAction(g)) return;
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
