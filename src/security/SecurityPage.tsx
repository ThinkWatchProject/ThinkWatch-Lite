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
  type RuleGuard,
  type SecurityDetail,
  type SecurityRuleView,
} from "@/types";
import { api, hasAction, hasCustom, type CustomGuard, type RuleSave } from "./api";
import { GuardSkeleton, GuardTab, type RuleActions } from "./GuardTab";
import { modeTone, viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { LogTab, type LogActions } from "./LogTab";
import { OutputLimitTab } from "./OutputLimitTab";
import { BuiltinRuleDialog, DeleteRuleDialog, patternOf, RuleDialog, TestDialog, type RuleSeed } from "./RuleDialog";
import { securityPageText } from "./SecurityPage.i18n";
import { useSecurityLog, type SecurityLog } from "./useSecurityLog";

export type SecurityTab = "log" | Guard;

/** 从别处跳进日志时带着的：看哪段时间 */
export interface LogFocus {
  range: Range;
  /** 每跳一次都不一样 —— 同样的参数再点一次，也要把页面拨回日志 */
  at: number;
}

type DialogState =
  | null
  | { kind: "rule"; guard: CustomGuard; editing: SecurityRuleView | null; seed?: RuleSeed }
  | { kind: "builtin"; guard: RuleGuard; rule: SecurityRuleView }
  | { kind: "test"; guard: RuleGuard }
  | { kind: "delete"; guard: CustomGuard; rule: SecurityRuleView };

/** 自定义规则现在的样子，改一处（启停）时原样带回去 */
function saveOf(guard: CustomGuard, r: SecurityRuleView, enabled: boolean): RuleSave {
  const written = patternOf(r);
  return {
    name: r.id,
    pattern: written?.pattern ?? "",
    action: r.action ?? undefined,
    match: guard === "content" ? written?.match : undefined,
    enabled,
  };
}

/** 同一条规则：内置和自定义可以同名 */
const same = (a: SecurityRuleView, b: SecurityRuleView) => a.id === b.id && a.custom === b.custom;
const ruleKey = (guard: RuleGuard, r: SecurityRuleView) => `${guard}/${r.custom ? "c" : "b"}/${r.id}`;

/**
 * 安全页：日志，以及五项防护 —— 出站脱敏、工具调用审查、隐藏字符、内容过滤、
 * 输出长度。前两项管发出去的凭据和回来的工具调用，隐藏字符和内容过滤管调用方
 * 发来的正文，输出长度管回答有多长。
 *
 * **各项防护都是全局的。**档位和规则对所有上游、所有密钥一样，上游、路由、
 * 密钥上没有任何安全设置。MCP 服务器、技能、钩子这些客户端配置的检查在
 * MCP 页，不在这里：这一页只管经过网关的请求。
 *
 * 页头一行是全貌：几项在拦截、几项在观察、几项关着（状态点和标签上的同色），
 * 以及日志那段时间里命中了几次。日志在第一个标签：开着一项防护却不知道它查到
 * 了什么，等于没开。
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
  const detail = useResource<SecurityDetail>("security", () => api.detail(), { deps: [configVersion] });
  // 日志的区间放在这一层：页头的命中次数和日志是同一份
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

  const find = (guard: RuleGuard, id: string, custom: boolean) =>
    detail.data?.[guard].rules.find((r) => r.id === id && r.custom === custom);

  function sendRule(guard: RuleGuard, r: SecurityRuleView, enabled: boolean) {
    return tracked(ruleKey(guard, r), () =>
      write((base) =>
        r.custom && hasCustom(guard)
          ? api.updateRule(guard, r.id, { ...saveOf(guard, r, enabled), base_version: base })
          : api.toggleBuiltin(guard, r.id, enabled, base),
      ),
    );
  }

  /** 启用、停用一条规则。可撤销：先拨过去，写完给「撤销」 */
  function toggle(guard: RuleGuard, r: SecurityRuleView, enabled: boolean) {
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

  /** 换档。可撤销：切到拦截会改变请求的结局，切错了要能一下回去 */
  function setMode(guard: Guard, mode: GuardMode) {
    const before = detail.data?.[guard].mode;
    if (!before || before === mode) return;
    const send = (m: GuardMode) => tracked(`mode/${guard}`, () => write((base) => api.setMode(guard, m, base)));
    void undoable({
      message: t.modeSet(lt.guards[guard], lt.modes[mode] ?? mode),
      apply: () => detail.mutate((d) => ({ ...d!, [guard]: { ...d![guard], mode } })),
      do: () => send(mode),
      undo: () => send(before),
      after: settle,
    });
  }

  const actions = (guard: RuleGuard): RuleActions => ({
    mode: (mode) => setMode(guard, mode),
    toggle: (r, enabled) => toggle(guard, r, enabled),
    pending: (r) => busy(ruleKey(guard, r)),
    open: (r) =>
      setDialog(
        r.custom && hasCustom(guard)
          ? { kind: "rule", guard, editing: r }
          : { kind: "builtin", guard, rule: r },
      ),
    // 内置规则只有工具调用和内容规则写得出等价的自定义规则
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
    remove: (r) => hasCustom(guard) && setDialog({ kind: "delete", guard, rule: r }),
    create: () => hasCustom(guard) && setDialog({ kind: "rule", guard, editing: null }),
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
  async function saveRule(guard: CustomGuard, editing: SecurityRuleView | null, save: RuleSave) {
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
  const copyOf = (guard: RuleGuard, r: SecurityRuleView) => {
    const copy = actions(guard).copy;
    return copy && (() => copy(r));
  };

  const d = detail.data;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as SecurityTab)} className="gap-0">
      <Page>
        <PageHeader
          title={t.title}
          summary={<Summary detail={d} loading={detail.loading} log={log} range={range} />}
          tabs={
            <TabsList variant="line">
              <TabsTrigger value="log">{t.log}</TabsTrigger>
              {GUARDS.map((g) => (
                <TabsTrigger key={g} value={g}>
                  {t.tabs[g]}
                  {d && <StatusDot tone={modeTone(d[g].mode)} label={lt.modes[d[g].mode]} />}
                </TabsTrigger>
              ))}
            </TabsList>
          }
        />

        <TabsContent value="log" className="pt-4">
          <LogTab log={log} range={range} onRange={setRange} detail={d} actions={logActions} />
        </TabsContent>

        {GUARDS.map((g) => (
          <TabsContent key={g} value={g} className="pt-4">
            <Loadable
              r={detail}
              loading={<GuardSkeleton rules={g !== "output_limit"} />}
              errorTitle={t.loadFailed}
            >
              {(data) =>
                g === "output_limit" ? (
                  <OutputLimitTab
                    detail={data.output_limit}
                    modePending={busy(`mode/${g}`)}
                    onMode={(mode) => setMode(g, mode)}
                    onSaveLimit={async (max) => {
                      await write((base) => api.setLimit(max, base));
                      onChanged();
                      await detail.reload();
                    }}
                  />
                ) : (
                  <GuardTab guard={g} detail={data[g]} modePending={busy(`mode/${g}`)} actions={actions(g)} />
                )
              }
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
 * 页头的一行：几项防护各在哪一档（和标签上的点同色），日志那段时间里命中了
 * 几次。命中次数就是日志读到的条数；读到的是前若干条时写「100+」，不估。
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
  return (
    <>
      {detail &&
        (["enforce", "observe", "off"] as const)
          .filter((m) => counts[m] > 0)
          .map((m) => (
            <SummaryItem key={m} lead={<StatusDot tone={modeTone(m)} />} value={counts[m]} label={t.modes[m]} />
          ))}
      {detail && page && <span aria-hidden className="h-3 w-px bg-border" />}
      {page && (
        // 不能是 flex：flex 会吞掉数字两边的空格
        <span className="whitespace-nowrap">
          {t.hits(
            <AnimatedNumber
              value={page.events.length}
              scope={log.scope}
              format={(n) => `${Math.round(n)}${page.more ? "+" : ""}`}
              className="font-medium text-foreground"
            />,
            range.label,
            range.custom === true,
          )}
        </span>
      )}
    </>
  );
}
