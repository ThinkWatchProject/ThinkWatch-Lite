import { describe, expect, it } from "vitest";
import type { Msg } from "@/types";
import { draftOf, onlyAuto, shownProblems, withModel, withName, withoutModel } from "./draft";

const real = new Set(["claude-opus-5", "deepseek-chat"]);
const offered = (m: string) => real.has(m);
const msg = (code: string): Msg => ({ code, text: code });

describe("别名草稿：名称是上游的真模型时自动列为第一个上游模型", () => {
  it("新建时列表空着、名称是真模型：列进来，标成自动的", () => {
    const d = withName(draftOf("", []), "claude-opus-5", offered, true);
    expect(d.models).toEqual(["claude-opus-5"]);
    expect(d.auto).toBe("claude-opus-5");
    expect(onlyAuto(d)).toBe(true);
  });

  it("名称再改：自动列进来的那一个跟着撤掉，新名称是真模型就换成它", () => {
    let d = withName(draftOf("", []), "claude-opus-5", offered, true);
    d = withName(d, "claude-opus-5-x", offered, true);
    expect(d.models).toEqual([]);
    expect(d.auto).toBeNull();
    d = withName(d, "deepseek-chat", offered, true);
    expect(d.models).toEqual(["deepseek-chat"]);
  });

  it("删掉自动列进来的：同一个名称不再自动列", () => {
    let d = withName(draftOf("", []), "claude-opus-5", offered, true);
    d = withoutModel(d, "claude-opus-5");
    expect(d.models).toEqual([]);
    d = withName(d, "claude-opus-", offered, true);
    d = withName(d, "claude-opus-5", offered, true);
    expect(d.models).toEqual([]);
  });

  it("用户自己加了别的：自动的那一个留下，名称再改也不撤", () => {
    let d = withName(draftOf("", []), "claude-opus-5", offered, true);
    d = withModel(d, "anthropic/claude-opus-5");
    expect(d.auto).toBeNull();
    d = withName(d, "opus", offered, true);
    expect(d.models).toEqual(["claude-opus-5", "anthropic/claude-opus-5"]);
  });

  it("列表里已经有模型（从上游模型弹窗起别名）、编辑时、名称不是真模型：不自动列", () => {
    expect(withName(draftOf("", ["deepseek-chat"]), "claude-opus-5", offered, true).models).toEqual(["deepseek-chat"]);
    expect(withName(draftOf("x", []), "claude-opus-5", offered, false).models).toEqual([]);
    expect(withName(draftOf("", []), "my-model", offered, true).models).toEqual([]);
  });

  it("加模型：去掉首尾空白，空的和已经列着的不加", () => {
    let d = withModel(draftOf("a", ["m1"]), "  m2 ");
    expect(d.models).toEqual(["m1", "m2"]);
    d = withModel(d, "m1");
    d = withModel(d, "  ");
    expect(d.models).toEqual(["m1", "m2"]);
  });
});

describe("别名草稿：名称下面用红字列出的问题", () => {
  it("页脚已经说了的两条不重复", () => {
    const d = draftOf("", []);
    expect(
      shownProblems([msg("config.alias_empty_name"), msg("config.alias_no_models"), msg("config.alias_reserved")], d).map(
        (m) => m.code,
      ),
    ).toEqual(["config.alias_reserved"]);
  });

  it("「只指向自己」：只有自动列进来的那一个时不用红字，用户自己这样写的照常说", () => {
    const problems = [msg("config.alias_only_itself")];
    const auto = withName(draftOf("", []), "claude-opus-5", offered, true);
    expect(shownProblems(problems, auto)).toEqual([]);
    const typed = draftOf("claude-opus-5", ["claude-opus-5"]);
    expect(shownProblems(problems, typed)).toEqual(problems);
  });
});
