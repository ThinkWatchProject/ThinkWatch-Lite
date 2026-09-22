import { useState } from "react";
import { toast } from "sonner";
import { Segmented } from "@/ui/segmented";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { PROBES, probeLabel } from "@/labels";
import { patchConfig } from "@/patch";
import type { Overview } from "@/types";
import { probesTabText } from "./ProbesTab.i18n";

/**
 * 客户端自己发的辅助请求，以及每一类怎么处理。
 *
 * **它属于路由，不属于网关。**三档里有一档就叫「交给路由」，而规则的
 * `intent` 条件只对那一档成立 —— 写规则的地方和决定它能不能命中的地方
 * 隔着一个导航项时，规则会静悄悄地永远不命中。
 */
export function ProbesTab({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string;
}) {
  const t = useText(probesTabText);
  const [busy, setBusy] = useState<string | null>(null);
  const probes = ov.client_probes;

  const modes = [
    { id: "intercept", label: t.intercept, what: t.interceptWhat },
    { id: "passthrough", label: t.passthrough, what: t.passthroughWhat },
    { id: "route", label: t.routed, what: t.routedWhat },
  ];

  async function set(id: string, mode: string) {
    setBusy(id);
    try {
      await patchConfig(
        [{ op: "replace", path: `/client_probes/${id}`, value: mode }],
        configVersion,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="tw-body text-muted-foreground">{t.intro}</p>
      <ul className="space-y-1.5">
        {probes.map((p) => {
          const kind = PROBES.find((x) => x.id === p.id);
          // **从本地应答改成交给路由，这一类就开始花钱了。**它原本一个
          // 字节都不发；规则接不住它的话，它落到兜底上游上
          const willCost = p.mode === "intercept";
          return (
            <li key={p.id} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-baseline gap-3">
                <span className="tw-body font-medium">{kind?.label ?? probeLabel(p.id)}</span>
                <div className="ml-auto">
                  <Segmented<string>
                    label={kind?.label ?? probeLabel(p.id)}
                    value={p.mode}
                    disabled={busy === p.id}
                    options={modes.map((m) => ({ id: m.id, label: m.label }))}
                    onChange={(v) => v !== p.mode && void set(p.id, v)}
                  />
                </div>
              </div>
              {kind && <p className="mt-1 tw-body text-muted-foreground">{kind.what}</p>}
              <p className="mt-0.5 tw-label text-muted-foreground">
                {modes.find((m) => m.id === p.mode)?.what}
              </p>
              {willCost && <p className="mt-0.5 tw-label text-warning">{t.nowCosts}</p>}
            </li>
          );
        })}
      </ul>
      <p className="tw-label text-muted-foreground">{t.ruleHint}</p>
    </div>
  );
}
