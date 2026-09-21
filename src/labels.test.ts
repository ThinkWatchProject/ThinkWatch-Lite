import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import {
  GROUP_KINDS,
  PROBES,
  conditionName,
  conditionText,
  mismatchText,
  setText,
  targetLabel,
} from "./labels";
describe("名称表跟着语言走", () => {
  /** 表是模块级的常量，文字是 getter：换了语言，同一张表读出来就是另一种 */
  it("同一张表换了语言读出来的字跟着换", () => {
    expect(GROUP_KINDS.find((k) => k.id === "url-test")?.label).toBe("延迟最低");
    expect(PROBES.find((p) => p.id === "titling")?.label).toBe("生成标题");
    expect(targetLabel("__all__")).toBe("全部上游");
    setLang("en");
    expect(GROUP_KINDS.find((k) => k.id === "url-test")?.label).toBe("Lowest latency");
    expect(PROBES.find((p) => p.id === "titling")?.label).toBe("Title generation");
    expect(targetLabel("__all__")).toBe("All upstreams");
    expect(targetLabel("openrouter")).toBe("openrouter");
  });
});

describe("试算明细里没命中的原因", () => {
  it("中文是「要求…，实际为…」，比较式前面不加「为」", () => {
    expect(mismatchText({ field: "model", want: ["claude-*"], got: "gpt-4o" })).toBe(
      "要求模型为 claude-*，实际为 gpt-4o",
    );
    expect(mismatchText({ field: "input_tokens", want: [">200k"], got: "12000" })).toBe(
      "要求输入 token >200k，实际为 12000",
    );
    expect(mismatchText({ field: "cache", want: ["true"], got: "false" })).toBe("要求带缓存，实际为不带缓存");
  });

  /** 英文把条件名放在句首；布尔条件的说法本身是标签，加引号 */
  it("英文按英文的语序", () => {
    setLang("en");
    expect(mismatchText({ field: "model", want: ["claude-*", "gpt-*"], got: "gemini-2.5-pro" })).toBe(
      "Model must be claude-* or gpt-*; actual: gemini-2.5-pro",
    );
    expect(mismatchText({ field: "max_tokens", want: [">4096"], got: "" })).toBe(
      "max_tokens must be >4096; actual: not set",
    );
    expect(mismatchText({ field: "intent", want: ["titling"], got: "" })).toBe(
      "Auxiliary request must be Title generation; actual: user request",
    );
    expect(mismatchText({ field: "cache", want: ["true"], got: "false" })).toBe(
      "Requires “With cache”; actual: “Without cache”",
    );
  });
});

describe("规则的条件与改写", () => {
  it("英文的条件和改写", () => {
    setLang("en");
    expect(conditionName("stream")).toBe("Streaming");
    expect(conditionText({ field: "stream", values: ["false"] })).toBe("Non-streaming");
    expect(conditionText({ field: "model", values: ["claude-*", "gpt-*"] })).toBe("Model claude-* or gpt-*");
    expect(conditionText({ field: "dialect", values: ["openai-chat"] })).toBe("Client format OpenAI Chat Completions");
    expect(setText({ field: "model", value: "claude-haiku-4-5" })).toBe(
      "Model set to claude-haiku-4-5; the entire prompt cache is invalidated",
    );
    expect(setText({ field: "max_tokens", value: "4096" })).toBe("max_tokens set to 4096");
  });
});
