import { describe, expect, it } from "vitest";
import type { AttemptView, ClientView, CoreEvent, GroupView, ProviderView, RouteView, RuleView } from "@/types";
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

/** 默认路由：opus 直连 anthropic，其余进策略组 main；codex 路由拒绝 opus，其余整条给 chatgpt */
const ov = {
  clients: [key("default"), key("claude-code"), key("codex", { route: "codex" })],
  routes: [
    route("default", [rule("opus", { to: "anthropic" }), rule("catch-all", { conditions: [], catch_all: true, to: "main" })], {
      default: true,
    }),
    route("codex", [
      rule("no-opus", { to: null, deny: "no" }),
      rule("catch-all", { conditions: [], catch_all: true, to: "chatgpt" }),
    ]),
  ],
  groups: [group("__all__", [], { builtin: true }), group("main", ["anthropic", "openrouter"])],
  providers: [up("anthropic"), up("openrouter"), up("chatgpt")],
};

/** 开始事件：走的路由、做决定的规则、交给的策略组都在里面 */
const started = (id: number, client: string, route: string, rule: string, group: string | null = null): CoreEvent => ({
  kind: "request_started",
  id,
  client,
  route,
  rule,
  group,
  rewritten_by: [],
  provider: rule === "no-opus" ? "" : "anthropic",
  billing: "per-token",
  model: "m",
  method: "POST",
  path: "/v1/messages",
  at_ms: 0,
});
const attempt = (provider: string, outcome: AttemptView["outcome"] = "served"): AttemptView => ({ provider, outcome, ms: 1 });
const routed = (id: number, f: Pick<Flight, "route" | "rule" | "group">, attempts: AttemptView[], denied_by?: string): CoreEvent => ({
  kind: "request_routed",
  id,
  ...f,
  rewritten_by: [],
  denied_by,
  attempts,
  billing: "per-token",
});
const finished = (id: number): CoreEvent =>
  ({ kind: "request_finished", id, model: "m", status: 200, bytes: 1, duration_ms: 1 }) as CoreEvent;

/** 一串事件落完之后的在途请求 */
function fly(...events: CoreEvent[]): Map<number, Flight> {
  const f = new Map<number, Flight>();
  for (const ev of events) applyFlightEvent(f, ev);
  return f;
}

describe("在途请求", () => {
  it("开始 → 已路由 → 结束；和在途请求无关的事件不动它", () => {
    const f = new Map<number, Flight>();
    expect(applyFlightEvent(f, started(1, "claude-code", "default", "catch-all", "main"))).toBe("changed");
    expect(f.get(1)).toEqual({ client: "claude-code", route: "default", rule: "catch-all", group: "main", upstream: null });
    // 故障转移过：接下它的是尝试链里 served 的那一跳
    const decided = { route: "default", rule: "catch-all", group: "main" };
    expect(applyFlightEvent(f, routed(1, decided, [attempt("anthropic", "status"), attempt("openrouter")]))).toBe("changed");
    expect(f.get(1)?.upstream).toBe("openrouter");
    expect(applyFlightEvent(f, finished(2))).toBeNull();
    expect(applyFlightEvent(f, routed(3, decided, [attempt("chatgpt")]))).toBeNull();
    // 结束只报告，不自己拿掉 —— 留一小会儿由调用方定
    expect(applyFlightEvent(f, finished(1))).toBe("ended");
    expect(f.has(1)).toBe(true);
  });

  it("选定上游之后被拒、一个上游都没接下：画不到上游", () => {
    const decided = { route: "default", rule: "catch-all", group: "main" };
    const denied = fly(started(1, "claude-code", "default", "catch-all", "main"), routed(1, decided, [attempt("anthropic", "error")], "late"));
    expect(denied.get(1)?.upstream).toBeNull();
    const none = fly(started(2, "claude-code", "default", "catch-all", "main"), routed(2, decided, []));
    expect(none.get(2)?.upstream).toBeNull();
  });

  it("开始时就画到策略组；路由按事件里的，不按密钥现在的配置", () => {
    const chain = buildChain(ov);
    // codex 这把密钥现在配的是 codex 路由，但这个请求开始时走的是默认路由（配置后来改过）
    const a = activityOf(fly(started(1, "codex", "default", "catch-all", "main")), chain)!;
    expect(a.nodes.has("route:default")).toBe(true);
    expect(a.nodes.has("route:codex")).toBe(false);
    expect(a.edges.has("route:default>group:main")).toBe(true);
    expect(a.nodes.has("up:anthropic")).toBe(false);
  });

  it("直连上游的规则在上游接下之前只画到路由；被规则拒绝的画到拒绝", () => {
    const chain = buildChain(ov);
    const direct = activityOf(fly(started(1, "claude-code", "default", "opus")), chain)!;
    expect([...direct.edges]).toEqual(["key:claude-code>route:default"]);
    const deny = activityOf(fly(started(2, "codex", "codex", "no-opus")), chain)!;
    expect([...deny.edges]).toEqual(["key:codex>route:codex", "route:codex>deny"]);
    expect(deny.nodes.get("deny")).toBe(1);
    // 拒绝之后的路由事件没有尝试链：还是停在拒绝
    const after = activityOf(fly(started(2, "codex", "codex", "no-opus"), routed(2, { route: "codex", rule: "no-opus", group: null }, [])), chain)!;
    expect([...after.edges]).toEqual(["key:codex>route:codex", "route:codex>deny"]);
  });

  it("经策略组、直连上游两种路；同一站上的请求数相加", () => {
    const chain = buildChain(ov);
    const a = activityOf(
      fly(
        started(1, "claude-code", "default", "catch-all", "main"),
        routed(1, { route: "default", rule: "catch-all", group: "main" }, [attempt("anthropic", "status"), attempt("openrouter")]),
        started(2, "default", "default", "opus"),
        routed(2, { route: "default", rule: "opus", group: null }, [attempt("anthropic")]),
        started(3, "codex", "codex", "catch-all"),
        routed(3, { route: "codex", rule: "catch-all", group: null }, [attempt("chatgpt")]),
      ),
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
      fly(
        started(1, "claude-code", "default", "catch-all", "gone"),
        routed(1, { route: "default", rule: "catch-all", group: "gone" }, [attempt("anthropic")]),
        started(2, "deleted-key", "default", "catch-all", "main"),
        started(3, "claude-code", "renamed", "catch-all", "main"),
      ),
      chain,
    )!;
    expect([...a.edges]).toEqual(["key:claude-code>route:default"]);
    expect(a.nodes.has("key:deleted-key")).toBe(false);
    expect(a.nodes.get("key:claude-code")).toBe(2);
    expect(activityOf(new Map(), chain)).toBeNull();
  });
});
