import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { MANUAL_MODEL_MAX, addIds, addToList, splitIds, unionModels } from "./manualModels";

// 断言按中文写：不随跑测试那台机器的系统语言变
beforeAll(() => setLang("zh"));

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

describe("编辑对话框里直接加进手动清单", () => {
  it("加上就是清单的一项：交回整份清单和这次加的那几个", () => {
    const r = addToList("gpt-6-luna, o5", { list: ["gpt-6"], listed: ["gpt-5"] });
    expect(r).toEqual({ list: ["gpt-6", "gpt-6-luna", "o5"], added: ["gpt-6-luna", "o5"], rest: "", problem: null });
  });

  it("清单里已有的、同一次输入里重复的，都说「已经手动添加过」，没有「待添加」这一说", () => {
    expect(addToList("gpt-6", { list: ["gpt-6"], listed: [] }).problem).toEqual({ kind: "added", id: "gpt-6" });
    const twice = addToList("a a", { list: [], listed: [] });
    expect(twice).toEqual({ list: ["a"], added: ["a"], rest: "a", problem: { kind: "added", id: "a" } });
  });

  it("上游已列出的、带通配的、太长的照样当场说，留在输入框里", () => {
    expect(addToList("gpt-5", { list: [], listed: ["gpt-5"] })).toEqual({
      list: [],
      added: [],
      rest: "gpt-5",
      problem: { kind: "listed", id: "gpt-5" },
    });
    expect(addToList("ok gpt-*", { list: [], listed: [] })).toMatchObject({
      added: ["ok"],
      rest: "gpt-*",
      problem: { kind: "wildcard", id: "gpt-*" },
    });
    expect(addToList("m".repeat(MANUAL_MODEL_MAX + 1), { list: [], listed: [] }).problem?.kind).toBe("tooLong");
  });
});

describe("模型一节列出的模型", () => {
  it("上游列出的在前，手动添加的接在后面，去重", () => {
    expect(unionModels(["a", "b", "a"], ["c", "b", "c"])).toEqual([
      { id: "a", listed: true, manual: false },
      { id: "b", listed: true, manual: true },
      { id: "c", listed: false, manual: true },
    ]);
  });

  it("没有清单（还没问到、上游不提供）：只有手动添加的", () => {
    expect(unionModels([], ["qwen3-coder:30b"])).toEqual([{ id: "qwen3-coder:30b", listed: false, manual: true }]);
    expect(unionModels([], [])).toEqual([]);
  });
});

describe("保存时 core 拒了手动添加的模型", () => {
  it("按码说中文那句，和别的保存失败一样进对话框", () => {
    const e = {
      code: "config.manual_model_wildcard",
      args: { upstream: "relay", model: "gpt-*" },
      text: "the model `gpt-*` added by hand to upstream `relay` contains * or ?. A model added by hand is one exact model id; to use only some of an upstream's models, set its scope (models_only)",
    };
    expect(errorText(e)).toBe(
      "上游「relay」手动添加的模型「gpt-*」含有 * 或 ?。手动添加的模型须为确切的模型 ID；只使用上游的部分模型，请设置启用范围（models_only）。",
    );
    expect(
      errorText({
        code: "config.manual_model_duplicate",
        args: { upstream: "relay", model: "gpt-6" },
        text: "the model `gpt-6` is added by hand to upstream `relay` more than once",
      }),
    ).toBe("模型「gpt-6」在上游「relay」手动添加的模型中重复。");
  });
});
