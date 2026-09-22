import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { patchConfig } from "@/patch";
import type { LimitsView, PatchOp } from "@/types";
import { FormActions, FormRow, FormRows, NumberInput, intIn } from "./form";
import { limitsText } from "./LimitsSection.i18n";

type Key = keyof LimitsView;
const KEYS: Key[] = ["per_provider", "queue_depth", "queue_timeout_secs"];
type Draft = Record<Key, string>;

const draftOf = (l: LimitsView): Draft => ({
  per_provider: String(l.per_provider),
  queue_depth: String(l.queue_depth),
  queue_timeout_secs: String(l.queue_timeout_secs),
});

/**
 * 并发。
 *
 * **没有全局上限。**本机网关同时在跑的，就是这台电脑上几个客户端各自开着的
 * 会话；再压一道总闸，挡住的只会是用户自己的并行任务。要防的是两件事：一个
 * 变慢的上游占住所有请求（这里的「单个上游」），和某一把密钥后面的失控
 * 脚本（每把密钥自己的上限，在密钥的编辑对话框里）。
 *
 * 超限排队而不是拒绝：客户端收到 429 多半直接判任务失败，排队只是慢一点。
 */
export function LimitsSection({
  limits,
  configVersion,
}: {
  limits: LimitsView;
  configVersion: string;
}) {
  const t = useText(limitsText);
  const [draft, setDraft] = useState(() => draftOf(limits));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = draftOf(limits);
  const dirty = KEYS.some((k) => draft[k] !== saved[k]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const key = JSON.stringify(limits);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(draftOf(JSON.parse(key) as LimitsView));
  }, [key]);

  const ok: Record<Key, boolean> = {
    per_provider: intIn(draft.per_provider, 1, 10_000),
    queue_depth: intIn(draft.queue_depth, 1, 100_000),
    queue_timeout_secs: intIn(draft.queue_timeout_secs, 1, 3_600),
  };

  async function save() {
    // **配置里的数字字段必须发数字**：发字符串 core 直接拒
    const ops: PatchOp[] = KEYS.filter((k) => draft[k] !== saved[k]).map((k) => ({
      op: "replace",
      path: `/limits/${k}`,
      value: Number(draft[k]),
    }));
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

  const row = (k: Key, label: string, hint: string, unit?: string) => (
    <FormRow label={label} htmlFor={`limits-${k}`} hint={ok[k] ? hint : t.bad}>
      <NumberInput
        id={`limits-${k}`}
        value={draft[k]}
        unit={unit}
        invalid={!ok[k]}
        disabled={busy}
        onChange={(v) => {
          setError(null);
          setDraft((d) => ({ ...d, [k]: v }));
        }}
      />
    </FormRow>
  );

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <p className="mt-1 tw-body text-muted-foreground">{t.intro}</p>
      <FormRows>
        {row("per_provider", t.perProvider, t.perProviderWhat)}
        {row("queue_depth", t.queueDepth, t.queueDepthWhat)}
        {row("queue_timeout_secs", t.queueTimeout, t.queueTimeoutWhat, t.seconds)}
        <FormActions
          dirty={dirty}
          busy={busy}
          invalid={KEYS.some((k) => !ok[k])}
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
