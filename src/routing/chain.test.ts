import { describe, expect, it } from "vitest";
import type { ClientView, GroupView, ProviderView, RouteView, RuleView } from "@/types";
import { buildChain, chainId, DENSE_FROM, layoutChain, litBy, NODE_H, type Chain } from "./chain";

const key = (name: string, x: Partial<ClientView> = {}): ClientView => ({
  name,
  key: `tw-${name}`,
  max_concurrent: null,
  route: null,
  allow: null,
  ...x,
});
const rule = (name: string, x: Partial<RuleView> = {}): RuleView => ({
  name,
  conditions: [{ field: "model", values: [`${name}-*`] }],
  catch_all: false,
  phase_two: false,
  shadowed: false,
  ...x,
});
const catchAll = (name: string, to: string): RuleView => rule(name, { conditions: [], catch_all: true, to });
const route = (name: string, rules: RuleView[], x: Partial<RouteView> = {}): RouteView => ({
  name,
  default: false,
  builtin: false,
  has_catch_all: true,
  clients: [],
  rules,
  ...x,
});
const group = (name: string, providers: string[], x: Partial<GroupView> = {}): GroupView => ({
  name,
  builtin: false,
  kind: "fallback",
  session_affinity: true,
  selected: null,
  providers,
  hurts_cache: false,
  ...x,
});
const ALL = group("__all__", [], { builtin: true, session_affinity: false });
const up = (name: string, x: Partial<ProviderView> = {}) => ({ name, disabled: false, health: "ok", ...x }) as ProviderView;

const ids = (c: Chain, layer: number) => c.nodes.filter((n) => n.layer === layer).map((n) => n.id);
const edge = (c: Chain, from: string, to: string) => c.edges.find((e) => e.from === from && e.to === to);

/** 模拟页面上那份配置：默认路由三条规则，codex 路由有拒绝，一个没被引用的策略组 */
function sample() {
  return {
    clients: [key("default"), key("claude-code"), key("codex", { route: "codex" })],
    routes: [
      route("codex", [
        rule("no-opus", { to: null, deny: "no" }),
        rule("qwen", { to: "openrouter" }),
        catchAll("catch-all", "chatgpt"),
      ]),
      route("default", [rule("opus", { to: "anthropic" }), rule("ds", { to: "deepseek" }), catchAll("catch-all", "main")], {
        default: true,
      }),
    ],
    groups: [ALL, group("main", ["anthropic", "openrouter"]), group("budget", ["deepseek", "openrouter"], { kind: "cheapest" })],
    providers: [up("anthropic"), up("deepseek"), up("openrouter"), up("chatgpt")],
  };
}

describe("路由图的连线", () => {
  it("刚装好：密钥 → 默认路由 → 全部上游 → 每个上游", () => {
    const c = buildChain({
      clients: [key("default")],
      routes: [route("default", [catchAll("catch-all", "__all__")], { default: true, builtin: true })],
      groups: [ALL],
      providers: [up("a"), up("b")],
    });
    expect(c.middle).toBe(true);
    expect(ids(c, 0)).toEqual(["key:default"]);
    expect(ids(c, 1)).toEqual(["route:default"]);
    expect(ids(c, 2)).toEqual(["group:__all__"]);
    expect(ids(c, 3)).toEqual(["up:a", "up:b"]);
    expect(c.edges.map((e) => e.id)).toEqual([
      "key:default>route:default",
      "route:default>group:__all__",
      "group:__all__>up:a",
      "group:__all__>up:b",
    ]);
    expect(c.nodes.every((n) => !n.idle)).toBe(true);
  });

  it("直连上游的规则穿过策略组那一列；按路由、规则的先后排；没被引用的策略组排最后、画成闲置", () => {
    const c = buildChain(sample());
    // 默认路由排第一，它的密钥也排在前面
    expect(ids(c, 1)).toEqual(["route:default", "route:codex"]);
    expect(ids(c, 0)).toEqual(["key:default", "key:claude-code", "key:codex"]);
    expect(ids(c, 2)).toEqual([
      "via:anthropic",
      "via:deepseek",
      "group:main",
      "deny",
      "via:openrouter",
      "via:chatgpt",
      "group:budget",
    ]);
    // 内置的「全部上游」没被引用：不画
    expect(c.nodes.some((n) => n.id === "group:__all__")).toBe(false);
    expect(c.nodes.find((n) => n.id === "group:budget")?.idle).toBe(true);
    expect(edge(c, "group:budget", "up:deepseek")?.idle).toBe(true);
    expect(edge(c, "route:default", "via:anthropic")?.idle).toBe(false);
    expect(edge(c, "via:anthropic", "up:anthropic")?.idle).toBe(false);
    // 直连的线平着走：上游按最靠上的前驱排
    expect(ids(c, 3)).toEqual(["up:anthropic", "up:deepseek", "up:openrouter", "up:chatgpt"]);
  });

  it("被兜底挡住的、选定上游之后才判断的、只附加改写的规则不画", () => {
    const c = buildChain({
      clients: [key("default")],
      routes: [
        route(
          "default",
          [
            rule("rewrite", { set: { model: "m", max_tokens: null, thinking: null } }),
            rule("late", { to: null, deny: "x", phase_two: true }),
            catchAll("catch-all", "a"),
            rule("after", { to: "b", shadowed: true }),
          ],
          { default: true },
        ),
      ],
      groups: [ALL],
      providers: [up("a"), up("b")],
    });
    expect(c.middle).toBe(false);
    expect(c.edges.map((e) => e.id)).toEqual(["key:default>route:default", "route:default>up:a"]);
    expect(c.nodes.find((n) => n.id === "up:b")?.idle).toBe(true);
  });

  it("没有策略组、没有拒绝时路由直接连上游，不画中间那一列", () => {
    const c = buildChain({
      clients: [key("default")],
      routes: [route("default", [rule("x", { to: "b" }), catchAll("catch-all", "a")], { default: true })],
      groups: [ALL],
      providers: [up("a"), up("b")],
    });
    expect(c.middle).toBe(false);
    expect(ids(c, 2)).toEqual([]);
    expect(c.nodes.some((n) => n.kind === "via")).toBe(false);
    expect(edge(c, "route:default", "up:b")).toBeDefined();
  });

  it("停用的密钥、停用的上游不在活路上", () => {
    const c = buildChain({
      clients: [key("default"), key("old", { route: "legacy", disabled: true })],
      routes: [
        route("default", [catchAll("catch-all", "__all__")], { default: true }),
        route("legacy", [catchAll("catch-all", "b")]),
      ],
      groups: [ALL],
      providers: [up("a"), up("b", { disabled: true })],
    });
    const node = (id: string) => c.nodes.find((n) => n.id === id)!;
    expect(node("key:old").idle).toBe(true);
    expect(node("route:legacy").idle).toBe(true);
    expect(node("up:b").idle).toBe(true);
    expect(edge(c, "group:__all__", "up:b")?.idle).toBe(true);
    expect(edge(c, "group:__all__", "up:a")?.idle).toBe(false);
  });
});

describe("悬停点亮", () => {
  it("悬停策略组：用它的路由、那些路由的密钥和它的成员亮，别的去向不亮", () => {
    const c = buildChain(sample());
    const lit = litBy(c, chainId.group("main"))!;
    expect([...lit.nodes].sort()).toEqual(
      ["group:main", "key:claude-code", "key:default", "route:default", "up:anthropic", "up:openrouter"].sort(),
    );
    expect(lit.edges.has("route:default>group:main")).toBe(true);
    expect(lit.edges.has("route:default>via:anthropic")).toBe(false);
    expect(lit.edges.has("via:openrouter>up:openrouter")).toBe(false);
  });

  it("悬停上游：经过它的每一条路都亮，同一个策略组里的其他成员不亮", () => {
    const c = buildChain(sample());
    const lit = litBy(c, chainId.upstream("openrouter"))!;
    expect(lit.nodes.has("key:codex")).toBe(true);
    expect(lit.nodes.has("route:codex")).toBe(true);
    expect(lit.nodes.has("group:main")).toBe(true);
    expect(lit.nodes.has("group:budget")).toBe(true);
    expect(lit.nodes.has("up:anthropic")).toBe(false);
    expect(lit.edges.has("group:main>up:anthropic")).toBe(false);
  });

  it("什么都没悬停时不点亮", () => {
    expect(litBy(buildChain(sample()), null)).toBeNull();
  });
});

describe("路由图的排版", () => {
  it("四列等宽、不出界；节点不重叠；每条线都画出来", () => {
    const c = buildChain(sample());
    const l = layoutChain(c, 860);
    expect(l.cols.map((x) => x.layer)).toEqual([0, 1, 2, 3]);
    const last = l.cols[l.cols.length - 1]!;
    expect(last.x + last.w).toBeCloseTo(860);
    expect(l.edges).toHaveLength(c.edges.length);
    for (const layer of [0, 1, 2, 3]) {
      const ns = l.nodes.filter((p) => p.node.layer === layer).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ns.length; i++) expect(ns[i]!.y).toBeGreaterThanOrEqual(ns[i - 1]!.y + ns[i - 1]!.h);
      for (const p of ns) expect(p.y + p.h).toBeLessThanOrEqual(l.height + 0.001);
    }
  });

  it("窗口很窄时列变窄，列之间仍留出弯线的空", () => {
    const l = layoutChain(buildChain(sample()), 520);
    for (let i = 1; i < l.cols.length; i++) {
      expect(l.cols[i]!.x - (l.cols[i - 1]!.x + l.cols[i - 1]!.w)).toBeGreaterThanOrEqual(36);
    }
  });

  it("一列里节点多时收紧一档，图不会比表还高", () => {
    const s = sample();
    expect(layoutChain(buildChain(s), 860).dense).toBe(false);
    const many = Array.from({ length: DENSE_FROM }, (_, i) => up(`u${i}`));
    const big = buildChain({ ...s, providers: many, groups: [ALL], routes: [route("default", [catchAll("c", "__all__")], { default: true })] });
    const l = layoutChain(big, 860);
    expect(l.dense).toBe(true);
    const ups = l.nodes.filter((p) => p.node.layer === 3);
    expect(ups).toHaveLength(DENSE_FROM);
    expect(ups[0]!.h).toBeLessThan(NODE_H);
    expect(l.height).toBeLessThan(DENSE_FROM * NODE_H);
  });
});
