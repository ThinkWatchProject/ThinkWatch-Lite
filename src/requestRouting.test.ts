import { describe, expect, it } from "vitest";
import { notSent, routingFacts } from "./requestRouting";
import type { AttemptView, HistoryRow, Msg, RoutingView } from "./types";

/** core 规则拒绝时的那一句（`gw.route.denied`） */
const denied = (rule: string, reason: string): Msg => ({
  code: "gw.route.denied",
  args: { rule, reason },
  text: `Rule \`${rule}\` denied this request: ${reason}`,
});
const unavailable: Msg = {
  code: "gw.model.no_upstream_available",
  args: { model: "moonshotai/kimi-k2", detail: "chatgpt does not offer this model" },
  text: "No upstream is available to serve model moonshotai/kimi-k2: chatgpt does not offer this model",
};
const served = (provider: string, ms = 900): AttemptView => ({ provider, outcome: "served", status: 200, ms });
const overloaded = (provider: string): AttemptView => ({ provider, outcome: "status", status: 529, ms: 1_870 });
/** 网关密钥的用量上限拒绝时的那一句（`gw.key_limit.*`） */
const limited: Msg = {
  code: "gw.key_limit.cost_per_period",
  args: { key: "cursor", max: "$5.00", per: "day", used: "$5.03", resets: "2026-09-26 00:00 +08:00" },
  text: "Gateway key `cursor` has reached its limit of $5.00 per day: $5.03 spent so far. It resets at 2026-09-26 00:00 +08:00.",
};
/** 能服务的上游都满着、等过了也没空出来（`gw.busy_all`） */
const busyAll: Msg = {
  code: "gw.busy_all",
  args: { upstreams: "`anthropic`, `openrouter`" },
  text: "Every upstream that can serve this request is at its concurrency limit (max_concurrent): `anthropic`, `openrouter`. None had a free slot in time; try again shortly.",
};
/** 满着、没发出去的一跳（core 的 `hop_busy`）。`queued`：它是这段对话留着的那一家，等过空位 */
const busy = (provider: string, queued?: number): AttemptView => ({
  provider,
  outcome: "error",
  error: { code: "gw.busy_upstream", args: { upstream: provider, limit: "2" }, text: "" },
  ms: 0,
  skipped: "busy",
  queued_ms: queued ?? null,
});
/** 无响应超时、放弃了的一跳 */
const quiet = (provider: string): AttemptView => ({
  provider,
  outcome: "idle_timeout",
  error: { code: "gw.upstream.idle_timeout", args: { upstream: provider, secs: "300" }, text: "" },
  ms: 300_004,
  usage: { input: 48_210, cache_read: 0, cache_write: 0, estimated: true },
});

function row(routing: Partial<RoutingView>, over: Partial<Pick<HistoryRow, "error" | "provider" | "local">> = {}) {
  return {
    provider: "anthropic",
    local: false,
    error: null,
    ...over,
    routing: { route: "default", rule: "catch-all", group: "main", rewritten_by: [], denied_by: null, attempts: [], ...routing },
  };
}

describe("没有发往任何上游的请求", () => {
  it("上游是空的：规则拒绝的看失败的那一句，其余是选中的上游接不了", () => {
    expect(notSent({ provider: "", error: denied("no-opus", "Opus is not offered") })).toBe("denied");
    expect(notSent({ provider: "", error: unavailable })).toBe("unavailable");
    expect(notSent({ provider: "", error: { code: "gw.route.all_selected_disabled", args: {}, text: "" } })).toBe("unavailable");
  });

  it("密钥的用量上限拒绝的：上游是空的，失败的那一句是 gw.key_limit.*", () => {
    expect(notSent({ provider: "", error: limited })).toBe("limited");
    expect(notSent({ provider: "", error: { ...limited, code: "gw.key_limit.requests_rolling" } })).toBe("limited");
  });

  it("上游都满着：那一行归在最后看过的那一家，也不算它的失败", () => {
    expect(notSent({ provider: "openrouter", error: busyAll })).toBe("busy");
    expect(notSent({ provider: "", error: busyAll })).toBe("busy");
  });

  it("发往了上游的、本地应答的、还没有结局的都不算", () => {
    // 选定上游之后才被拒绝：记在要去的那个上游上
    expect(notSent({ provider: "openrouter", error: denied("no-images", "no images") })).toBeNull();
    expect(notSent({ provider: "", local: true, error: null })).toBeNull();
    expect(notSent({ provider: "", error: undefined })).toBeNull();
    expect(notSent({ provider: "anthropic", error: null })).toBeNull();
  });
});

describe("路由那一页", () => {
  it("本地应答的没有路由", () => {
    expect(routingFacts({ routing: null, error: null, provider: "", local: true }, false)).toBeNull();
  });

  it("一次就成：路由、规则、策略组，尝试链一跳，不加说明", () => {
    const f = routingFacts(row({ attempts: [served("anthropic")] }), false)!;
    expect(f).toMatchObject({ route: "default", rule: "catch-all", ruleDenied: false, group: "main", deniedBy: null, reason: null, note: null });
    expect(f.hops).toEqual([{ attempt: served("anthropic"), denied: false }]);
  });

  it("改写了参数的规则按求值的顺序列出", () => {
    const f = routingFacts(row({ rewritten_by: ["long-context", "relay-no-thinking"], attempts: [served("anthropic")] }), false)!;
    expect(f.rewrittenBy).toEqual(["long-context", "relay-no-thinking"]);
  });

  it("对话延续：沿用本轮路由、留在上次回答的上游才有这一项", () => {
    expect(routingFacts(row({ attempts: [served("anthropic")] }), false)?.continuity).toBeNull();
    expect(
      routingFacts(row({ attempts: [served("anthropic")], affinity: { held_route: false } }), false)?.continuity,
    ).toBeNull();
    expect(
      routingFacts(row({ attempts: [served("anthropic")], affinity: { held_route: true, stayed: "turn" } }), false)
        ?.continuity,
    ).toEqual({ heldRoute: true, stayed: "turn" });
    expect(
      routingFacts(row({ attempts: [served("anthropic")], affinity: { held_route: false, stayed: "cache" } }), false)
        ?.continuity,
    ).toEqual({ heldRoute: false, stayed: "cache" });
  });

  it("故障转移：前几个上游失败、换到下一个", () => {
    const f = routingFacts(row({ attempts: [overloaded("anthropic"), served("openrouter")] }, { provider: "openrouter" }), false)!;
    expect(f.note).toEqual({ kind: "failover", failed: 1 });
    expect(f.hops.map((h) => h.denied)).toEqual([false, false]);
  });

  it("无响应超时是上游的失败：说故障转移", () => {
    const f = routingFacts(row({ attempts: [quiet("anthropic"), served("openrouter")] }, { provider: "openrouter" }), false)!;
    expect(f.note).toEqual({ kind: "failover", failed: 1 });
  });

  it("满着跳过的不说成失败：换过上游，说前几次尝试没有接下", () => {
    const g = routingFacts(
      row({ attempts: [busy("anthropic"), overloaded("openrouter"), served("deepseek")] }, { provider: "deepseek" }),
      false,
    )!;
    expect(g.note).toEqual({ kind: "switched", count: 2 });
  });

  it("等到了空位：只有一跳，排队的时间在那一跳上，不加说明", () => {
    const f = routingFacts(row({ attempts: [{ ...served("anthropic"), queued_ms: 1_240 }] }), false)!;
    expect(f.note).toBeNull();
    expect(f.hops[0]!.attempt.queued_ms).toBe(1_240);
  });

  it("上游都满着：没有一跳发出去，原因是 core 说的那一句", () => {
    const f = routingFacts(
      row({ attempts: [busy("anthropic", 30_000), busy("openrouter")] }, { provider: "openrouter", error: busyAll }),
      false,
    )!;
    expect(f.note).toEqual({ kind: "busy", tried: 0 });
    expect(f.reason).toEqual({ msg: busyAll });
    expect(f.hops.map((h) => h.denied)).toEqual([false, false]);
  });

  it("上游都满着：之前发出去、没成的几跳另说", () => {
    const f = routingFacts(
      row({ attempts: [overloaded("anthropic"), busy("openrouter")] }, { provider: "openrouter", error: busyAll }),
      false,
    )!;
    expect(f.note).toEqual({ kind: "busy", tried: 1 });
  });

  it("密钥的用量上限拒绝了它：没有尝试，原因是 core 说的那一句", () => {
    const f = routingFacts(row({ attempts: [] }, { provider: "", error: limited }), false)!;
    expect(f.ruleDenied).toBe(false);
    expect(f.note).toEqual({ kind: "limited" });
    expect(f.reason).toEqual({ msg: limited });
  });

  it("选定上游之前被拒绝：没有尝试，原因是规则里写的那句", () => {
    const f = routingFacts(
      row({ route: "codex", rule: "no-opus", group: null, attempts: [] }, { provider: "", error: denied("no-opus", "Opus is not offered") }),
      false,
    )!;
    expect(f).toMatchObject({ rule: "no-opus", ruleDenied: true, deniedBy: null, group: null, hops: [] });
    expect(f.reason).toEqual({ text: "Opus is not offered" });
    expect(f.note).toEqual({ kind: "denied_before_pick", rule: "no-opus" });
  });

  it("在第二跳被拒绝：那一跳标成没有发出，说明不把拒绝说成故障转移成功", () => {
    const why = denied("no-images-via-relay", "Requests with images are not sent through the relay");
    const f = routingFacts(
      row(
        {
          denied_by: "no-images-via-relay",
          attempts: [overloaded("anthropic"), { provider: "openrouter", outcome: "error", error: why, ms: 1 }],
        },
        { provider: "openrouter", error: why },
      ),
      false,
    )!;
    // 决定去向的规则没有拒绝它：拒绝它的是选定上游之后的那一条
    expect(f.ruleDenied).toBe(false);
    expect(f.deniedBy).toBe("no-images-via-relay");
    expect(f.hops.map((h) => [h.attempt.provider, h.denied])).toEqual([
      ["anthropic", false],
      ["openrouter", true],
    ]);
    expect(f.note).toEqual({ kind: "failover_denied", failed: 1, rule: "no-images-via-relay" });
    expect(f.reason).toEqual({ text: "Requests with images are not sent through the relay" });
  });

  it("唯一的一跳就被拒绝：没有故障转移", () => {
    const why = denied("no-images-via-relay", "no images");
    const f = routingFacts(
      row({ denied_by: "no-images-via-relay", attempts: [{ provider: "openrouter", outcome: "error", error: why, ms: 1 }] }, { provider: "openrouter", error: why }),
      false,
    )!;
    expect(f.hops[0]!.denied).toBe(true);
    expect(f.note).toEqual({ kind: "denied_after_pick", rule: "no-images-via-relay" });
  });

  it("规则没写理由：不出「原因」那一行", () => {
    const f = routingFacts(row({ rule: "no-opus", attempts: [] }, { provider: "", error: denied("no-opus", "") }), false)!;
    expect(f.ruleDenied).toBe(true);
    expect(f.reason).toBeNull();
  });

  it("选中的上游都接不了：原因是 core 说的那一句", () => {
    const f = routingFacts(row({ route: "codex", group: null, attempts: [] }, { provider: "", error: unavailable }), false)!;
    expect(f.ruleDenied).toBe(false);
    expect(f.reason).toEqual({ msg: unavailable });
    expect(f.note).toEqual({ kind: "unavailable" });
  });

  it("尝试链是空的：在跑的是还没走完，结束了的是没有尝试记录", () => {
    expect(routingFacts(row({ attempts: [] }), true)!.note).toEqual({ kind: "pending" });
    // 上游应答之前客户端就走了：上游是开始时要发往的那一个
    expect(routingFacts(row({ attempts: [] }), false)!.note).toEqual({ kind: "none" });
  });
});
