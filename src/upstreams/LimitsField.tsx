import { useText } from "@/i18n";
import { limitProblems } from "@/keys/limits";
import { LimitsEditor } from "@/keys/LimitsEditor";
import type { ProviderView } from "@/types";
import { limitsFieldText } from "./LimitsField.i18n";
import { Note } from "./parts";
import type { UpstreamForm } from "./upstreamForm";

/**
 * 上游的「用量上限」：和密钥对话框同一个编辑器（`LimitsEditor`），放在并发上限下面。
 *
 * 编辑已保存的上游时，每一行下面是 core 数的此刻用量（`ProviderView::limits`）。不计费的
 * 上游费用记 0：有费用上限时说一句它不会用满。填错的当场说，保存按不下去（`limitsMissing`）
 */
export function LimitsField({
  form,
  set,
  editing,
  rowDays,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  editing: ProviderView | null;
  /** 请求记录留几天（概览里的）。天、周、月的上限要求留够那一期 */
  rowDays: number | null;
}) {
  const t = useText(limitsFieldText);
  const free = form.billing === "free" && form.limits.some((r) => r.measure === "cost");
  return (
    <LimitsEditor
      rows={form.limits}
      views={editing?.limits ?? []}
      problems={limitProblems(form.limits, rowDays)}
      rowDays={rowDays}
      hint={t.hint}
      note={free ? <Note tone="warning">{t.free}</Note> : undefined}
      onChange={(limits) => set({ limits })}
    />
  );
}
