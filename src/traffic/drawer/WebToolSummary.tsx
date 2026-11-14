import { useText } from "@/i18n";
import type { HeadView } from "@/types";
import { webToolsText } from "@/routing/WebTools.i18n";

/** The gateway records these headers with the response, including cached requests. */
export function WebToolSummary({ head }: { head: HeadView | null }) {
  const t = useText(webToolsText);
  const header = (name: string) => head?.headers.find(([key]) => key.toLowerCase() === name)?.[1];
  const executor = header("x-thinkwatch-web-tools");
  if (!executor) return null;
  let trace: unknown;
  try { trace = JSON.parse(header("x-thinkwatch-web-trace") ?? "[]"); } catch { trace = []; }
  return <div className="rounded-md border border-border px-3 py-2 tw-label">
    <span className="font-medium">{t.title} · {executor === "core" ? t.core : t.upstream}</span>
    {header("x-thinkwatch-web-fallback") === "1" && <p className="mt-1 text-muted-foreground">{t.fallbackHelp}</p>}
    {Array.isArray(trace) && trace.map((step: unknown, index) => {
      if (!step || typeof step !== "object") return null;
      const v = step as Record<string, unknown>;
      const action = v.action === "search" ? t.search : v.action === "open_page" ? t.open : v.action === "find_in_page" ? t.find : null;
      if (!action || typeof v.elapsed_ms !== "number") return null;
      const engines = Array.isArray(v.engines) ? v.engines.filter((s) => s === "bing" || s === "duckduckgo").join(", ") : "";
      return <p key={index} className="mt-1 text-muted-foreground">{action} · {v.cached ? t.cached : t.fetched} · {t.elapsed(v.elapsed_ms)}{engines && ` · ${engines}`}{typeof v.warnings === "number" && v.warnings > 0 && ` · ${t.partial}`}</p>;
    })}
  </div>;
}
