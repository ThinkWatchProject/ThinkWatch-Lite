import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/ui/segmented";
import { notify } from "@/ui/notify";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { PROBES, probeLabel } from "@/labels";
import { patchConfig } from "@/patch";
import type { Overview, ProbeMode } from "@/types";
import { probesTabText } from "./ProbesTab.i18n";

/**
 * 客户端自己发的辅助请求，以及每一类怎么处理。
 *
 * **它属于路由，不属于网关。**三档里有一档就叫「交给路由」，而规则的
 * `intent` 条件只对那一档成立 —— 写规则的地方和决定它能不能命中的地方
 * 隔着一个导航项时，规则会静悄悄地永远不命中。
 *
 * 换档是一次配置写入：**先按新档画**，写入期间那一类旁边转圈、分段控件失效；
 * 失败时拨回原档并报错。成功不弹提示 —— 分段控件已经停在新档上了。
 */
export function ProbesTab({ ov }: { ov: Overview }) {
  const t = useText(probesTabText);
  /** 写入中的那几类，和它们要去的档 */
  const [pending, setPending] = useState<Record<string, ProbeMode>>({});
  /** 写完了、概览还没读回来的那几类：继续按新档画，免得弹回旧档再跳过去 */
  const [landed, setLanded] = useState<Record<string, ProbeMode>>({});
  useEffect(() => {
    setLanded((l) => {
      const left = Object.entries(l).filter(([id, mode]) => ov.client_probes.find((p) => p.id === id)?.mode !== mode);
      return left.length === Object.keys(l).length ? l : Object.fromEntries(left);
    });
  }, [ov]);

  /** 连着改两类时，第二次要带第一次写完的版本，而概览还没读回来 */
  const version = useRef(ov.config_version);
  useEffect(() => {
    version.current = ov.config_version;
  }, [ov.config_version]);

  const modes: { id: ProbeMode; label: string; what: string }[] = [
    { id: "intercept", label: t.intercept, what: t.interceptWhat },
    { id: "passthrough", label: t.passthrough, what: t.passthroughWhat },
    { id: "route", label: t.routed, what: t.routedWhat },
  ];

  async function set(id: string, mode: ProbeMode) {
    setPending((p) => ({ ...p, [id]: mode }));
    try {
      const res = await patchConfig([{ op: "replace", path: `/client_probes/${id}`, value: mode }], version.current);
      version.current = res.version;
      setLanded((l) => ({ ...l, [id]: mode }));
    } catch (e) {
      notify.error(e);
    } finally {
      setPending(({ [id]: _, ...rest }) => rest);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="tw-body text-muted-foreground">{t.intro}</p>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {ov.client_probes.map((p) => {
          const kind = PROBES.find((x) => x.id === p.id);
          const label = kind?.label ?? probeLabel(p.id);
          const mode = pending[p.id] ?? landed[p.id] ?? p.mode;
          const busy = p.id in pending;
          return (
            <li key={p.id} aria-busy={busy || undefined} className="flex items-start gap-4 bg-background px-3.5 py-3">
              <div className="min-w-0 flex-1">
                <div className="tw-body font-medium">{label}</div>
                {kind && <p className="mt-0.5 tw-body text-muted-foreground">{kind.what}</p>}
                {/* 每一档自己说清产不产生费用：切过去就看得到，不用每一行都预先警告一遍 */}
                <p key={mode} className="mt-1 tw-label text-muted-foreground motion-fade">
                  {modes.find((m) => m.id === mode)?.what}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* 转圈的位置一直留着：出现、消失时分段控件不左右挪 */}
                {busy ? (
                  <Spinner aria-hidden className="size-3.5 text-muted-foreground motion-fade" />
                ) : (
                  <span aria-hidden className="size-3.5" />
                )}
                <Segmented<ProbeMode>
                  label={label}
                  value={mode}
                  disabled={busy}
                  options={modes.map((m) => ({ id: m.id, label: m.label }))}
                  onChange={(v) => v !== mode && void set(p.id, v)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="tw-label text-muted-foreground">{t.ruleHint}</p>
    </div>
  );
}
