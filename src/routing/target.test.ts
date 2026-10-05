import { describe, expect, it } from "vitest";
import type { KnownModelX } from "./provisional";
import { aliasNamed, candidatesOf, hasTarget, inheritedAliases, modelHint, pinnedOf, targetNameOf } from "./target";

// `/models` 的目录：别名项带 `alias`（它的模型列表），真名带 `aliases`（指向它的别名）
const real = (id: string, aliases: string[] = [], providers = ["p"]): KnownModelX => ({ id, providers, aliases });
const alias = (id: string, models: string[], providers = ["p"]): KnownModelX => ({ id, providers, alias: models, aliases: [] });

const KNOWN: KnownModelX[] = [
  alias("claude-opus-5", ["claude-opus-5", "anthropic/claude-opus-5"], ["anthropic", "openrouter"]),
  alias("deepseek-v4.1", ["DeepSeek-v4.1-flash"]),
  real("DeepSeek-v4.1-flash", ["deepseek-v4.1"]),
  real("anthropic/claude-opus-5", ["claude-opus-5"], ["openrouter"]),
  real("claude-sonnet-5"),
];

describe("规则的去向", () => {
  it("名称和指定模型列表分得开", () => {
    const pinned = [{ provider: "a", model: "m" }];
    expect(pinnedOf(pinned)).toBe(pinned);
    expect(pinnedOf("main")).toBeNull();
    expect(targetNameOf("main")).toBe("main");
    expect(targetNameOf(pinned)).toBeNull();
    expect(targetNameOf("")).toBeNull();
    expect(hasTarget(pinned)).toBe(true);
    expect(hasTarget([])).toBe(false);
    expect(hasTarget(null)).toBe(false);
  });
});

describe("模型条件的提示", () => {
  it("写别名：只匹配用这个别名的请求（别名和上游模型同名时也按别名）", () => {
    expect(modelHint("claude-opus-5", KNOWN)).toEqual({ kind: "alias", alias: "claude-opus-5" });
    expect(modelHint(" deepseek-v4.1 ", KNOWN)).toEqual({ kind: "alias", alias: "deepseek-v4.1" });
  });

  it("写上游模型名：也匹配指向它的别名", () => {
    expect(modelHint("DeepSeek-v4.1-flash", KNOWN)).toEqual({
      kind: "models",
      matches: 1,
      inherited: ["deepseek-v4.1"],
      exact: true,
    });
    // 和 core 一样不区分大小写
    expect(modelHint("deepseek-v4.1-flash", KNOWN)).toMatchObject({ inherited: ["deepseek-v4.1"] });
  });

  it("通配：按名称匹配到的照常计数，经继承的另列；名称本身已匹配的别名不重复说", () => {
    expect(modelHint("anthropic/*", KNOWN)).toEqual({
      kind: "models",
      matches: 1,
      inherited: ["claude-opus-5"],
      exact: false,
    });
    // claude-opus-5 这个别名的名称就匹配 claude-*：不算「经继承」
    expect(modelHint("claude-*", KNOWN)).toEqual({ kind: "models", matches: 2, inherited: [], exact: false });
  });

  it("没有别名的照旧只说匹配几个", () => {
    expect(modelHint("claude-sonnet-5", KNOWN)).toEqual({ kind: "models", matches: 1, inherited: [], exact: true });
    expect(modelHint("gpt-*", KNOWN)).toEqual({ kind: "models", matches: 0, inherited: [], exact: false });
  });

  it("没写、目录还没取到时不提示", () => {
    expect(modelHint("  ", KNOWN)).toBeNull();
    expect(modelHint("claude-opus-5", [])).toBeNull();
  });

  it("别名列着、清单里却没有的模型名照样继承", () => {
    // DeepSeek-v4.1-flash 不在目录里（没有上游列出它），别名项的模型列表里有
    const known = KNOWN.filter((m) => m.id !== "DeepSeek-v4.1-flash");
    expect(inheritedAliases(["DeepSeek-v4.1-flash"], known)).toEqual(["deepseek-v4.1"]);
    // 几个取值：并集，按目录顺序
    expect(inheritedAliases(["DeepSeek-v4.1-*", "anthropic/claude-opus-5"], KNOWN)).toEqual([
      "claude-opus-5",
      "deepseek-v4.1",
    ]);
    // 名称本身就匹配的别名（DeepSeek-* 不区分大小写地匹配 deepseek-v4.1）不算继承
    expect(inheritedAliases(["DeepSeek-*"], KNOWN)).toEqual([]);
  });

  it("带通配的不当成别名", () => {
    expect(aliasNamed("claude-opus-*", KNOWN)).toBeUndefined();
    expect(aliasNamed("claude-sonnet-5", KNOWN)).toBeUndefined();
    expect(aliasNamed("claude-opus-5", KNOWN)?.alias).toEqual(["claude-opus-5", "anthropic/claude-opus-5"]);
  });
});

describe("试算的候选", () => {
  const base = {
    route: "default",
    outcome: "route" as const,
    rule: "x",
    reason: null,
    via_group: null,
    set: [],
    trace: [],
    circuit_open: [],
    skipped: [],
    converted: [],
  };

  it("和候选一一对应的发出模型", () => {
    const r = {
      ...base,
      candidates: ["openrouter", "anthropic"],
      candidate_models: [{ sent_model: "anthropic/claude-opus-5", model_via: "alias" }, null],
    };
    expect(candidatesOf(r)).toEqual([
      { provider: "openrouter", sent_model: "anthropic/claude-opus-5", model_via: "alias" },
      { provider: "anthropic" },
    ]);
    expect(candidatesOf({ ...base, candidates: ["a"] })).toEqual([{ provider: "a" }]);
  });

  it("候选本身带着发出模型的写法也认", () => {
    const c = { provider: "bedrock", sent_model: "us.anthropic.claude-opus-5-v1:0", model_via: "pinned" };
    expect(candidatesOf({ ...base, candidates: [c] as unknown as string[] })).toEqual([c]);
  });
});
