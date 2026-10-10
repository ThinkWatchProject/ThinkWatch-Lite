import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { CUSTOM, PRESETS, ZAI_ENDPOINTS, accountKind, presetById } from "./presets";
import { matches } from "./ServiceSection";

// 断言按中文写：不随跑测试那台机器的系统语言变
beforeAll(() => setLang("zh"));

describe("服务类型那一步的格子", () => {
  it("三组，按设计稿的顺序；自定义收尾", () => {
    const ids = (g: string) => PRESETS.filter((p) => p.group === g).map((p) => p.id);
    expect(ids("vendor")).toEqual(["anthropic", "openai", "gemini", "deepseek", "zai"]);
    expect(ids("platform")).toEqual(["bedrock", "openrouter", "thinkwatch", "sub2api", "newapi"]);
    expect(ids("local")).toEqual(["ollama", "custom"]);
    expect(PRESETS.at(-1)).toBe(CUSTOM);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it("每一格的说明按设计稿写", () => {
    const desc = Object.fromEntries(PRESETS.map((p) => [p.id, p.desc]));
    expect(desc).toEqual({
      anthropic: "Claude 系列模型",
      openai: "GPT 系列模型",
      gemini: "Gemini 系列模型",
      deepseek: "DeepSeek 系列模型",
      zai: "GLM 系列模型",
      bedrock: "AWS 上托管的多家模型",
      openrouter: "多家模型的聚合平台",
      thinkwatch: "ThinkWatch 企业网关",
      sub2api: "API 中转平台",
      newapi: "API 中转平台",
      ollama: "本机运行的开源模型",
      custom: "任何兼容接口的服务",
    });
  });

  it("地址不带接口路径：网关把 /v1/… 接在后面", () => {
    for (const p of PRESETS) expect(p.baseUrl).not.toMatch(/\/v1\/?$|\/chat\/completions|\/messages/);
    // OpenRouter 的 OpenAI 兼容接口在 /api/v1/…：地址写到 /api
    expect(presetById("openrouter")).toMatchObject({ baseUrl: "https://openrouter.ai/api", protocol: "openai-chat" });
    expect(presetById("zai").baseUrl).toBe(ZAI_ENDPOINTS.zai);
  });

  it("没有固定地址的（中转、企业网关）名称跟着地址猜，协议自动识别", () => {
    for (const id of ["thinkwatch", "sub2api", "newapi"]) {
      expect(presetById(id)).toMatchObject({ name: "", baseUrl: "", protocol: "" });
    }
  });

  it("余额来源由这一格定：中转平台和企业网关写明，其余自动", () => {
    const balance = Object.fromEntries(PRESETS.map((p) => [p.id, p.balance ?? null]));
    expect(balance).toEqual({
      anthropic: null,
      openai: null,
      gemini: null,
      deepseek: null,
      zai: null,
      bedrock: null,
      openrouter: null,
      thinkwatch: "thinkwatch",
      sub2api: "sub2api",
      newapi: "newapi",
      ollama: null,
      custom: null,
    });
  });

  it("认证方式按实际有的：账号登录只有 OpenAI 和 Z.ai，Bedrock 三种，只有自定义有 OAuth", () => {
    const auth = Object.fromEntries(PRESETS.map((p) => [p.id, p.auth]));
    expect(auth).toEqual({
      anthropic: ["key"],
      openai: ["key", "account"],
      gemini: ["key"],
      deepseek: ["key"],
      zai: ["key", "account"],
      bedrock: ["key", "aws-keys", "aws-profile"],
      openrouter: ["key"],
      // 中转平台和企业网关只发 API 密钥：认证方式那一行不出现
      thinkwatch: ["key"],
      sub2api: ["key"],
      newapi: ["key"],
      ollama: ["key"],
      custom: ["key", "oauth"],
    });
    expect(accountKind("openai")).toBe("chatgpt");
    expect(accountKind("zai")).toBe("zai");
    expect(accountKind("anthropic")).toBeNull();
  });

  it("协议只在真有得选时给选", () => {
    const choice = PRESETS.filter((p) => p.protocols).map((p) => [p.id, p.protocols]);
    expect(choice).toEqual([
      ["openai", ["openai-chat", "openai-responses"]],
      ["sub2api", "all"],
      ["newapi", "all"],
      ["custom", "all"],
    ]);
  });

  it("本机的 Ollama 不要密钥、不计费；自定义的密钥可以不填，其余都要", () => {
    expect(presetById("ollama")).toMatchObject({ key: "none", billing: "free" });
    expect(CUSTOM.key).toBe("optional");
    for (const p of PRESETS.filter((x) => x.id !== "ollama" && x.id !== "custom")) expect(p.key).toBe("required");
  });
});

describe("搜索服务", () => {
  const found = (q: string) => PRESETS.filter((p) => matches(p, q)).map((p) => p.id);

  it("按名称、说明和常用叫法找，不分大小写", () => {
    expect(found("")).toHaveLength(PRESETS.length);
    expect(found("chatgpt")).toEqual(["openai"]);
    expect(found("GLM")).toEqual(["zai"]);
    expect(found("智谱")).toEqual(["zai"]);
    expect(found("aws")).toEqual(["bedrock"]);
    expect(found("中转")).toEqual(["sub2api", "newapi"]);
    expect(found("one api")).toEqual(["newapi"]);
    expect(found("企业网关")).toEqual(["thinkwatch"]);
    expect(found("没有这个")).toEqual([]);
  });
});
