import { useState, type ReactNode } from "react";
import { Banner } from "@/ui/banner";
import { Switch } from "@/ui/switch";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { patchConfig } from "@/patch";
import type { FailoverView, PatchOp } from "@/types";
import { NumberInput, intIn, useFormDraft } from "./form";
import { SaveBar, SettingsCard, SettingsGroup, SettingsRow, useDirtyMark, useSavedFlash } from "./kit";
import { failoverText } from "./FailoverSection.i18n";

/** 停用时长最多写多少秒：一周（core 的 `MAX_PAUSE_SECS`） */
const MAX_PAUSE = 7 * 24 * 3600;
/** 流开头最多等多少秒（core 的 `MAX_STREAM_START_WAIT_SECS`） */
const MAX_WAIT = 120;
/** 开着「开头超时转到下一个上游」时，流开头至少等多少秒（core 的 `MIN_SLOW_START_WAIT_SECS`） */
const MIN_SLOW_START_WAIT = 5;
/** 等空位最多写多少秒（core 的 `MAX_SLOT_WAIT_SECS`） */
const MAX_SLOT_WAIT = 300;

/** 这一节里的数字格子。开关（`next_on_slow_start`）另记 */
type Field = Exclude<keyof FailoverView, "next_on_slow_start">;
export type Draft = Record<Field, string> & { next_on_slow_start: boolean };

/** 表单里的顺序 */
const FIELDS: Field[] = [
  "failures_to_pause",
  "pause_secs",
  "max_pause_secs",
  "no_balance_pause_secs",
  "quota_pause_secs",
  "rate_limit_max_pause_secs",
  "stream_start_wait_secs",
  "slot_wait_secs",
];

/** 导出给测试用 */
export const draftOf = (f: FailoverView): Draft => ({
  ...(Object.fromEntries(FIELDS.map((k) => [k, String(f[k])])) as Record<Field, string>),
  next_on_slow_start: f.next_on_slow_start,
});

const same = (a: Draft, b: Draft) =>
  FIELDS.every((k) => a[k] === b[k]) && a.next_on_slow_start === b.next_on_slow_start;

/**
 * 每一格填得对不对，范围和 core 的校验一样。
 *
 * **没动过的格不查**（和日志保留一样）：它就是配置里现在的值，保存时也不发。只有上限
 * 例外 —— 起点改大了，没动过的上限也可能跟着不对了。等回答开头的秒数也一样：打开
 * 「开头超时时转到下一个上游」之后它至少要 5 秒，没动过的也要重查。导出给测试用。
 */
export function checks(draft: Draft, saved: Draft): Record<Field, boolean> {
  const secs = (k: Field) => draft[k] === saved[k] || intIn(draft[k], 1, MAX_PAUSE);
  const pause = Number(draft.pause_secs);
  return {
    failures_to_pause: draft.failures_to_pause === saved.failures_to_pause || intIn(draft.failures_to_pause, 1, 100),
    pause_secs: secs("pause_secs"),
    max_pause_secs:
      (draft.max_pause_secs === saved.max_pause_secs && draft.pause_secs === saved.pause_secs) ||
      intIn(draft.max_pause_secs, Number.isFinite(pause) && pause > 0 ? pause : 1, MAX_PAUSE),
    no_balance_pause_secs: secs("no_balance_pause_secs"),
    quota_pause_secs: secs("quota_pause_secs"),
    rate_limit_max_pause_secs: secs("rate_limit_max_pause_secs"),
    stream_start_wait_secs:
      (draft.stream_start_wait_secs === saved.stream_start_wait_secs &&
        draft.next_on_slow_start === saved.next_on_slow_start) ||
      intIn(draft.stream_start_wait_secs, draft.next_on_slow_start ? MIN_SLOW_START_WAIT : 1, MAX_WAIT),
    slot_wait_secs: draft.slot_wait_secs === saved.slot_wait_secs || intIn(draft.slot_wait_secs, 0, MAX_SLOT_WAIT),
  };
}

/**
 * 上游失败之后停用多久、流式回答的开头最多等多久、上游满着时最多等多久。
 *
 * 默认值显式写在格子里（概览给的就是真在用的数），不用「留空 = 默认」。
 *
 * **「开头超时时转到下一个上游」和等开头的秒数是一件事**：开关挂在那一行底下，不另起
 * 一行 —— 它说的就是那个秒数到了之后怎么办。
 */
export function FailoverSection({
  failover,
  configVersion,
  onChanged,
}: {
  failover: FailoverView;
  configVersion: string;
  onChanged: () => void;
}) {
  const t = useText(failoverText);
  const saved = draftOf(failover);
  const { draft, setDraft, dirty, commit, reset } = useFormDraft("failover", saved, same);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, flash] = useSavedFlash();
  useDirtyMark("failover", dirty);

  const ok = checks(draft, saved);
  const valid = FIELDS.every((k) => ok[k]);

  async function save() {
    const ops: PatchOp[] = FIELDS.filter((k) => draft[k] !== saved[k]).map((k) => ({
      op: "replace",
      path: `/failover/${k}`,
      value: Number(draft[k]),
    }));
    if (draft.next_on_slow_start !== saved.next_on_slow_start)
      ops.push({ op: "replace", path: "/failover/next_on_slow_start", value: draft.next_on_slow_start });
    setBusy(true);
    setError(null);
    try {
      await patchConfig(ops, configVersion);
      commit();
      flash();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const edit = (k: Field) => (v: string) => {
    setError(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };
  const bad = (msg: string) => <span className="text-destructive">{msg}</span>;

  const row = (k: Field, unit: string, what: string, badText: string, more?: ReactNode) => (
    <SettingsRow
      key={k}
      label={t.label[k]}
      htmlFor={`failover-${k}`}
      description={ok[k] ? what : bad(badText)}
      control={
        <NumberInput
          id={`failover-${k}`}
          value={draft[k]}
          unit={unit}
          unitWidth="min-w-10"
          invalid={!ok[k]}
          disabled={busy}
          onChange={edit(k)}
        />
      }
    >
      {more}
    </SettingsRow>
  );

  return (
    <SettingsGroup id="failover" title={t.title} description={t.intro}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !busy && valid) void save();
        }}
      >
        <SettingsCard>
          {row("failures_to_pause", t.times, t.what.failures_to_pause, t.badCount)}
          {row("pause_secs", t.secs, t.what.pause_secs, t.badSecs)}
          {row("max_pause_secs", t.secs, t.what.max_pause_secs, t.badMax)}
          {row("no_balance_pause_secs", t.secs, t.what.no_balance_pause_secs, t.badSecs)}
          {row("quota_pause_secs", t.secs, t.what.quota_pause_secs, t.badSecs)}
          {row("rate_limit_max_pause_secs", t.secs, t.what.rate_limit_max_pause_secs, t.badSecs)}
          {row(
            "stream_start_wait_secs",
            t.secs,
            t.what.stream_start_wait_secs,
            draft.next_on_slow_start ? t.badSlowStartWait : t.badWait,
            // 和上面那一行排成同一个样子：说明在左、开关在右，中间不画分隔线
            <div className="mt-3 flex min-h-7 flex-wrap items-center gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1 basis-56">
                <label htmlFor="failover-next_on_slow_start" className="tw-body text-foreground">
                  {t.nextOnSlowStart}
                </label>
                <div className="mt-0.5 tw-label text-muted-foreground">{t.nextOnSlowStartWhat}</div>
              </div>
              <div className="ml-auto flex shrink-0 items-center">
                <Switch
                  id="failover-next_on_slow_start"
                  checked={draft.next_on_slow_start}
                  disabled={busy}
                  onCheckedChange={(c) => {
                    setError(null);
                    setDraft((d) => ({ ...d, next_on_slow_start: c === true }));
                  }}
                />
              </div>
            </div>,
          )}
          {row("slot_wait_secs", t.secs, t.what.slot_wait_secs, t.badSlotWait)}
          <SaveBar
            dirty={dirty}
            pending={busy}
            saved={justSaved}
            invalid={!valid}
            onDiscard={() => {
              setError(null);
              reset();
            }}
          />
        </SettingsCard>
      </form>
      <Banner layout="inline" tone="error" show={error !== null} title={t.saveFailed}>
        {error}
      </Banner>
    </SettingsGroup>
  );
}
