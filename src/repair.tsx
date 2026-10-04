import { useEffect, useState } from "react";
import { call } from "@/control";
import { textOf, useText } from "@/i18n";
import { usePending } from "@/ui/notify";
import type { ConfigFix, ConfigRepair } from "@/types";
import { repairText } from "./repair.i18n";

export { repairText };

/**
 * 配置文件读不进来时的一键修复：core 算出要改的那几处（`ConfigRepairPlan`），点一下照着修好
 * 写回（`RepairConfig`）。
 *
 * **只修两种**：取值不在可选范围里的（回到默认值）、不认识的字段（删掉）。修完整份配置读得
 * 进来 core 才给；给不了的时候不出现这个按钮，只剩「打开配置文件」和「版本历史」。
 *
 * `active` 为真时才去问（出错页、配置被拒的横幅在的时候）；`key` 变了重问 —— 被拒的那一处
 * 换了、配置又换了一份，修法就不一样了。修完写回走的是和保存同一条路：进版本历史，可以回滚。
 */
export function useRepair(active: boolean, key: unknown) {
  const [plan, setPlan] = useState<ConfigRepair | null>(null);
  const [repairing, run] = usePending();
  useEffect(() => {
    if (!active) {
      setPlan(null);
      return;
    }
    let alive = true;
    call("ConfigRepairPlan", null)
      .then((p) => alive && setPlan(p))
      // 问不到就当修不了：出错页上照样有另外两条路
      .catch(() => alive && setPlan(null));
    return () => {
      alive = false;
    };
  }, [active, key]);
  const fixes = plan?.fixes ?? [];
  return {
    fixes,
    repairing,
    repair: () =>
      plan && fixes.length > 0 ? void run(() => call("RepairConfig", { base_version: plan.base_version })) : undefined,
  };
}

/** 一处修复说成一句话 */
export function fixText(f: ConfigFix): string {
  const t = textOf(repairText);
  if (f.kind === "unknown_field") return t.field(f.field);
  const value = f.value ?? "";
  return f.now != null ? t.value(f.field, value, f.now) : t.valueNoDefault(f.field, value);
}

/** 要改的那几处，一行一处，行号在前 */
export function FixList({ fixes }: { fixes: ConfigFix[] }) {
  const t = useText(repairText);
  return (
    <ul className="flex flex-col gap-1 tw-body">
      {fixes.map((f) => (
        <li key={`${f.kind}:${f.field}`} className="flex gap-2">
          {f.line != null && <span className="shrink-0 text-muted-foreground tw-num">{t.line(f.line)}</span>}
          <span className="min-w-0 break-words font-mono">{fixText(f)}</span>
        </li>
      ))}
    </ul>
  );
}
