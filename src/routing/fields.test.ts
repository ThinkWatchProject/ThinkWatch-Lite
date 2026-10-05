import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { KnownModel } from "@/types";
import { aliasNamed, modelNote, type ModelOption } from "./fields";

const OPTIONS: ModelOption[] = [
  { id: "claude-opus-5", providers: ["anthropic", "bedrock"], alias: ["claude-opus-5", "us.anthropic.claude-opus-5-v1:0"] },
  { id: "glm-4.6", providers: ["zai", "bigmodel"] },
  { id: "orphan-alias", providers: [], alias: ["nobody-has-this"] },
  { id: "bare" },
];
const byId = new Map(OPTIONS.map((m) => [m.id, m]));

describe("模型建议右边的灰字", () => {
  it("别名写「别名 · 上游」，其余写上游", () => {
    setLang("zh");
    expect(modelNote(byId.get("claude-opus-5"))).toBe("别名 · anthropic、bedrock");
    expect(modelNote(byId.get("glm-4.6"))).toBe("zai、bigmodel");
    setLang("en");
    expect(modelNote(byId.get("claude-opus-5"))).toBe("alias · anthropic, bedrock");
    setLang("zh");
  });

  it("没有上游的别名只写「别名」；只有名称的不写", () => {
    setLang("zh");
    expect(modelNote(byId.get("orphan-alias"))).toBe("别名");
    expect(modelNote(byId.get("bare"))).toBeNull();
    expect(modelNote(undefined)).toBeNull();
  });

  it("目录里的 KnownModel 直接当建议用", () => {
    const m: KnownModel = { id: "gpt-5.5", providers: ["chatgpt"] };
    const opt: ModelOption = m;
    expect(modelNote(opt)).toBe("chatgpt");
  });
});

describe("输入框里的值是不是别名", () => {
  it("按名称认，不分 ASCII 大小写，忽略首尾空白", () => {
    expect(aliasNamed("claude-opus-5", byId)?.id).toBe("claude-opus-5");
    expect(aliasNamed(" Claude-Opus-5 ", byId)?.id).toBe("claude-opus-5");
  });

  it("真名、通配、空值都不是", () => {
    expect(aliasNamed("glm-4.6", byId)).toBeNull();
    expect(aliasNamed("claude-*", byId)).toBeNull();
    expect(aliasNamed("", byId)).toBeNull();
    // 别名列表里的模型名不是别名本身
    expect(aliasNamed("us.anthropic.claude-opus-5-v1:0", byId)).toBeNull();
  });
});
