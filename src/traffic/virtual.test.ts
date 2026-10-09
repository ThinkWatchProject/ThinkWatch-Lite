import { describe, expect, it } from "vitest";
import type { RequestRow } from "@/types";
import { lines, type Group } from "./grouping";
import { capped, indexAt, itemsOf, NAME_PX, offsetsOf, textWidth, widest } from "./virtual";

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

describe("名字封顶", () => {
  it("没到上限的照字数算，超过的按上限算：上限是像素，一格约 6.5px，宁可估宽", () => {
    expect(capped(textWidth("claude-sonnet-5"), NAME_PX.model)).toBe(15);
    expect(capped(400, NAME_PX.model)).toBe(32);
    expect(capped(textWidth("公司内部的 Claude 中转（北京机房备用线路二号）"), NAME_PX.upstream, 22)).toBe(22);
    // 旁边的标志、记号占掉的那截从上限里扣
    expect(capped(400, 160, 18)).toBe(22);
    expect(capped(400, 160)).toBe(25);
  });

  it("常见的名字不截断：估宽在上限以内", () => {
    for (const m of ["claude-sonnet-4-5-20250929", "qwen3-coder-480b-a35b-instruct", "gpt-5.1-codex-max"])
      expect(capped(textWidth(m), NAME_PX.model)).toBe(textWidth(m));
    for (const u of ["bedrock-us-east-1", "azure-openai-eastus2", "阿里云百炼"])
      expect(capped(textWidth(u), NAME_PX.upstream, 22)).toBe(textWidth(u));
  });

  it("挑表头里垫哪几格时，一个短名字带着一排徽标胜过三个超长的名字", () => {
    // 上游那一格 = 名字（封顶）+ 徽标。三个超长名字、没有徽标；一个短名字带两枚徽标
    const rows = [
      { name: "x".repeat(60), badges: 0 },
      { name: "y".repeat(80), badges: 0 },
      { name: "z".repeat(70), badges: 0 },
      { name: "openrouter", badges: 2 },
    ];
    const w = (i: number) => capped(textWidth(rows[i]!.name), NAME_PX.upstream, 22) + rows[i]!.badges * 10;
    expect(widest(rows.length, 3, w)[0]).toBe(3);
    // 不封顶的话它根本挑不进去
    expect(widest(rows.length, 3, (i) => textWidth(rows[i]!.name) + rows[i]!.badges * 10)).not.toContain(3);
  });
});
