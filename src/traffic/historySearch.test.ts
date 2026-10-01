import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { codesMatching } from "@/i18n/core.i18n";
import { EMPTY_FILTER, type Filter } from "@/requestTable";
import type { ContentHit, RequestRow } from "@/types";
import { mergeFound, oldestCursor, searchMode, searchQuery, type Found } from "./historySearch";

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

const hit = (id: number): ContentHit => ({ id, side: "answer", before: "…", matched: "rm -rf", after: "…" });

function found(p: Partial<Found>): Found {
  return {
    key: "k",
    mode: "older",
    kept: [],
    rows: [],
    hits: new Map(),
    at: null,
    next: null,
    stopped: "end",
    bodiesSinceMs: null,
    busy: false,
    error: undefined,
    ...p,
  };
}

const q = (s: string): Filter => ({ ...EMPTY_FILTER, q: s });

describe("什么时候去库里找", () => {
  it("没有筛选条件时不找：表里就是最近的那些", () => {
    expect(searchMode(EMPTY_FILTER, true)).toBe("off");
    // 只按下「搜索内容」、没有搜索词，什么也不做
    expect(searchMode({ ...EMPTY_FILTER, content: true }, true)).toBe("off");
  });

  /**
   * 列表没装满，读进来的就是全部记录：当场筛完了，再去库里问只会拿回同样的行。
   */
  it("列表没装满时只当场筛", () => {
    expect(searchMode(q("timeout"), false)).toBe("off");
    expect(searchMode({ ...EMPTY_FILTER, failedOnly: true }, false)).toBe("off");
  });

  it("列表装满了，更早的那些交给 core", () => {
    expect(searchMode(q("timeout"), true)).toBe("older");
    expect(searchMode({ ...EMPTY_FILTER, provider: "relay" }, true)).toBe("older");
  });

  /** 内容不在读进来的行上：装没装满都要 core 去读 */
  it("按内容找总是去库里，装没装满都一样", () => {
    expect(searchMode({ ...q("rm -rf"), content: true }, false)).toBe("content");
    expect(searchMode({ ...q("rm -rf"), content: true }, true)).toBe("content");
    // 空白不算搜索词
    expect(searchMode({ ...q("   "), content: true }, false)).toBe("off");
  });
});

describe("从哪一条往前找", () => {
  it("读进来的最老那一条；同一毫秒里按请求号", () => {
    const rows = [row({ id: 9, atMs: 500 }), row({ id: 4, atMs: 100 }), row({ id: 3, atMs: 100 }), row({ id: 7, atMs: 300 })];
    expect(oldestCursor(rows)).toEqual({ at_ms: 100, id: 3 });
    expect(oldestCursor([])).toBeNull();
  });
});

describe("交给 core 的条件", () => {
  it("和界面的筛选一一对应，空串是不限", () => {
    const got = searchQuery(
      { ...EMPTY_FILTER, q: "  Opus ", failedOnly: true, provider: "relay" },
      "older",
      { at_ms: 100, id: 3 },
    );
    expect(got).toMatchObject({
      q: "opus",
      failed: true,
      unpriced: false,
      client: null,
      provider: "relay",
      model: null,
      content: false,
      before: { at_ms: 100, id: 3 },
    });
  });

  it("按内容找时才带 content，一页少一些", () => {
    const a = searchQuery({ ...q("x"), content: true }, "content", null);
    const b = searchQuery(q("x"), "older", null);
    expect(a.content).toBe(true);
    expect(b.content).toBe(false);
    expect(a.limit!).toBeLessThan(b.limit!);
  });

  /**
   * 失败原因在中文界面上是按码翻出来的，库里只有英文原句：照着屏幕上的「超时」搜，
   * 英文原句里没有这两个字。
   */
  it("中文界面带上译文里含着搜索词的码", () => {
    expect(searchQuery(q("超时"), "older", null).error_codes).toContain("gw.upstream.timeout");
    setLang("en");
    expect(searchQuery(q("timeout"), "older", null).error_codes).toEqual([]);
  });

  it("本地应答那句说明里有搜索词时，交 local_matches", () => {
    expect(searchQuery(q("本地"), "older", null).local_matches).toBe(true);
    expect(searchQuery(q("relay"), "older", null).local_matches).toBe(false);
    expect(searchQuery(EMPTY_FILTER, "older", null).local_matches).toBe(false);
    setLang("en");
    expect(searchQuery(q("locally"), "older", null).local_matches).toBe(true);
  });
});

describe("译文里可能含着搜索词的码", () => {
  it("写死的字对得上就算", () => {
    expect(codesMatching("上游响应超时")).toContain("gw.upstream.timeout");
  });

  /** 跨过参数对上的不算：那个参数填进去之后，这几个字多半就不挨着了 */
  it("不跨过参数对", () => {
    // 「上游「{upstream}」使用的代理」：「」使用」两边隔着一个参数
    const codes = codesMatching("上游「」使用");
    expect(codes).not.toContain("l1.config.proxy_undefined");
  });

  it("没有搜索词时一个都不给", () => {
    expect(codesMatching("")).toEqual([]);
  });
});

describe("表里该有的行", () => {
  const f = q("relay");

  it("没在库里找时，就是读进来的里对上的", () => {
    const loaded = [row({ id: 1 }), row({ id: 2, provider: "official" })];
    expect(mergeFound(loaded, f, null).map((r) => r.id)).toEqual([1]);
  });

  it("库里找到的并进来", () => {
    const loaded = [row({ id: 10 })];
    const got = mergeFound(loaded, f, found({ rows: [row({ id: 3 }), row({ id: 2 })] }));
    expect(got.map((r) => r.id).sort((a, b) => a - b)).toEqual([2, 3, 10]);
  });

  /** 实时的那一行更全（脱敏、可疑调用只在事件里有），而且还在变 */
  it("两边都有的用读进来的那个", () => {
    const live = row({ id: 5, durationMs: 900 });
    const fromDb = row({ id: 5, durationMs: 100 });
    const got = mergeFound([live], f, found({ mode: "content", rows: [fromDb] }));
    expect(got).toHaveLength(1);
    expect(got[0]).toBe(live);
  });

  /**
   * 按内容对上的：读进来的那一行按记录对不上（路径、上游里都没有这个词），照样要。
   * 只按记录交回来、这边却对不上的不要 —— 失败原因的码是宽着给的，以屏幕上的为准。
   */
  it("读进来的那一行对不上：按内容对上的才要", () => {
    const a = row({ id: 6, provider: "official" });
    const b = row({ id: 7, provider: "official" });
    const got = mergeFound(
      [a, b],
      q("rm -rf"),
      found({ mode: "content", rows: [a, b], hits: new Map([[6, hit(6)]]) }),
    );
    expect(got.map((r) => r.id)).toEqual([6]);
    expect(got[0]).toBe(a);
  });

  /**
   * 新请求一来，最老的被挤出列表；`older` 是从当时最老的那一条往前找的 —— 挤掉的那几条
   * 两边都不再有，靠 `kept` 留在表里。
   */
  it("搜索开始后被挤出列表的，还在表里", () => {
    const pushedOut = row({ id: 1 });
    const now = [row({ id: 2 }), row({ id: 3 })];
    const got = mergeFound(now, f, found({ kept: [pushedOut, now[0]!] }));
    expect(got.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("还在列表里、但已经对不上的，不因为 kept 留下", () => {
    // 开始搜索时还没算出金额，之后算出来了：「仅显示无法计价」下它该走
    const before = row({ id: 4, inputTokens: 10, outputTokens: 5 });
    const after = { ...before, costMicros: 120 };
    const got = mergeFound([after], { ...EMPTY_FILTER, unpricedOnly: true }, found({ kept: [before] }));
    expect(got).toEqual([]);
  });
});
