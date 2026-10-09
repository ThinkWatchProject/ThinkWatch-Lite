import { describe, expect, it } from "vitest";
import { MANUAL_MODEL_MAX, addIds, splitIds } from "./manualModels";

const none = { drafts: [], manual: [], listed: [] };

describe("手动添加的模型", () => {
  it("一次粘贴几个：按空白和逗号拆开", () => {
    expect(splitIds(" gpt-6-luna, gpt-5\nclaude-fable-5，o5 ")).toEqual(["gpt-6-luna", "gpt-5", "claude-fable-5", "o5"]);
    expect(splitIds("   ")).toEqual([]);
  });

  it("写对的加进名单，有毛病的留在输入框里、说第一个毛病", () => {
    const r = addIds("gpt-6-luna gpt-* gpt-5", { drafts: ["o5"], manual: [], listed: [] });
    expect(r.drafts).toEqual(["o5", "gpt-6-luna", "gpt-5"]);
    expect(r.rest).toBe("gpt-*");
    expect(r.problem).toEqual({ kind: "wildcard", id: "gpt-*" });
  });

  it("空的、重复的、加过的、上游已列出的、太长的都当场说", () => {
    expect(addIds("  ", none).problem).toEqual({ kind: "blank" });
    expect(addIds("a", { ...none, drafts: ["a"] }).problem).toEqual({ kind: "duplicate", id: "a" });
    expect(addIds("a a", none)).toEqual({ drafts: ["a"], rest: "a", problem: { kind: "duplicate", id: "a" } });
    expect(addIds("a", { ...none, manual: ["a"] }).problem).toEqual({ kind: "added", id: "a" });
    expect(addIds("a", { ...none, listed: ["a"] }).problem).toEqual({ kind: "listed", id: "a" });
    const long = "m".repeat(MANUAL_MODEL_MAX + 1);
    expect(addIds(long, none).problem).toEqual({ kind: "tooLong", id: long });
    expect(addIds("m".repeat(MANUAL_MODEL_MAX), none).problem).toBeNull();
  });
});
