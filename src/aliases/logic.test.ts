import { describe, expect, it } from "vitest";
import type { DetectedClient } from "@/types";
import type { AliasSuggestion, AliasView } from "./api.provisional";
import {
  aliasWarnings,
  clientsListing,
  modelLines,
  showTabDot,
  suggestionInput,
  suggestionKey,
  suggestionProviders,
  visibleSuggestions,
} from "./logic";

const opus: AliasSuggestion = {
  label: "Claude Opus 5",
  models: [
    { provider: "anthropic", model: "claude-opus-5" },
    { provider: "bedrock", model: "us.anthropic.claude-opus-5-v1:0" },
    { provider: "openrouter", model: "anthropic/claude-opus-5" },
  ],
};
const haiku: AliasSuggestion = {
  label: "Claude Haiku 4.5",
  models: [
    { provider: "anthropic", model: "claude-haiku-4-5" },
    { provider: "bedrock", model: "us.anthropic.claude-haiku-4-5-20251001-v1:0" },
  ],
};

function alias(over: Partial<AliasView> = {}): AliasView {
  return {
    name: "claude-sonnet-5",
    models: [{ model: "claude-sonnet-5", providers: ["anthropic"] }],
    served_by: [{ provider: "anthropic", model: "claude-sonnet-5" }],
    shadows: [],
    requests_24h: 0,
    ...over,
  };
}

describe("别名的建议", () => {
  it("标识由名称和模型名组成：多接一个上游、名称不变时还是同一条", () => {
    const relay = { ...opus, models: [...opus.models, { provider: "relay", model: "claude-opus-5" }] };
    expect(suggestionKey(relay)).toBe(suggestionKey(opus));
    // 顺序不同也是同一条
    expect(suggestionKey({ ...opus, models: [...opus.models].reverse() })).toBe(suggestionKey(opus));
  });

  it("多出一种写法就是一条新建议", () => {
    const vertex = { ...opus, models: [...opus.models, { provider: "vertex", model: "claude-opus-5@20260101" }] };
    expect(suggestionKey(vertex)).not.toBe(suggestionKey(opus));
    expect(suggestionKey(opus)).toMatch(/^alias-suggestion:/);
  });

  it("点过「忽略」的不再出现，其余按 core 的顺序", () => {
    expect(visibleSuggestions([opus, haiku], [])).toEqual([opus, haiku]);
    expect(visibleSuggestions([opus, haiku], [suggestionKey(opus)])).toEqual([haiku]);
    expect(visibleSuggestions([opus, haiku], [suggestionKey(opus), suggestionKey(haiku)])).toEqual([]);
  });

  it("标签名旁的小圆点：有没忽略的建议、而且不在这个标签上", () => {
    expect(showTabDot([opus], [], false)).toBe(true);
    expect(showTabDot([opus], [], true)).toBe(false);
    expect(showTabDot([opus], [suggestionKey(opus)], false)).toBe(false);
    expect(showTabDot([], [], false)).toBe(false);
    // 数据没取到时不画
    expect(showTabDot(undefined, [], false)).toBe(false);
  });

  it("说出现在哪几个上游，不重复", () => {
    const twice = { ...opus, models: [...opus.models, { provider: "anthropic", model: "claude-opus-5-latest" }] };
    expect(suggestionProviders(twice)).toEqual(["anthropic", "bedrock", "openrouter"]);
  });

  it("建为别名：名称取不带前缀后缀的那一个，上游模型按顺序、不重复", () => {
    expect(suggestionInput(opus)).toEqual({
      name: "claude-opus-5",
      models: ["claude-opus-5", "us.anthropic.claude-opus-5-v1:0", "anthropic/claude-opus-5"],
    });
    const relay = { ...opus, models: [...opus.models, { provider: "relay", model: "claude-opus-5" }] };
    expect(suggestionInput(relay).models).toHaveLength(3);
  });

  it("没有官方写法时去掉前缀、后缀", () => {
    const noOfficial: AliasSuggestion = {
      label: "Claude Opus 5",
      models: [
        { provider: "bedrock", model: "us.anthropic.claude-opus-5-v1:0" },
        { provider: "openrouter", model: "anthropic/claude-opus-5" },
      ],
    };
    expect(suggestionInput(noOfficial).name).toBe("claude-opus-5");
    const vertex: AliasSuggestion = {
      label: "Claude Opus 4.1",
      models: [
        { provider: "vertex", model: "claude-opus-4-1@20250805" },
        { provider: "bedrock", model: "global.anthropic.claude-opus-4-1-20250805-v1:0" },
      ],
    };
    expect(suggestionInput(vertex).name).toBe("claude-opus-4-1-20250805");
  });
});

describe("别名表的一行", () => {
  it("每个能服务的上游一行，没有上游提供的名称各一行", () => {
    const a = alias({
      models: [
        { model: "claude-sonnet-5", providers: ["anthropic"] },
        { model: "anthropic/claude-sonnet-5", providers: ["openrouter"] },
        { model: "claude-sonnet-5-preview", providers: [] },
      ],
      served_by: [
        { provider: "anthropic", model: "claude-sonnet-5" },
        { provider: "openrouter", model: "anthropic/claude-sonnet-5" },
      ],
    });
    expect(modelLines(a)).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5" },
      { provider: "openrouter", model: "anthropic/claude-sonnet-5" },
      { provider: null, model: "claude-sonnet-5-preview" },
    ]);
  });

  it("正常的不提醒", () => {
    expect(aliasWarnings(alias())).toEqual([]);
  });

  it("没有上游能服务时先说这个，说明列表里有几个名称", () => {
    const one = alias({ models: [{ model: "moonshotai/kimi-k2-0905", providers: [] }], served_by: [] });
    expect(aliasWarnings(one)).toEqual([{ kind: "unserved", models: 1 }]);
    const two = alias({
      models: [
        { model: "a", providers: [] },
        { model: "b", providers: [] },
      ],
      served_by: [],
      shadows: ["chatgpt"],
    });
    expect(aliasWarnings(two)).toEqual([
      { kind: "unserved", models: 2 },
      { kind: "shadowed", providers: ["chatgpt"] },
    ]);
  });

  it("同名模型被挡住的上游", () => {
    const a = alias({
      name: "gpt-5.5",
      models: [{ model: "openai/gpt-5.5", providers: ["openrouter"] }],
      served_by: [{ provider: "openrouter", model: "openai/gpt-5.5" }],
      shadows: ["chatgpt"],
    });
    expect(aliasWarnings(a)).toEqual([{ kind: "shadowed", providers: ["chatgpt"] }]);
  });
});

describe("删除时列出的客户端", () => {
  const base = {
    real: "",
    path: "",
    installed: true,
    has_config: true,
    other_instance: false,
    endpoint: null,
    shadows: [],
    takes_effect: "on_restart",
    warns_when_silent: false,
    verified: "fields_only",
    costs: [],
    models_stale: false,
    movable: true,
    manual: { steps: [], fields: [] },
  } as unknown as DetectedClient;
  const c = (id: string, over: Partial<DetectedClient>): DetectedClient => ({ ...base, id, name: id, ...over });

  it("只列这一份接管着、模型列表里写着这个名称的", () => {
    const list = [
      c("opencode", { adopted_at_ms: 1, models: ["claude-sonnet-5", "gpt-5.5"] }),
      c("pi", { adopted_at_ms: 1, models: ["gpt-5.5"] }),
      // 没接管：写着也不算
      c("qwen-code", { adopted_at_ms: null, models: ["claude-sonnet-5"] }),
      // 另一个 ThinkWatch Lite 接管的
      c("grok", { adopted_at_ms: null, other_instance: true, models: ["claude-sonnet-5"] }),
      // 不写模型的客户端
      c("claude-code", { adopted_at_ms: 1 }),
    ];
    expect(clientsListing(list, "claude-sonnet-5").map((x) => x.id)).toEqual(["opencode"]);
    expect(clientsListing(list, "gpt-5.5").map((x) => x.id)).toEqual(["opencode", "pi"]);
    expect(clientsListing(undefined, "gpt-5.5")).toEqual([]);
  });
});
