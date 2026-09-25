import { afterEach, describe, expect, it } from "vitest";

import { setLang } from "@/i18n";
import type { KeyUsage } from "@/types";
import { routeLabel } from "./labels";
import { BARS, HOUR_MS, usageByKey, usageWindow } from "./usage";

/** 本地时间 2026-09-25 16:42:07 */
const NOW = new Date(2026, 8, 25, 16, 42, 7).getTime();

function bucket(name: string, hoursAfterSince: number, requests: number, since: number) {
  return {
    at_ms: since + hoursAfterSince * HOUR_MS,
    name,
    requests,
    failed: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
    no_usage_requests: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
}

function total(name: string, requests: number, cost_micros: number) {
  return { name, requests, cost_micros, unpriced_requests: 0, input_tokens: 0, output_tokens: 0, no_usage_requests: 0 };
}

describe("usageWindow", () => {
  it("starts on the local hour 24 hours back, like the overview's 24 hours", () => {
    const w = usageWindow(NOW);
    expect(new Date(w.since)).toEqual(new Date(2026, 8, 24, 16, 0, 0));
    expect(w.bucket).toBe(HOUR_MS);
  });

  it("does not move within the same hour", () => {
    expect(usageWindow(NOW).since).toBe(usageWindow(NOW + 10 * 60_000).since);
  });

  it("has one bar per full hour plus the current one", () => {
    const w = usageWindow(NOW);
    const current = new Date(2026, 8, 25, 16, 0, 0).getTime();
    expect((current - w.since) / w.bucket).toBe(BARS - 1);
  });
});

describe("usageByKey", () => {
  const since = usageWindow(NOW).since;

  it("takes totals as they are and fills the sparse buckets into BARS slots", () => {
    const u: KeyUsage = {
      since_ms: since,
      bucket_ms: HOUR_MS,
      totals: [total("claude-code", 5, 1_250_000)],
      buckets: [bucket("claude-code", 0, 2, since), bucket("claude-code", BARS - 1, 3, since)],
    };
    const got = usageByKey(u).get("claude-code");
    expect(got?.requests).toBe(5);
    expect(got?.cost).toBe(1_250_000);
    expect(got?.series).toHaveLength(BARS);
    expect(got?.series[0]).toBe(2);
    expect(got?.series[BARS - 1]).toBe(3);
    expect(got?.series.slice(1, BARS - 1).every((v) => v === 0)).toBe(true);
  });

  it("drops buckets outside the window", () => {
    const u: KeyUsage = {
      since_ms: since,
      bucket_ms: HOUR_MS,
      totals: [total("codex", 1, 0)],
      buckets: [bucket("codex", -1, 7, since), bucket("codex", BARS, 7, since), bucket("codex", 3, 1, since)],
    };
    const got = usageByKey(u).get("codex");
    expect(got?.series.reduce((a, b) => a + b, 0)).toBe(1);
    expect(got?.series[3]).toBe(1);
  });

  it("leaves keys without requests out, so the caller can tell zero from not loaded", () => {
    const u: KeyUsage = { since_ms: since, bucket_ms: HOUR_MS, totals: [], buckets: [] };
    expect(usageByKey(u).size).toBe(0);
  });
});

describe("routeLabel", () => {
  afterEach(() => setLang("zh"));

  it("names the route a key is bound to", () => {
    setLang("zh");
    expect(routeLabel("codex", "default")).toBe("codex");
  });

  it("does not say the same word twice for a default route named default", () => {
    setLang("zh");
    expect(routeLabel(null, "default")).toBe("默认");
    expect(routeLabel(null, "默认")).toBe("默认");
    setLang("en");
    expect(routeLabel(null, "default")).toBe("Default");
    expect(routeLabel(undefined, "Default")).toBe("Default");
  });

  it("names a default route with its own name", () => {
    setLang("zh");
    expect(routeLabel(null, "main")).toBe("默认（main）");
    setLang("en");
    expect(routeLabel(null, "main")).toBe("Default (main)");
  });
});
