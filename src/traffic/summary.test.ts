import { describe, expect, it } from "vitest";
import type { RequestRow } from "@/types";
import { summarize, WINDOW_MIN } from "./summary";

const MIN = 60_000;
/** 16:42:07 那一刻（按 UTC 算分钟，和本地时区无关：分钟的边界在哪都一样） */
const NOW = Date.UTC(2026, 8, 25, 16, 42, 7);
/** 这一分钟的开头：16:42:00 */
const THIS_MIN = Date.UTC(2026, 8, 25, 16, 42, 0);

let seq = 0;
function row(atMs: number, state: RequestRow["state"] = "done"): RequestRow {
  seq += 1;
  return { id: seq, client: "claude-code", provider: "anthropic", path: "/v1/messages", atMs, state };
}

describe("流量页页头的摘要", () => {
  it("小图按分钟对齐，最后一格是正在走的这一分钟", () => {
    const s = summarize([], NOW, 2000);
    expect(s.bars).toHaveLength(WINDOW_MIN);
    expect(s.bars[s.bars.length - 1]?.at).toBe(THIS_MIN);
    expect(s.bars[0]?.at).toBe(THIS_MIN - (WINDOW_MIN - 1) * MIN);
  });

  it("一条请求落在它开始的那一分钟里，失败的另记一笔", () => {
    const rows = [row(THIS_MIN + 5_000), row(THIS_MIN - MIN + 59_000, "failed"), row(THIS_MIN - MIN, "done")];
    const s = summarize(rows, NOW, 2000);
    const last = s.bars[s.bars.length - 1];
    const prev = s.bars[s.bars.length - 2];
    expect(last).toMatchObject({ n: 1, failed: 0 });
    expect(prev).toMatchObject({ n: 2, failed: 1 });
    expect(s.recent).toBe(3);
    expect(s.recentFailed).toBe(1);
  });

  it("总数、失败、进行中按整个列表数，近 30 分钟只数窗口里的", () => {
    const old = THIS_MIN - 2 * 3_600_000;
    const rows = [row(old, "failed"), row(old, "done"), row(THIS_MIN, "in_flight"), row(THIS_MIN, "cancelled")];
    const s = summarize(rows, NOW, 2000);
    expect(s.total).toBe(4);
    expect(s.failed).toBe(1);
    expect(s.inFlight).toBe(1);
    // 取消的不算失败
    expect(s.recent).toBe(2);
    expect(s.recentFailed).toBe(0);
  });

  /**
   * 列表装满了（最近两千条），最老的一条还在窗口里：更早被挤出去的那些也可能在
   * 窗口里，近 30 分钟的数只是下限（界面上写「≥」）。
   */
  it("列表装满、最老的一条还在窗口里时，近 30 分钟的数不全", () => {
    const full = Array.from({ length: 3 }, () => row(THIS_MIN - 5 * MIN));
    expect(summarize(full, NOW, 3).complete).toBe(false);
    expect(summarize(full, NOW, 4).complete).toBe(true);
    const reachesBack = [...full.slice(1), row(THIS_MIN - 40 * MIN)];
    expect(summarize(reachesBack, NOW, 3).complete).toBe(true);
  });
});
