import { describe, expect, it } from "vitest";
import { arrange, type Rankable } from "./arrange";

const items: Rankable[] = [
  { id: "page:dashboard", group: "pages", title: "Overview", keywords: ["概览"] },
  { id: "page:keys", group: "pages", title: "Keys", keywords: ["密钥"] },
  { id: "page:settings", group: "pages", title: "Settings", keywords: ["设置"] },
  { id: "action:new-key", group: "actions", title: "New key…" },
  { id: "action:rail", group: "actions", title: "Collapse sidebar" },
  { id: "action:new-proxy", group: "actions", title: "New proxy…", searchOnly: true },
  { id: "upstream:deepseek", group: "upstreams", title: "deepseek", keywords: ["https://api.deepseek.com"], searchOnly: true },
  { id: "upstream:anthropic", group: "upstreams", title: "anthropic", searchOnly: true },
  { id: "key:claude-code", group: "keys", title: "claude-code", keywords: ["claude-code"], searchOnly: true },
  { id: "group:budget", group: "groups", title: "budget", keywords: ["deepseek", "gemini"], searchOnly: true },
  { id: "connection:local", group: "connections", title: "This Mac", searchOnly: true },
  { id: "connection:studio", group: "connections", title: "Studio", keywords: ["192.168.1.40"], searchOnly: true },
];

const titles = (shown: ReturnType<typeof arrange>) => shown.map((g) => [g.group, g.items.map((x) => x.item.title)]);

describe("命令面板的结果排列", () => {
  it("空查询：页面、操作，不列只在搜时出现的实体", () => {
    const shown = arrange({ items, query: "", scope: null, usage: {} });
    expect(titles(shown)).toEqual([
      ["pages", ["Overview", "Keys", "Settings"]],
      ["actions", ["New key…", "Collapse sidebar"]],
    ]);
  });

  it("空查询：最近使用排在最前，只列现在还在的，值和下面那一行分开", () => {
    const usage = {
      "upstream:deepseek": { n: 1, at: 30 },
      "upstream:gone": { n: 9, at: 40 },
      "page:keys": { n: 2, at: 20 },
    };
    const shown = arrange({ items, query: "", scope: null, usage });
    expect(shown[0]!.group).toBe("recent");
    expect(shown[0]!.items.map((x) => x.value)).toEqual(["recent:upstream:deepseek", "recent:page:keys"]);
    // 同一项在「页面」里还有一行，值不一样
    expect(shown[1]!.items.map((x) => x.value)).toContain("page:keys");
  });

  it("有查询：组按各自最好的一项排，第一行是全场最好的", () => {
    const shown = arrange({ items, query: "deep", scope: null, usage: {} });
    expect(titles(shown)).toEqual([
      ["upstreams", ["deepseek"]],
      ["groups", ["budget"]],
    ]);
  });

  it("有查询：只在搜时出现的动作也出现", () => {
    const shown = arrange({ items, query: "proxy", scope: null, usage: {} });
    expect(titles(shown)).toEqual([["actions", ["New proxy…"]]]);
  });

  it("有像样的结果时，只是散着沾边的不列", () => {
    // `cla`：claude-code 名字开头对上；Collapse sidebar 只是 c…l…a 散着沾边
    const shown = arrange({ items, query: "cla", scope: null, usage: {} });
    expect(titles(shown)).toEqual([["keys", ["claude-code"]]]);
  });

  it("全是沾边的时候照常列", () => {
    const shown = arrange({ items, query: "csb", scope: null, usage: {} });
    expect(titles(shown)).toEqual([["actions", ["Collapse sidebar"]]]);
  });

  it("常用的在分数接近时靠前，但压不过名字开头就对上的", () => {
    const usage = { "upstream:anthropic": { n: 50, at: Date.now() } };
    const shown = arrange({ items, query: "a", scope: null, usage });
    const ups = shown.find((g) => g.group === "upstreams")!;
    expect(ups.items[0]!.item.title).toBe("anthropic");
  });

  it("额外的结果（请求）按给的分数进来，每组有上限", () => {
    const extra = Array.from({ length: 10 }, (_, i) => ({
      item: { id: `request:${i}`, group: "requests", title: `deepseek-chat #${i}` },
      score: 0.9,
    }));
    const shown = arrange({ items, extra, query: "deep", scope: null, usage: {} });
    const req = shown.find((g) => g.group === "requests")!;
    expect(req.items).toHaveLength(5);
    // 分数一样时保留给的顺序
    expect(req.items[0]!.item.id).toBe("request:0");
  });

  it("进了下一级：只有那一组，查询在组里筛", () => {
    expect(titles(arrange({ items, query: "", scope: "connections", usage: {} }))).toEqual([
      ["connections", ["This Mac", "Studio"]],
    ]);
    expect(titles(arrange({ items, query: "192.168", scope: "connections", usage: {} }))).toEqual([
      ["connections", ["Studio"]],
    ]);
    expect(arrange({ items, query: "zzz", scope: "connections", usage: {} })).toEqual([]);
  });
});
