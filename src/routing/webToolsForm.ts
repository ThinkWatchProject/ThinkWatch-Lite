import type { SearchEngine, WebToolsConfig } from "@/types";

export const WEB_LIMITS = {
  max_results: [1, 20], read_pages: [0, 5], max_page_chars: [1000, 50000], timeout_secs: [1, 120],
  max_concurrent: [1, 16], interval_ms: [250, 60000], cache_secs: [0, 86400], max_tool_calls: [1, 32],
} as const;

export function domains(text: string): string[] {
  return [...new Set(text.split(/[\s,，]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

export const domainList = (saved: string[], draft: string): string[] => domains([...saved, draft].join("\n"));
export const validDomain = (value: string): boolean => value.length > 0 && value.length <= 253 && value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
export const engineChoice = (engines: SearchEngine[]): SearchEngine | "auto" => engines.length === 1 ? engines[0]! : "auto";
export const chosenEngines = (choice: string): SearchEngine[] => choice === "bing" || choice === "duckduckgo" ? [choice] : [];

export function validWebConfig(c: WebToolsConfig): boolean {
  return Object.entries(WEB_LIMITS).every(([key, [min, max]]) => {
    const n = c[key as keyof typeof WEB_LIMITS];
    return Number.isInteger(n) && n >= min && n <= max;
  }) && c.allowed_domains.length <= 100 && c.blocked_domains.length <= 100 && [...c.allowed_domains, ...c.blocked_domains].every(validDomain)
    && [c.language, c.region].every((s) => s.length <= 35 && /^[a-z0-9-]*$/i.test(s));
}
