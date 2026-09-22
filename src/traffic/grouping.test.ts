import { describe, expect, it } from "vitest";
import {
  failedIn,
  groupAt,
  groupBySession,
  lines,
  sortWithin,
  step,
  type Cursor,
} from "./grouping";
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

describe("键盘在表里怎么走", () => {
  // 时间倒序，和表默认的排序一样：a 组三条、b 组一条，还有一条无主的
  const rows = [
    row(5, 500, "a"),
    row(4, 400, "b"),
    row(3, 300, "a"),
    row(2, 200),
    row(1, 100, "a"),
  ];
  const groups = groupBySession(rows, []);
  const req = (id: number): Cursor => ({ kind: "request", id });
  const ses = (id: string): Cursor => ({ kind: "session", id });
  /** 从 `at` 起按 `n` 下，每一下落在哪 */
  const walk = (ls: ReturnType<typeof lines>, at: Cursor | null, dir: 1 | -1, n: number) => {
    const out: (Cursor | null)[] = [];
    for (let i = 0; i < n; i++) out.push((at = step(ls, at, dir)));
    return out;
  };

  it("平表就是 rows 的顺序，每一行都看得见", () => {
    const ls = lines(rows, undefined, new Set());
    expect(ls.map((l) => l.id)).toEqual([5, 4, 3, 2, 1]);
    expect(ls.every((l) => l.kind === "request" && l.shown && l.under === null)).toBe(true);
  });

  it("归组时和表里摆的一样：组头，组内按时间正序，折起来的组里的行不算看得见", () => {
    const ls = lines(rows, groups, new Set(["a"]));
    expect(ls.map((l) => `${l.kind === "session" ? "组" : ""}${l.id}`)).toEqual([
      "组a", "1", "3", "5", "组b", "4", "2",
    ]);
    expect(ls.find((l) => l.id === 4)).toMatchObject({ shown: false, under: "b" });
    expect(ls.find((l) => l.id === 2)).toMatchObject({ shown: true, under: null });
  });

  it("↓ 按屏幕上的顺序走，跳过折起来的组里的行，到了底停在原地", () => {
    // 按 rows 走的话是 5 → 4 → 3：在 a 组里往上跳，再跳进折着的 b 组
    const ls = lines(rows, groups, new Set(["a"]));
    expect(walk(ls, null, 1, 7)).toEqual([
      ses("a"), req(1), req(3), req(5), ses("b"), req(2), req(2),
    ]);
  });

  it("↑ 反过来走，到了顶停在原地", () => {
    const ls = lines(rows, groups, new Set(["a"]));
    expect(walk(ls, req(2), -1, 6)).toEqual([
      ses("b"), req(5), req(3), req(1), ses("a"), ses("a"),
    ]);
  });

  it("还没用过键盘、或者选中的那条已经不在表里，从第一行开始，↑ 也是", () => {
    const ls = lines(rows, groups, new Set());
    expect(step(ls, null, 1)).toEqual(ses("a"));
    expect(step(ls, null, -1)).toEqual(ses("a"));
    expect(step(ls, req(99), 1)).toEqual(ses("a"));
  });

  it("选中的那条被折进了组里：从它的位置接着走", () => {
    // 先选中 4，再把 b 折起来
    const ls = lines(rows, groups, new Set());
    expect(step(ls, req(4), 1)).toEqual(req(2));
    expect(step(ls, req(4), -1)).toEqual(ses("b"));
  });

  it("折进最后一组、往下已经没有了，就退回反方向最近的那一行", () => {
    const tail = [row(2, 200), row(1, 100, "a")];
    const ls = lines(tail, groupBySession(tail, []), new Set());
    expect(step(ls, req(1), 1)).toEqual(ses("a"));
  });

  it("一行都看不见时没有落点", () => {
    expect(step(lines([], [], new Set()), null, 1)).toBeNull();
  });
});
