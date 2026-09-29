import { useState } from "react";
import { Banner } from "@/ui/banner";
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

type Field = keyof FailoverView;
export type Draft = Record<Field, string>;

/** 表单里的顺序 */
const FIELDS: Field[] = [
  "failures_to_pause",
  "pause_secs",
  "max_pause_secs",
  "no_balance_pause_secs",
  "quota_pause_secs",
  "rate_limit_max_pause_secs",
  "stream_start_wait_secs",
];

/** 导出给测试用 */
export const draftOf = (f: FailoverView): Draft =>
  Object.fromEntries(FIELDS.map((k) => [k, String(f[k])])) as Draft;

const same = (a: Draft, b: Draft) => FIELDS.every((k) => a[k] === b[k]);

/**
 * 每一格填得对不对，范围和 core 的校验一样。
 *
 * **没动过的格不查**（和日志保留一样）：它就是配置里现在的值，保存时也不发。只有上限
 * 例外 —— 起点改大了，没动过的上限也可能跟着不对了。导出给测试用。
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
      draft.stream_start_wait_secs === saved.stream_start_wait_secs || intIn(draft.stream_start_wait_secs, 1, MAX_WAIT),
  };
}

/**
 * 上游失败之后停用多久、流式回答的开头最多等多久。
 *
 * 默认值显式写在格子里（概览给的就是真在用的数），不用「留空 = 默认」。
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

  const row = (k: Field, unit: string, what: string, badText: string) => (
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
    />
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
          {row("stream_start_wait_secs", t.secs, t.what.stream_start_wait_secs, t.badWait)}
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
