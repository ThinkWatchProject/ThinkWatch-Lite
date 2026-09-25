import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clientGlyph, upstreamGlyph } from "./ui/logos";
import { GLYPHS } from "./ui/logo-data";

describe("上游和客户端的标志", () => {
  it("按地址认上游，名字是用户起的", () => {
    expect(upstreamGlyph({ name: "relay-hk", baseUrl: "https://api.anthropic.com" })).toBe("anthropic");
    expect(upstreamGlyph({ name: "x", baseUrl: "https://chatgpt.com/backend-api/codex" })).toBe("openai");
    expect(upstreamGlyph({ name: "x", baseUrl: "https://my.openai.azure.com/openai" })).toBe("azure");
    expect(upstreamGlyph({ name: "x", baseUrl: "https://open.bigmodel.cn/api/anthropic" })).toBe("zhipu");
    expect(upstreamGlyph({ name: "x", baseUrl: "https://api.z.ai/api/anthropic" })).toBe("zai");
    expect(upstreamGlyph({ name: "x", baseUrl: "https://generativelanguage.googleapis.com" })).toBe("gemini");
    expect(upstreamGlyph({ name: "local", baseUrl: "http://127.0.0.1:11434" })).toBe("ollama");
  });

  it("地址认不出时看名字，再认不出就是 null", () => {
    expect(upstreamGlyph({ name: "deepseek-relay", baseUrl: "https://relay.example.com" })).toBe("deepseek");
    expect(upstreamGlyph({ name: "relay-hk", baseUrl: "https://relay.example.com" })).toBeNull();
    expect(upstreamGlyph({ name: "", baseUrl: "not a url" })).toBeNull();
  });

  it("客户端 id、显示名都认", () => {
    expect(clientGlyph("claude-code")).toBe("claudecode");
    expect(clientGlyph("Claude Code")).toBe("claudecode");
    expect(clientGlyph("antigravity-cli")).toBe("antigravity");
    expect(clientGlyph("gemini-cli")).toBeNull();
    expect(clientGlyph("zed-editor")).toBe("zed");
    expect(clientGlyph("aider")).toBeNull();
  });

  it("图形是单色的：数据里没有颜色", () => {
    const src = readFileSync("src/ui/logo-data.ts", "utf8");
    expect(src).not.toMatch(/fill="#|#[0-9a-f]{6}\b|url\(/i);
    for (const g of Object.values(GLYPHS)) expect(g.paths.length).toBeGreaterThan(0);
  });
});
