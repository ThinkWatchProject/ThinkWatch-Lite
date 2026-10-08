import { describe, expect, it } from "vitest";
import type { RequestRow } from "@/types";
import { lines, type Group } from "./grouping";
import { indexAt, itemsOf, offsetsOf, textWidth, widest } from "./virtual";

const row = (id: number, atMs: number, session?: string): RequestRow => ({
  id,
  client: "claude-code",
  provider: "relay",
  path: "/v1/messages",
  atMs,
  state: "done",
  ...(session ? { session } : {}),
});

describe("表里从上到下的每一项", () => {
  it("平表：一条请求一项，上一行是数组里的前一条", () => {
    const rows = [row(3, 300), row(2, 200), row(1, 100)];
    const items = itemsOf(rows, undefined, new Set());
    expect(items.map((x) => x.key)).toEqual(["r3", "r2", "r1"]);
    expect(items.map((x) => (x.kind === "request" ? x.prev?.id : null))).toEqual([undefined, 3, 2]);
  });

  it("归组：组头，展开了的组跟着它的请求（组内按时间正序），无主的自己一行、不和上一行比", () => {
    const a1 = row(1, 100, "a");
    const a2 = row(3, 300, "a");
    const lone = row(2, 200);
    const groups: Group[] = [
      { id: "a", session: null, rows: [a2, a1] },
      { id: null, session: null, rows: [lone] },
      { id: "b", session: null, rows: [row(4, 50, "b")] },
    ];
    const items = itemsOf([a2, lone, a1], groups, new Set(["a"]));
    expect(items.map((x) => x.key)).toEqual(["sa", "r1", "r3", "r2", "sb"]);
    const inA = items.filter((x) => x.kind === "request" && x.inGroup === "a");
    expect(inA.map((x) => (x.kind === "request" ? x.prev?.id : null))).toEqual([undefined, 1]);
    const loneItem = items.find((x) => x.key === "r2");
    expect(loneItem?.kind === "request" && loneItem.prev).toBe(undefined);
  });

  it("和键盘走的 lines 是同一个摆法（看得见的那些）", () => {
    const groups: Group[] = [
      { id: "a", session: null, rows: [row(3, 300, "a"), row(1, 100, "a")] },
      { id: null, session: null, rows: [row(2, 200)] },
      { id: "b", session: null, rows: [row(4, 50, "b")] },
    ];
    const open = new Set(["a"]);
    const shown = lines([], groups, open)
      .filter((l) => l.kind === "session" || l.shown)
      .map((l) => (l.kind === "session" ? `s${l.id}` : `r${l.id}`));
    expect(itemsOf([], groups, open).map((x) => x.key)).toEqual(shown);
  });
});

describe("位置", () => {
  it("每一项的上沿和总高", () => {
    expect([...offsetsOf(3, (i) => [10, 20, 30][i]!)]).toEqual([0, 10, 30, 60]);
  });

  it("某个高度落在哪一项上，超出两头的算第一项、最后一项", () => {
    const o = offsetsOf(3, (i) => [10, 20, 30][i]!);
    expect(indexAt(o, -5)).toBe(0);
    expect(indexAt(o, 0)).toBe(0);
    expect(indexAt(o, 9.9)).toBe(0);
    expect(indexAt(o, 10)).toBe(1);
    expect(indexAt(o, 59)).toBe(2);
    expect(indexAt(o, 1000)).toBe(2);
    expect(indexAt(offsetsOf(0, () => 0), 50)).toBe(0);
  });
});

describe("最宽的几项", () => {
  it("由宽到窄取前 k 个，一样宽的取前面的", () => {
    const w = [3, 9, 1, 9, 5, 7];
    expect(widest(w.length, 3, (i) => w[i]!)).toEqual([1, 3, 5]);
    expect(widest(2, 3, (i) => w[i]!)).toEqual([1, 0]);
    expect(widest(0, 3, () => 0)).toEqual([]);
  });

  it("中日韩的字按两个字宽算", () => {
    expect(textWidth("16:42:01")).toBe(8);
    expect(textWidth("已取消")).toBe(6);
    expect(textWidth("3 轮")).toBe(4);
  });
});
