import { describe, expect, it } from "vitest";
import type { SecurityEventView } from "@/types";
import { marksFromEvents } from "./marks";

const ev = (x: Partial<SecurityEventView>): SecurityEventView => ({
  id: 1,
  at_ms: 0,
  request_id: 7,
  guard: "redact",
  rule: "anthropic-api-key",
  custom: false,
  action: "recorded",
  provider: "relay",
  client: "claude-code",
  model: "claude-sonnet-4",
  excerpt: "sk-an…oP2a",
  count: 1,
  ...x,
});

/**
 * 历史记录上的安全记录 → 流量页的两个徽标。
 *
 * **和实时事件给出同一个形状**：关窗再开，徽标不该变样。
 */
describe("历史记录的安全徽标", () => {
  it("没有记录就什么都不挂", () => {
    expect(marksFromEvents(undefined)).toEqual({});
    expect(marksFromEvents([])).toEqual({});
  });

  it("观察档只记下了凭据：含凭据，没替换", () => {
    const m = marksFromEvents([ev({}), ev({ id: 2, rule: "jwt", excerpt: "eyJhb…Xk0c", count: 2 })]);
    expect(m.secrets?.replaced).toBe(false);
    expect(m.secrets?.items.map((i) => [i.rule, i.masked, i.count])).toEqual([
      ["anthropic-api-key", "sk-an…oP2a", 1],
      ["jwt", "eyJhb…Xk0c", 2],
    ]);
    expect(m.flagged).toBeUndefined();
  });

  it("拦截档替换过：已脱敏", () => {
    expect(marksFromEvents([ev({ action: "replaced" })]).secrets?.replaced).toBe(true);
  });

  it("工具调用：切断的算拦截，只记录的不算", () => {
    const m = marksFromEvents([
      ev({ guard: "inspect_tools", rule: "curl-pipe-sh", action: "cut", tool: "Bash", excerpt: "curl x | sh" }),
      ev({ id: 2, guard: "inspect_tools", rule: "删集群", custom: true, action: "recorded", tool: "Bash", excerpt: "kubectl delete" }),
    ]);
    expect(m.secrets).toBeUndefined();
    expect(m.flagged).toEqual([
      { tool: "Bash", rule: "curl-pipe-sh", custom: false, excerpt: "curl x | sh", blocked: true },
      { tool: "Bash", rule: "删集群", custom: true, excerpt: "kubectl delete", blocked: false },
    ]);
  });
});
