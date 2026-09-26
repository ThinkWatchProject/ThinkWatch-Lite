import { describe, expect, it } from "vitest";

import type { DetectedClient, ManualClient } from "@/types";
import { hostOf, isIpv4Loopback, isLoopback, manualStatusOf, pointsHere, SILENCE_MS, statusOf } from "./status";

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
    models_stale: false,
    movable: true,
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

  it("WSL 里指着的不是 127.0.0.1 的是未生效（以前按 NAT 接管的），哪怕之前收到过请求", () => {
    const adopted = NOW - 60_000;
    const reachable = { adoptable: true };
    const nat = client({ adopted_at_ms: adopted, last_seen_ms: adopted + 1, endpoint: "http://172.27.96.1:18790" });
    expect(statusOf(nat, BASE, NOW, false, reachable)).toEqual({
      state: "broken",
      reason: { kind: "elsewhere", endpoint: "http://172.27.96.1:18790" },
    });
    // localhost 也不算：mirrored 下只认 127.0.0.1
    const named = client({ adopted_at_ms: adopted, endpoint: "http://localhost:18790" });
    expect(statusOf(named, BASE, NOW, false, reachable).reason?.kind).toBe("elsewhere");
    // 指着 127.0.0.1 的照常：收到过请求就是使用中，带不带 /v1 都一样
    const ok = client({ adopted_at_ms: adopted, last_seen_ms: adopted + 1, endpoint: `${BASE}/v1` });
    expect(statusOf(ok, BASE, NOW, false, reachable).state).toBe("in_use");
    // 没接管的不算
    expect(statusOf(client({ endpoint: "http://172.27.96.1:18790" }), BASE, NOW, false, reachable).state).toBe(
      "idle",
    );
  });

  it("WSL 里那一组够不着网关（NAT 这些）时，接管过的都是未生效", () => {
    const adopted = NOW - 60_000;
    const blocked = { adoptable: false };
    const c = client({ adopted_at_ms: adopted, last_seen_ms: adopted + 1, endpoint: BASE });
    expect(statusOf(c, BASE, NOW, false, blocked)).toEqual({ state: "broken", reason: { kind: "unreachable" } });
    // 没接管的、没检测到的照旧
    expect(statusOf(client(), BASE, NOW, false, blocked).state).toBe("idle");
    expect(statusOf(client({ installed: false }), BASE, NOW, false, blocked).state).toBe("absent");
  });

  it("连着远程 core 时，WSL 里的和这台电脑上的一样：指着服务器才算", () => {
    const server = "http://192.168.1.20:8788";
    const c = client({ adopted_at_ms: 1, last_seen_ms: 5, endpoint: server });
    expect(statusOf(c, server, 10, true, { adoptable: true }).state).toBe("in_use");
    const left = client({ adopted_at_ms: 1, endpoint: "http://127.0.0.1:8788" });
    expect(statusOf(left, server, 10, true, { adoptable: true }).reason?.kind).toBe("local");
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
      movable: true,
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

describe("本机网关的地址", () => {
  it("认得出这台机器，认得出服务器", () => {
    for (const e of ["http://127.0.0.1:8788", "http://localhost:8788/v1", "http://[::1]:8788"]) {
      expect(isLoopback(e)).toBe(true);
    }
    for (const e of ["http://192.168.1.20:8788/v1", "http://nas.local:8788", "", "not a url"]) {
      expect(isLoopback(e)).toBe(false);
    }
  });

  it("WSL 里的客户端只认 127.0.0.1", () => {
    expect(isIpv4Loopback("http://127.0.0.1:8788")).toBe(true);
    expect(isIpv4Loopback("http://127.0.0.1:8788/v1")).toBe(true);
    for (const e of ["http://localhost:8788", "http://[::1]:8788", "http://172.27.96.1:8788", "not a url"]) {
      expect(isIpv4Loopback(e)).toBe(false);
    }
  });
});

describe("连着远程 core 时", () => {
  it("还指着本机网关的单独标出来，哪怕它以前用过", () => {
    const c = client({ adopted_at_ms: 1, last_seen_ms: 5, endpoint: "http://127.0.0.1:8788" });
    expect(statusOf(c, "http://192.168.1.20:8788", 10, true)).toEqual({
      state: "broken",
      reason: { kind: "local", endpoint: "http://127.0.0.1:8788" },
    });
    // 本机模式下同一个客户端照常
    expect(statusOf(c, "http://127.0.0.1:8788", 10, false).state).toBe("in_use");
  });
});
