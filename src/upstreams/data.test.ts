import { describe, expect, it } from "vitest";
import type { CostBucketGroup } from "@/types";
import { HOUR, SLOTS, dayStart, slotsByUpstream } from "./data";

function bucket(name: string, at: number, requests: number, failed = 0): CostBucketGroup {
  return {
    at_ms: at,
    name,
    requests,
    failed,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
}

describe("dayStart", () => {
  it("starts a day back, on a whole local hour", () => {
    const now = new Date(2026, 8, 25, 16, 42, 7).getTime();
    expect(dayStart(now)).toBe(new Date(2026, 8, 24, 16).getTime());
  });

  it("does not move while the hour lasts", () => {
    expect(dayStart(new Date(2026, 8, 25, 16, 0, 1).getTime())).toBe(
      dayStart(new Date(2026, 8, 25, 16, 59, 59).getTime()),
    );
  });
});

describe("slotsByUpstream", () => {
  const since = new Date(2026, 8, 24, 16).getTime();

  it("gives every hour a slot, with requests or not, ending at the current hour", () => {
    const row = slotsByUpstream([bucket("a", since + 3 * HOUR, 5, 1)], since).get("a")!;
    expect(row).toHaveLength(SLOTS);
    expect(row[0]!.at).toBe(since);
    expect(row[SLOTS - 1]!.at).toBe(since + (SLOTS - 1) * HOUR);
    expect(row[3]).toEqual({ at: since + 3 * HOUR, requests: 5, failed: 1 });
    expect(row.filter((s) => s.requests > 0)).toHaveLength(1);
  });

  it("keeps upstreams apart and leaves out buckets outside the window", () => {
    const by = slotsByUpstream(
      [
        bucket("a", since, 1),
        bucket("b", since, 2),
        bucket("a", since - HOUR, 9),
        bucket("a", since + SLOTS * HOUR, 9),
      ],
      since,
    );
    expect(by.get("a")!.reduce((n, s) => n + s.requests, 0)).toBe(1);
    expect(by.get("b")![0]!.requests).toBe(2);
  });

  it("has no row for an upstream without requests in the window", () => {
    expect(slotsByUpstream(undefined, since).size).toBe(0);
    expect(slotsByUpstream([bucket("a", since - 2 * HOUR, 3)], since).has("a")).toBe(false);
  });
});
