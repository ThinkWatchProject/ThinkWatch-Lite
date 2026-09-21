import { describe, expect, it } from "vitest";
import { failedIn, groupAt, groupBySession, sortWithin } from "./grouping";
import type { RequestRow, SessionView } from "@/types";

const row = (id: number, atMs: number, session?: string): RequestRow => ({
  id,
  client: "claude-code",
  provider: "relay",
  path: "/v1/messages",
  atMs,
  state: "done",
  ...(session ? { session } : {}),
});

const session = (id: string): SessionView =>
  ({ id, client: "claude-code", turns: 3 }) as SessionView;

describe("按会话归组", () => {
  it("同一个会话的请求收进一组，组的先后按它们第一次出现的顺序", () => {
    const g = groupBySession(
      [row(1, 100, "a"), row(2, 200, "b"), row(3, 300, "a")],
      [session("a"), session("b")],
    );
    expect(g.map((x) => x.id)).toEqual(["a", "b"]);
    expect(g[0]?.rows.map((r) => r.id)).toEqual([1, 3]);
  });

  it("认不出会话的请求各成一组，不并成一个假会话", () => {
    // 把它们凑成一个「其他」组，等于声称它们属于同一次任务 ——
    // 而它们之间唯一的共同点是我们不知道它属于谁。
    const g = groupBySession([row(1, 100), row(2, 200), row(3, 300, "a")], []);
    expect(g.filter((x) => x.id === null)).toHaveLength(2);
    expect(g.filter((x) => x.id === null).every((x) => x.rows.length === 1)).toBe(true);
  });

  it("会话汇总还没读到时，组照样成立", () => {
    // 请求走事件流，会话走另一次查询 —— 前者先到是常态
    const g = groupBySession([row(1, 100, "a")], []);
    expect(g[0]?.id).toBe("a");
    expect(g[0]?.session).toBeNull();
  });

  it("组的位置按它最新的那一条，不是按开始时间", () => {
    // 按开始时间排的话，一次跑了两小时的任务会沉到底下 —— 而它可能正在跑
    const g = groupBySession([row(1, 100, "a"), row(2, 9_000, "a")], []);
    expect(groupAt(g[0]!)).toBe(9_000);
  });

  it("组内永远按时间正序，不跟随表头的排序", () => {
    // 第 1 轮到第 47 轮是有顺序的，按耗时排会把这个顺序打散，
    // 而「上下文是从哪一轮开始涨的」正需要它
    const g = groupBySession([row(3, 300, "a"), row(1, 100, "a"), row(2, 200, "a")], []);
    expect(sortWithin(g[0]!).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("数得出一组里翻了几条", () => {
    const bad = { ...row(2, 200, "a"), state: "failed" as const };
    const g = groupBySession([row(1, 100, "a"), bad, row(3, 300, "a")], []);
    expect(failedIn(g[0]!)).toBe(1);
  });

  it("空输入给空结果，不是一个空组", () => {
    expect(groupBySession([], [])).toEqual([]);
  });
});
