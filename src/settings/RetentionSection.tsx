import { useState } from "react";
import { cn } from "@/lib/utils";
import { Banner } from "@/ui/banner";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { patchConfig } from "@/patch";
import type { PatchOp, RetentionView } from "@/types";
import { NumberInput, intIn, useFormDraft } from "./form";
import { SaveBar, SettingsCard, SettingsGroup, SettingsRow, useDirtyMark, useSavedFlash } from "./kit";
import { retentionText } from "./RetentionSection.i18n";

const GIB = 1024 * 1024 * 1024;

interface Draft {
  body_days: string;
  row_days: string;
  /** 按 GB 写：配置里是字节，而人读的是「几个 G」 */
  body_max_gb: string;
}

const draftOf = (r: RetentionView): Draft => ({
  body_days: String(r.body_days),
  row_days: String(r.row_days),
  body_max_gb: gib(r.body_max_bytes),
});

const same = (a: Draft, b: Draft) =>
  a.body_days === b.body_days && a.row_days === b.row_days && a.body_max_gb === b.body_max_gb;

/** 一位小数以内的正数 */
const gbOk = (v: string) => /^\d+(\.\d)?$/.test(v) && Number(v) > 0;

/**
 * 日志留多久。
 *
 * **两个期限，因为两样东西的代价差三个数量级。**一条报文几十 KB，忙一天就是几百
 * MB；一行记录（时刻、模型、用量、费用）几百字节，留一个季度也不过几十 MB。合成
 * 一个期限，要么早早丢掉「上个月的费用」，要么让磁盘替报文买单。
 *
 * **总量上限旁边画出现在占了多少。**「2 GB」这个数字，用户没法判断松还是紧 ——
 * 除非同时看得见当下的占用。条的长度按格子里正在填的上限算：改小之前就看得见会不会
 * 马上被删。
 */
export function RetentionSection({
  retention,
  configVersion,
  onChanged,
}: {
  retention: RetentionView;
  configVersion: string;
  onChanged: () => void;
}) {
  const t = useText(retentionText);
  const saved = draftOf(retention);
  const { draft, setDraft, dirty, commit, reset } = useFormDraft("retention", saved, same);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, flash] = useSavedFlash();
  useDirtyMark("retention", dirty);

  const ok = {
    body_days: intIn(draft.body_days, 1, 3_650),
    row_days: intIn(draft.row_days, 1, 36_500),
    body_max_gb: gbOk(draft.body_max_gb),
  };
  const valid = ok.body_days && ok.row_days && ok.body_max_gb;

  async function save() {
    const ops: PatchOp[] = [];
    if (draft.body_days !== saved.body_days)
      ops.push({ op: "replace", path: "/retention/body_days", value: Number(draft.body_days) });
    if (draft.row_days !== saved.row_days)
      ops.push({ op: "replace", path: "/retention/row_days", value: Number(draft.row_days) });
    if (draft.body_max_gb !== saved.body_max_gb)
      ops.push({
        op: "replace",
        path: "/retention/body_max_bytes",
        value: Math.round(Number(draft.body_max_gb) * GIB),
      });
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

  const edit = (k: keyof Draft) => (v: string) => {
    setError(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  // 条按正在填的上限画；格子里写的不是个数时按配置里的
  const cap = ok.body_max_gb ? Number(draft.body_max_gb) * GIB : retention.body_max_bytes;
  const bad = (msg: string) => <span className="text-destructive">{msg}</span>;

  return (
    <SettingsGroup id="retention" title={t.title} description={t.intro}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !busy && valid) void save();
        }}
      >
        <SettingsCard>
          <SettingsRow
            label={t.bodyDays}
            htmlFor="retention-body"
            description={ok.body_days ? t.bodyDaysWhat : bad(t.bad)}
            control={
              <NumberInput
                id="retention-body"
                value={draft.body_days}
                unit={t.days}
                invalid={!ok.body_days}
                disabled={busy}
                onChange={edit("body_days")}
              />
            }
          />
          <SettingsRow
            label={t.rowDays}
            htmlFor="retention-rows"
            description={ok.row_days ? t.rowDaysWhat : bad(t.bad)}
            control={
              <NumberInput
                id="retention-rows"
                value={draft.row_days}
                unit={t.days}
                invalid={!ok.row_days}
                disabled={busy}
                onChange={edit("row_days")}
              />
            }
          />
          <SettingsRow
            label={t.bodyMax}
            htmlFor="retention-max"
            description={
              ok.body_max_gb ? (
                <>
                  {t.bodyMaxWhat}
                  <Usage used={retention.body_bytes_now} cap={cap} label={t.usage} />
                </>
              ) : (
                bad(t.badGb)
              )
            }
            control={
              <NumberInput
                id="retention-max"
                decimal
                value={draft.body_max_gb}
                unit="GB"
                invalid={!ok.body_max_gb}
                disabled={busy}
                onChange={edit("body_max_gb")}
              />
            }
          />
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

/**
 * 报文现在占了上限的多少：一根细条和「412 MB / 2 GB」。**快满了才上颜色**（九成
 * 以上），平时是灰的 —— 占用本身不是问题。
 */
function Usage({ used, cap, label }: { used: number; cap: number; label: string }) {
  const ratio = cap > 0 ? Math.min(1, used / cap) : 0;
  const near = ratio >= 0.9;
  return (
    <span className="mt-2 flex items-center gap-2.5">
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={Math.min(used, cap)}
        aria-valuetext={`${bytes(used)} / ${bytes(cap)}`}
        className="relative h-1 w-40 shrink-0 overflow-hidden rounded-full bg-foreground/10"
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full motion-bar", near ? "bg-warning" : "bg-foreground/45")}
          // 占用很小时也留一个看得见的头，不是一根空条
          style={{ width: `${used > 0 ? Math.max(2, ratio * 100) : 0}%` }}
        />
      </span>
      <span className={cn("tw-num", near && "text-warning-foreground")}>
        {bytes(used)} / {bytes(cap)}
      </span>
    </span>
  );
}

/** 字节写成 GB，最多一位小数 */
function gib(n: number): string {
  const g = n / GIB;
  return Number.isInteger(g) ? String(g) : String(Math.round(g * 10) / 10);
}

function bytes(n: number): string {
  if (n >= GIB) return `${gib(n)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
