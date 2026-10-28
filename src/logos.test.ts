import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { clientGlyph, modelGlyph, upstreamGlyph } from "./ui/logos";
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
    expect(upstreamGlyph({ name: "x", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com" })).toBe("bedrock");
    expect(upstreamGlyph({ name: "x", baseUrl: "https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com" })).toBe(
      "bedrock",
    );
    // VPC 端点认不出，协议是 Bedrock 就是它
    expect(upstreamGlyph({ name: "x", baseUrl: "https://vpce-1.example.internal", protocol: "bedrock" })).toBe(
      "bedrock",
    );
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
    expect(clientGlyph("pi")).toBe("pi");
    expect(clientGlyph("Pi")).toBe("pi");
    // 分支不借用 Pi 的标志
    expect(clientGlyph("omp")).toBeNull();
    expect(clientGlyph("oh-my-pi")).toBeNull();
    expect(clientGlyph("grok-build")).toBe("xai");
    expect(clientGlyph("Qwen Code")).toBe("qwen");
    expect(clientGlyph("hermes-agent")).toBe("hermesagent");
  });

  it("图形是单色的：数据里没有颜色", () => {
    const src = readFileSync("src/ui/logo-data.ts", "utf8");
    expect(src).not.toMatch(/fill="#|#[0-9a-f]{6}\b|url\(/i);
    for (const g of Object.values(GLYPHS)) expect(g.paths.length).toBeGreaterThan(0);
  });
});

describe("模型的标志", () => {
  it("按模型名认出是哪一家", () => {
    expect(modelGlyph("claude-sonnet-5")).toBe("claude");
    expect(modelGlyph("gpt-5.5-codex")).toBe("openai");
    expect(modelGlyph("o3")).toBe("openai");
    expect(modelGlyph("o4-mini")).toBe("openai");
    expect(modelGlyph("gemini-3-pro")).toBe("gemini");
    expect(modelGlyph("glm-4.6")).toBe("zhipu");
    expect(modelGlyph("deepseek-chat")).toBe("deepseek");
    expect(modelGlyph("kimi-k2-turbo")).toBe("kimi");
    expect(modelGlyph("moonshot-v1-8k")).toBe("moonshot");
    expect(modelGlyph("qwen3-coder:30b")).toBe("qwen");
    expect(modelGlyph("grok-4")).toBe("xai");
    expect(modelGlyph("codestral-latest")).toBe("mistral");
    expect(modelGlyph("devstral-small")).toBe("mistral");
  });

  it("带厂商前缀、Bedrock 的区域前缀也认得", () => {
    expect(modelGlyph("anthropic/claude-sonnet-5")).toBe("claude");
    expect(modelGlyph("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("claude");
    expect(modelGlyph("moonshotai/kimi-k2")).toBe("kimi");
    expect(modelGlyph("qwen/qwen3-coder")).toBe("qwen");
    expect(modelGlyph("openai/gpt-oss-120b")).toBe("openai");
    expect(modelGlyph("openai/o3")).toBe("openai");
  });

  it("认不出来是 null：画首字母方块，不硬套一家", () => {
    expect(modelGlyph("llama-3.3-70b")).toBeNull();
    expect(modelGlyph("my-finetune")).toBeNull();
    // 名字里碰巧带个 o 加数字的不算 OpenAI
    expect(modelGlyph("solo3")).toBeNull();
    expect(modelGlyph("")).toBeNull();
    expect(modelGlyph(null)).toBeNull();
  });
});
