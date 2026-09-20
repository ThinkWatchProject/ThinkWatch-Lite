import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, facets, filterRows, sortRows } from "./requestTable";
import type { RequestRow } from "./types";
import { plain } from "@/i18n/core.i18n";

function row(p: Partial<RequestRow> & { id: number }): RequestRow {
  return {
    client: "claude-code",
    provider: "relay",
    path: "/v1/messages",
    atMs: 1_000_000 + p.id,
    state: "done",
    ...p,
  };
}

describe("排序", () => {
  /**
   * 这条是这个文件存在的理由。
   *
   * 一个还在跑的请求没有耗时。当成 0 会让它在「最快」那一头堆成一片，
   * 当成无穷大会在「最慢」那一头堆成一片 —— 两种都是拿缺失值冒充一个
   * 测量结果，而按耗时排序的人恰恰是在找极值。
   */
  it("没有值的行永远在最后，两个方向都是", () => {
    const rows = [
      row({ id: 1, durationMs: 300 }),
      row({ id: 2, state: "in_flight" }), // 还在跑，没有耗时
      row({ id: 3, durationMs: 50 }),
    ];
    expect(sortRows(rows, "duration", "asc").map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortRows(rows, "duration", "desc").map((r) => r.id)).toEqual([1, 3, 2]);
  });

  it("并列时新的在前，所以顺序是稳定的", () => {
    const rows = [
      row({ id: 1, atMs: 100, durationMs: 200 }),
      row({ id: 2, atMs: 300, durationMs: 200 }),
    ];
    expect(sortRows(rows, "duration", "asc").map((r) => r.id)).toEqual([2, 1]);
  });

  it("不改动传进来的数组", () => {
    const rows = [row({ id: 1, durationMs: 9 }), row({ id: 2, durationMs: 1 })];
    sortRows(rows, "duration", "asc");
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  /**
   * 金额同理，而且更要紧：算不出价钱的那几行（订阅制上游、价目表里没有
   * 的模型）当成 $0 的话，按花费升序排出来的「最便宜的几次」全是它们，
   * 而它们根本没参加这场比较。
   */
  it("按花费排，算不出价钱的排最后", () => {
    const rows = [
      row({ id: 1, costMicros: 18_000 }),
      row({ id: 2 }), // 订阅制，没有金额
      row({ id: 3, costMicros: 400 }),
    ];
    expect(sortRows(rows, "cost", "asc").map((r) => r.id)).toEqual([3, 1, 2]);
    expect(sortRows(rows, "cost", "desc").map((r) => r.id)).toEqual([1, 3, 2]);
  });

  /** 按 token 排的是输入加输出 —— 只看输出会把长上下文那几次藏起来 */
  it("按 token 排看的是总量", () => {
    const rows = [
      row({ id: 1, inputTokens: 100, outputTokens: 900 }),
      row({ id: 2, inputTokens: 120_000, outputTokens: 20 }),
      row({ id: 3, inputTokens: 50, outputTokens: 50 }),
    ];
    expect(sortRows(rows, "tokens", "desc").map((r) => r.id)).toEqual([2, 1, 3]);
  });

  it("只有一半用量的行不参加 token 排序", () => {
    const rows = [row({ id: 1, inputTokens: 100 }), row({ id: 2, inputTokens: 1, outputTokens: 1 })];
    expect(sortRows(rows, "tokens", "desc").map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("过滤", () => {
  const rows = [
    row({ id: 1, client: "claude-code", provider: "relay", state: "failed", error: plain("上游超时") }),
    row({ id: 2, client: "codex", provider: "official", path: "/v1/models" }),
  ];

  it("空过滤器放过一切", () => {
    expect(filterRows(rows, EMPTY_FILTER)).toHaveLength(2);
  });

  it("只看失败的", () => {
    const r = filterRows(rows, { ...EMPTY_FILTER, failedOnly: true });
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  /**
   * 客户端取消的不是失败。混进「只看失败」的话，按过 Esc 的那些会把真正
   * 要查的上游错误淹没。
   */
  it("只看失败时不含客户端取消的", () => {
    const withCancelled = [...rows, row({ id: 3, state: "cancelled" })];
    const r = filterRows(withCancelled, { ...EMPTY_FILTER, failedOnly: true });
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  /**
   * 排查时你记得住的常常是错误里的那半句话，而不是哪个字段装着它。
   * 所以自由文本要覆盖错误信息 —— 只搜路径的话，「超时那几条」搜不出来。
   */
  it("自由文本也搜错误信息", () => {
    const r = filterRows(rows, { ...EMPTY_FILTER, q: "超时" });
    expect(r.map((x) => x.id)).toEqual([1]);
  });

  it("自由文本不分大小写", () => {
    expect(filterRows(rows, { ...EMPTY_FILTER, q: "CODEX" })).toHaveLength(1);
  });

  /** 模型现在是表上的一列，「只看 opus 那几条」就该搜得出来 */
  it("自由文本也搜模型", () => {
    const withModel = [
      row({ id: 1, model: "claude-opus-4-5" }),
      row({ id: 2, model: "claude-haiku-4-5" }),
    ];
    expect(filterRows(withModel, { ...EMPTY_FILTER, q: "opus" }).map((x) => x.id)).toEqual([1]);
  });

  it("客户端和上游是与的关系", () => {
    const r = filterRows(rows, {
      ...EMPTY_FILTER,
      client: "claude-code",
      provider: "official",
    });
    expect(r).toHaveLength(0);
  });
});

describe("过滤下拉的取值", () => {
  /**
   * **按出现过的，不是按配置里的。**配了三个上游而只有一个在收流量时，
   * 另外两个出现在下拉里只会让人以为自己筛错了。
   */
  it("只列出真的出现过的", () => {
    const f = facets([
      row({ id: 1, client: "codex", provider: "relay" }),
      row({ id: 2, client: "codex", provider: "relay" }),
    ]);
    expect(f.clients).toEqual(["codex"]);
    expect(f.providers).toEqual(["relay"]);
  });
});
