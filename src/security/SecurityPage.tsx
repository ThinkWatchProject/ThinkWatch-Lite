import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RangePicker, useRange, type Range } from "@/ui/range";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import type { ConfigWritten, Guard, SecurityDetail, SecurityRuleView } from "@/types";
import { DeleteDialog } from "@/upstreams/DeleteDialog";
import { api, type CustomRuleSave } from "./api";
import { GuardTab, type RuleActions } from "./GuardTab";
import { viewName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { LogTab } from "./LogTab";
import { BuiltinRuleDialog, RuleDialog, TestDialog, type RuleSeed } from "./RuleDialog";
import { ruleDialogText } from "./RuleDialog.i18n";
import { securityPageText } from "./SecurityPage.i18n";

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

const GUARDS: Guard[] = ["redact", "inspect_tools"];

/** 自定义规则现在的样子，改一处（启停）时原样带回去 */
function saveOf(r: SecurityRuleView, enabled: boolean): Omit<CustomRuleSave, "base_version"> {
  return {
    name: r.id,
    pattern: r.matcher.kind === "regex" ? r.matcher.pattern : "",
    action: r.action ?? undefined,
    enabled,
  };
}

/**
 * 安全页：日志，以及两项防护 —— 出站脱敏、工具调用审查。
 *
 * **两项防护都是全局的。**档位和规则对所有上游、所有密钥一样，上游、路由、
 * 密钥上没有任何安全设置。MCP 服务器、技能、钩子这些客户端配置的检查在
 * MCP 页，不在这里：这一页只管经过网关的请求。
 *
 * 日志在第一个标签：开着一项防护却不知道它查到了什么，等于没开。
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
  const rt = useText(ruleDialogText);
  const [tab, setTab] = useState<SecurityTab>("log");
  const [detail, setDetail] = useState<SecurityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  // 日志的区间和条数放在这一层：它们都在标签那一行上
  const [range, setRange] = useRange("tw-security-range", "1d");
  const [logCount, setLogCount] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDetail(await api.detail());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, configVersion]);

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
    **连着改几处时，下一次写带上一次写完的版本号。**只等 config_reloaded
    推过来的话，快手连点两个开关，第二下会撞上「配置已被修改」。
  */
  const version = useRef(configVersion);
  useEffect(() => {
    version.current = configVersion;
  }, [configVersion]);

  async function write(run: (base: string) => Promise<ConfigWritten>) {
    setBusy(true);
    try {
      const w = await run(version.current);
      version.current = w.version;
      onChanged();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      await reload();
      setBusy(false);
    }
  }

  /** 先在界面上改过来，再写。写失败时 `reload` 会把它改回去 */
  function patch(guard: Guard, f: (d: SecurityDetail[Guard]) => SecurityDetail[Guard]) {
    setDetail((d) => (d ? { ...d, [guard]: f(d[guard]) } : d));
  }

  const find = (guard: Guard, id: string, custom: boolean) =>
    detail?.[guard].rules.find((r) => r.id === id && (r.custom ?? false) === custom);

  function toggle(guard: Guard, r: SecurityRuleView, enabled: boolean) {
    patch(guard, (g) => ({
      ...g,
      rules: g.rules.map((x) => (x === r ? { ...x, enabled } : x)),
    }));
    void write((base) =>
      r.custom
        ? api.updateRule(guard, r.id, { ...saveOf(r, enabled), base_version: base })
        : api.toggleBuiltin(guard, r.id, enabled, base ?? null),
    );
  }

  const actions = (guard: Guard): RuleActions => ({
    mode: (mode) => {
      patch(guard, (g) => ({ ...g, mode }));
      void write((base) => api.setMode(guard, mode, base ?? null));
    },
    toggle: (r, enabled) => toggle(guard, r, enabled),
    open: (r) =>
      setDialog(r.custom ? { kind: "rule", guard, editing: r } : { kind: "builtin", guard, rule: r }),
    copy: (r) =>
      setDialog({
        kind: "rule",
        guard,
        editing: null,
        seed: {
          name: viewName(guard, r),
          pattern: r.matcher.kind === "regex" ? r.matcher.pattern : "",
          action: r.action ?? undefined,
        },
      }),
    remove: (r) => setDialog({ kind: "delete", guard, rule: r }),
    create: () => setDialog({ kind: "rule", guard, editing: null }),
    test: () => setDialog({ kind: "test", guard }),
  });

  /** 自定义规则保存。**失败时对话框留着**，把 core 的话显示在里面 */
  async function saveRule(guard: Guard, editing: SecurityRuleView | null, save: Omit<CustomRuleSave, "base_version">) {
    const body = { ...save, base_version: version.current };
    const w = editing ? await api.updateRule(guard, editing.id, body) : await api.createRule(guard, body);
    version.current = w.version;
    setDialog(null);
    onChanged();
    await reload();
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <Tabs value={tab} onValueChange={(v) => setTab(v as SecurityTab)}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="log">{t.log}</TabsTrigger>
            {GUARDS.map((g) => (
              <TabsTrigger key={g} value={g}>
                {lt.guards[g]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex-1" />
          {/* 条数在区间左边：它的宽度随数变，放右边会把区间选择器推来推去 */}
          {tab === "log" && logCount && (
            <span className="tw-label tabular-nums text-muted-foreground">{logCount}</span>
          )}
          {tab === "log" && <RangePicker value={range} onChange={setRange} live={false} />}
        </div>

        <TabsContent value="log" className="mt-2">
          <LogTab
            detail={detail}
            range={range}
            tick={tick}
            onCount={setLogCount}
            actions={{
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
            }}
          />
        </TabsContent>

        {GUARDS.map((g) => (
          <TabsContent key={g} value={g} className="mt-2">
            {detail ? (
              <GuardTab guard={g} detail={detail[g]} busy={busy} actions={actions(g)} />
            ) : (
              <p className="tw-body text-muted-foreground">{error ? t.loadFailed(error) : t.loading}</p>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {dialog?.kind === "rule" && (
        <RuleDialog
          guard={dialog.guard}
          editing={dialog.editing}
          seed={dialog.seed}
          taken={(detail?.[dialog.guard].rules ?? [])
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
          onCopy={() => actions(dialog.guard).copy(dialog.rule)}
          onSaveAction={async (a) => {
            const w = await api.setAction(dialog.rule.id, a, version.current);
            version.current = w.version;
            setDialog(null);
            onChanged();
            await reload();
          }}
        />
      )}
      {dialog?.kind === "test" && <TestDialog guard={dialog.guard} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          what={rt.what}
          name={dialog.rule.id}
          referrers={[]}
          consequence={rt.deleteDesc}
          onDelete={async () => {
            const w = await api.deleteRule(dialog.guard, dialog.rule.id, version.current);
            version.current = w.version;
            setDialog(null);
            onChanged();
            await reload();
          }}
          onClose={() => setDialog(null)}
          onShow={() => {}}
        />
      )}
    </div>
  );
}
