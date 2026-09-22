import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { patchConfig } from "@/patch";
import type { PatchOp, RetentionView } from "@/types";
import { FormActions, FormRow, FormRows, NumberInput, intIn } from "./form";
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

/**
 * 日志留多久。
 *
 * **两个期限，因为两样东西的代价差三个数量级。**一条报文几十 KB，忙一天
 * 就是几百 MB；一行记录（时刻、模型、用量、费用）几百字节，留一个季度也
 * 不过几十 MB。合成一个期限，要么早早丢掉「上个月的费用」，要么让磁盘替
 * 报文买单。
 *
 * **总量上限旁边写现在占了多少。**「2 GB」这个数字，用户没法判断松还是
 * 紧 —— 除非同时看得见当下的占用。
 */
export function RetentionSection({
  retention,
  configVersion,
}: {
  retention: RetentionView;
  configVersion: string;
}) {
  const t = useText(retentionText);
  const [draft, setDraft] = useState(() => draftOf(retention));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = draftOf(retention);
  const dirty =
    draft.body_days !== saved.body_days ||
    draft.row_days !== saved.row_days ||
    draft.body_max_gb !== saved.body_max_gb;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const key = JSON.stringify([retention.body_days, retention.row_days, retention.body_max_bytes]);
  useEffect(() => {
    if (!dirtyRef.current) {
      const [body_days, row_days, max] = JSON.parse(key) as [number, number, number];
      setDraft({ body_days: String(body_days), row_days: String(row_days), body_max_gb: gib(max) });
    }
  }, [key]);

  const ok = {
    body_days: intIn(draft.body_days, 1, 3_650),
    row_days: intIn(draft.row_days, 1, 36_500),
    body_max_gb: /^\d+(\.\d)?$/.test(draft.body_max_gb) && Number(draft.body_max_gb) > 0,
  };

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
      dirtyRef.current = false;
      toast.success(t.saved);
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

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <p className="mt-1 tw-body text-muted-foreground">{t.intro}</p>
      <FormRows>
        <FormRow label={t.bodyDays} htmlFor="retention-body" hint={ok.body_days ? t.bodyDaysWhat : t.bad}>
          <NumberInput
            id="retention-body"
            value={draft.body_days}
            unit={t.days}
            invalid={!ok.body_days}
            disabled={busy}
            onChange={edit("body_days")}
          />
        </FormRow>
        <FormRow label={t.rowDays} htmlFor="retention-rows" hint={ok.row_days ? t.rowDaysWhat : t.bad}>
          <NumberInput
            id="retention-rows"
            value={draft.row_days}
            unit={t.days}
            invalid={!ok.row_days}
            disabled={busy}
            onChange={edit("row_days")}
          />
        </FormRow>
        <FormRow
          label={t.bodyMax}
          htmlFor="retention-max"
          hint={ok.body_max_gb ? t.bodyMaxWhat(bytes(retention.body_bytes_now)) : t.badGb}
        >
          <NumberInput
            id="retention-max"
            decimal
            value={draft.body_max_gb}
            unit="GB"
            invalid={!ok.body_max_gb}
            disabled={busy}
            onChange={edit("body_max_gb")}
          />
        </FormRow>
        <FormActions
          dirty={dirty}
          busy={busy}
          invalid={!ok.body_days || !ok.row_days || !ok.body_max_gb}
          onSave={() => void save()}
          onDiscard={() => {
            setError(null);
            setDraft(saved);
          }}
        />
      </FormRows>
      {error && (
        <Alert variant="destructive" className="mt-3">
          <TriangleAlertIcon />
          <AlertTitle>{t.saveFailed}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
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
