/**
 * 路由页几处共用的小件：去向和密钥的图标、上游在路由里要留意的状态、一排密钥。
 */
import { KeyRoundIcon, LayersIcon } from "lucide-react";
import { ClientLogo, UpstreamLogo } from "@/ui/logos";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { cn } from "@/lib/utils";
import { textOf } from "@/i18n";
import type { ClientView, ProviderView } from "@/types";
import { partsText } from "./parts.i18n";

/** 上游在路由里要留意的状态：停用、登录失效、凭据被拒、熔断。正常时为空 */
export function upstreamState(p: ProviderView | undefined): { tone: StatusTone; label: string } | null {
  if (!p) return null;
  const t = textOf(partsText);
  if (p.disabled) return { tone: "idle", label: t.disabled };
  if (p.oauth?.needs_login) return { tone: "error", label: t.needsLogin };
  if (p.auth_rejected) return { tone: "error", label: t.authRejected };
  if (p.health === "open") return { tone: "error", label: t.circuitOpen };
  return null;
}

/** 一个去向的图标：上游是它的标志，策略组是叠起来的几层 */
export function TargetIcon({
  name,
  providers,
  size = 14,
  className,
}: {
  name: string;
  providers: readonly ProviderView[];
  size?: number;
  className?: string;
}) {
  const p = providers.find((x) => x.name === name);
  if (p) {
    return (
      <UpstreamLogo
        name={p.name}
        baseUrl={p.base_url}
        protocol={p.protocol}
        size={size}
        className={cn("text-muted-foreground", className)}
      />
    );
  }
  return (
    <LayersIcon
      aria-hidden
      className={cn("shrink-0 text-muted-foreground", className)}
      style={{ width: size - 1, height: size - 1 }}
    />
  );
}

/** 密钥的图标：认得出是哪个客户端就用它的标志，否则一把钥匙 */
export function KeyIcon({ k, size = 14, className }: { k: ClientView; size?: number; className?: string }) {
  if (k.client) return <ClientLogo id={k.client} size={size} className={cn("text-muted-foreground", className)} />;
  return (
    <KeyRoundIcon
      aria-hidden
      className={cn("shrink-0 text-muted-foreground", className)}
      style={{ width: size - 1, height: size - 1 }}
    />
  );
}

/** 一排密钥：标志加名字。停用的淡一档，带一个灰点 */
export function KeyChips({ keys, empty }: { keys: readonly ClientView[]; empty: string }) {
  if (keys.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  const t = textOf(partsText);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {keys.map((k) => (
        <span
          key={k.name}
          className={cn(
            "inline-flex h-5 max-w-full items-center gap-1 rounded-md border border-border bg-surface/70 pr-1.5 pl-1 font-mono tw-label",
            k.disabled && "text-muted-foreground",
          )}
        >
          <KeyIcon k={k} size={12} />
          <span className="truncate">{k.name}</span>
          {k.disabled && <StatusDot tone="idle" label={t.keyDisabled} />}
        </span>
      ))}
    </span>
  );
}
