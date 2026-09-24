import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { FormActions, FormRow, FormRows, NumberInput, intIn } from "@/settings/form";
import type { GuardMode, OutputLimitDetail } from "@/types";
import { ModeCard } from "./GuardTab";
import { outputLimitText } from "./OutputLimitTab.i18n";

/**
 * 输出长度：档位，和一个上限。它没有规则。
 *
 * **上限改完点保存才写。**档位和别的防护一样点一下就换；数字是一格一格敲
 * 进去的，敲到一半就写盘的话，配置里会先后出现 1、10、100…… 每一个都会
 * 真的去切别人的回答。
 */
export function OutputLimitTab({
  detail,
  busy,
  onMode,
  onSaveLimit,
}: {
  detail: OutputLimitDetail;
  busy: boolean;
  onMode: (mode: GuardMode) => void;
  /** 写上限。失败时抛出，这一节自己显示 */
  onSaveLimit: (max: number) => Promise<void>;
}) {
  const t = useText(outputLimitText);
  const saved = String(detail.max_chars);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== saved;

  // 别处改了（配置文件、另一个窗口）：没在改的话跟着换
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(saved);
  }, [saved]);

  const n = (v: number) => v.toLocaleString();
  const ok = intIn(draft, 1, detail.ceiling);
  const isDefault = draft === String(detail.default_max_chars);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSaveLimit(Number(draft));
      dirtyRef.current = false;
      toast.success(t.saved);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ModeCard guard="output_limit" mode={detail.mode} busy={busy} onMode={onMode} />

      <section>
        <h3 className="tw-head">{t.title}</h3>
        <FormRows>
          <FormRow
            label={t.max}
            htmlFor="output-limit-max"
            hint={
              ok ? t.hint(n(detail.default_max_chars), n(detail.ceiling)) : (
                <span className="text-destructive">{t.bad(n(detail.ceiling))}</span>
              )
            }
          >
            <span className="inline-flex items-center gap-2">
              <NumberInput
                id="output-limit-max"
                value={draft}
                unit={t.unit}
                invalid={!ok}
                disabled={saving}
                onChange={(v) => {
                  setError(null);
                  setDraft(v);
                }}
              />
              {!isDefault && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setError(null);
                    setDraft(String(detail.default_max_chars));
                  }}
                >
                  {t.reset}
                </Button>
              )}
            </span>
          </FormRow>
          <FormActions
            dirty={dirty}
            busy={saving}
            invalid={!ok}
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
    </div>
  );
}
