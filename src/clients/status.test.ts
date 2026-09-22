import { describe, expect, it } from "vitest";

import type { DetectedClient, ManualClient } from "@/types";
import { hostOf, manualStatusOf, pointsHere, SILENCE_MS, statusOf } from "./status";

const BASE = "http://127.0.0.1:18790";
const NOW = 10_000_000;

function client(over: Partial<DetectedClient> = {}): DetectedClient {
  return {
    id: "claude-code",
    name: "Claude Code",
    path: "~/.claude/settings.json",
    real: "~/.claude/settings.json",
    installed: true,
    has_config: true,
    adopted_at_ms: null,
    endpoint: null,
    shadows: [],
    takes_effect: "immediately",
    warns_when_silent: true,
    verified: "fields_only",
    costs: [],
    manual: { steps: [], fields: [], endpoint: BASE },
    ...over,
  };
}

describe("客户端的状态", () => {
  it("没检测到就是未检测到，别的都不看", () => {
    expect(statusOf(client({ installed: false, adopted_at_ms: 1 }), BASE, NOW).state).toBe("absent");
  });

  it("装了没接管是未接管", () => {
    expect(statusOf(client(), BASE, NOW).state).toBe("idle");
  });

  it("接管之后收到过它那把密钥的请求才是使用中", () => {
    const adopted = NOW - 60_000;
    expect(statusOf(client({ adopted_at_ms: adopted, last_seen_ms: adopted + 1 }), BASE, NOW).state).toBe(
      "in_use",
    );
    // 接管之前的请求不算：那是上一次接管时留下的
    expect(statusOf(client({ adopted_at_ms: adopted, last_seen_ms: adopted - 1 }), BASE, NOW).state).toBe(
      "waiting",
    );
  });

  it("证据比怀疑可靠：有更高优先级的文件，但请求已经来了，就是在用", () => {
    const s = statusOf(
      client({ adopted_at_ms: 1, last_seen_ms: 2, shadows: ["~/.claude/settings.local.json"] }),
      BASE,
      NOW,
    );
    expect(s.state).toBe("in_use");
  });

  it("被覆盖、地址被改走都是未生效，并说出原因", () => {
    expect(
      statusOf(client({ adopted_at_ms: NOW - 1, shadows: ["~/.claude/settings.local.json"] }), BASE, NOW),
    ).toEqual({ state: "broken", reason: { kind: "shadowed", file: "~/.claude/settings.local.json" } });
    expect(
      statusOf(client({ adopted_at_ms: NOW - 1, endpoint: "https://api.anthropic.com" }), BASE, NOW),
    ).toEqual({ state: "broken", reason: { kind: "moved", endpoint: "https://api.anthropic.com" } });
    // 带不带 /v1 都算指向本网关
    expect(statusOf(client({ adopted_at_ms: NOW - 1, endpoint: `${BASE}/v1` }), BASE, NOW).state).toBe("waiting");
  });

  it("即时生效的客户端接管五分钟仍无请求才算未生效；要重开终端的只说要重启", () => {
    const quiet = client({ adopted_at_ms: NOW - SILENCE_MS - 1 });
    expect(statusOf(quiet, BASE, NOW)).toEqual({ state: "broken", reason: { kind: "silent" } });
    const codex = client({
      id: "codex",
      adopted_at_ms: NOW - SILENCE_MS * 20,
      takes_effect: "on_restart",
      warns_when_silent: false,
    });
    expect(statusOf(codex, BASE, NOW)).toEqual({ state: "waiting", reason: { kind: "restart" } });
  });

  it("手动配置的只能看它那把密钥", () => {
    const m = (over: Partial<ManualClient>): ManualClient => ({
      id: "cursor",
      name: "Cursor",
      setup: { steps: [], fields: [], endpoint: `${BASE}/v1` },
      caveat: { code: "", text: "" },
      ...over,
    });
    expect(manualStatusOf(m({})).state).toBe("idle");
    expect(manualStatusOf(m({ key: "cursor" })).state).toBe("waiting");
    expect(manualStatusOf(m({ key: "cursor", last_seen_ms: 5 })).state).toBe("in_use");
  });
});

describe("地址", () => {
  it("认得出是不是本网关", () => {
    expect(pointsHere(BASE, BASE)).toBe(true);
    expect(pointsHere(`${BASE}/v1/`, BASE)).toBe(true);
    expect(pointsHere("http://127.0.0.1:18791", BASE)).toBe(false);
  });

  it("行上只写主机", () => {
    expect(hostOf("https://api.anthropic.com/v1")).toBe("api.anthropic.com");
    expect(hostOf("不是地址")).toBe("不是地址");
  });
});
