import { describe, expect, it } from "vitest";
import type { ClientView, CoreEvent, GroupView, ProviderView, RouteView, RuleView } from "@/types";
import { buildChain } from "./chain";
import { activityOf, applyFlightEvent, type Flight } from "./flights";

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
const up = (name: string) => ({ name, disabled: false, health: "ok" }) as ProviderView;

/** 默认路由：opus 直连 anthropic，其余进策略组 main；codex 路由整条给 chatgpt */
const ov = {
  clients: [key("default"), key("claude-code"), key("codex", { route: "codex" })],
  routes: [
    route("default", [rule("opus", { to: "anthropic" }), rule("catch-all", { conditions: [], catch_all: true, to: "main" })], {
      default: true,
    }),
    route("codex", [rule("catch-all", { conditions: [], catch_all: true, to: "chatgpt" })]),
  ],
  groups: [group("__all__", [], { builtin: true }), group("main", ["anthropic", "openrouter"])],
  providers: [up("anthropic"), up("openrouter"), up("chatgpt")],
};

const started = (id: number, client: string): CoreEvent =>
  ({ kind: "request_started", id, client, provider: "anthropic", billing: "per-token", model: "m", method: "POST", path: "/v1/messages", at_ms: 0 }) as CoreEvent;
const routed = (id: number, group: string | null, ...providers: string[]): CoreEvent =>
  ({
    kind: "request_routed",
    id,
    rule: "r",
    group,
    attempts: providers.map((provider) => ({ provider, outcome: "served" })),
    billing: "per-token",
  }) as CoreEvent;
const finished = (id: number): CoreEvent =>
  ({ kind: "request_finished", id, model: "m", status: 200, bytes: 1, duration_ms: 1 }) as CoreEvent;

describe("在途请求", () => {
  it("开始 → 已路由 → 结束；和在途请求无关的事件不动它", () => {
    const f = new Map<number, Flight>();
    expect(applyFlightEvent(f, started(1, "claude-code"))).toBe("changed");
    expect(f.get(1)).toEqual({ client: "claude-code", routed: null });
    // 故障转移过：服务它的是尝试链的最后一跳
    expect(applyFlightEvent(f, routed(1, "main", "anthropic", "openrouter"))).toBe("changed");
    expect(f.get(1)?.routed).toEqual({ group: "main", upstream: "openrouter" });
    expect(applyFlightEvent(f, finished(2))).toBeNull();
    expect(applyFlightEvent(f, routed(3, null, "chatgpt"))).toBeNull();
    // 结束只报告，不自己拿掉 —— 留一小会儿由调用方定
    expect(applyFlightEvent(f, finished(1))).toBe("ended");
    expect(f.has(1)).toBe(true);
  });

  it("还没路由：只亮「密钥 → 路由」；没指定路由的密钥走默认路由", () => {
    const chain = buildChain(ov);
    const a = activityOf(new Map([[1, { client: "claude-code", routed: null }]]), ov, chain)!;
    expect([...a.edges]).toEqual(["key:claude-code>route:default"]);
    expect(a.nodes.get("key:claude-code")).toBe(1);
    expect(a.nodes.has("up:anthropic")).toBe(false);
  });

  it("经策略组、直连上游两种路；同一站上的请求数相加", () => {
    const chain = buildChain(ov);
    const a = activityOf(
      new Map<number, Flight>([
        [1, { client: "claude-code", routed: { group: "main", upstream: "openrouter" } }],
        [2, { client: "default", routed: { group: null, upstream: "anthropic" } }],
        [3, { client: "codex", routed: { group: null, upstream: "chatgpt" } }],
      ]),
      ov,
      chain,
    )!;
    expect(a.edges.has("route:default>group:main")).toBe(true);
    expect(a.edges.has("group:main>up:openrouter")).toBe(true);
    // 直连的线穿过策略组那一列
    expect(a.edges.has("route:default>via:anthropic")).toBe(true);
    expect(a.edges.has("via:anthropic>up:anthropic")).toBe(true);
    expect(a.edges.has("route:codex>via:chatgpt")).toBe(true);
    expect(a.nodes.get("route:default")).toBe(2);
    expect(a.edges.has("group:main>up:anthropic")).toBe(false);
  });

  it("图上已经没有的那一站到此为止；没有在途请求时为空", () => {
    const chain = buildChain(ov);
    const a = activityOf(
      new Map<number, Flight>([
        [1, { client: "claude-code", routed: { group: "gone", upstream: "anthropic" } }],
        [2, { client: "deleted-key", routed: null }],
      ]),
      ov,
      chain,
    )!;
    expect([...a.edges]).toEqual(["key:claude-code>route:default"]);
    expect(a.nodes.has("key:deleted-key")).toBe(false);
    expect(activityOf(new Map(), ov, chain)).toBeNull();
  });
});
