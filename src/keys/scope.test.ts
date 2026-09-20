import { describe, expect, it } from "vitest";

import { setLang } from "@/i18n";
import type { KnownModel } from "@/types";
import { scopeLabel } from "./labels";
import {
  allowOf,
  rowsOf,
  scopeOf,
  sourceOf,
  splitEntries,
  toggleModel,
  visibleCount,
} from "./scope";

const CATALOG: KnownModel[] = [
  { id: "claude-opus-5", providers: ["anthropic"] },
  { id: "claude-sonnet-5", providers: ["anthropic", "openrouter"] },
  { id: "claude-haiku-4-5", providers: ["anthropic"] },
  { id: "deepseek-chat", providers: ["deepseek"] },
  { id: "gpt-5.5", providers: ["openrouter"] },
];

describe("可见模型的三态", () => {
  it("不写是全部，空数组是无，非空是指定范围", () => {
    expect(scopeOf(null)).toBe("all");
    expect(scopeOf(undefined)).toBe("all");
    expect(scopeOf([])).toBe("none");
    expect(scopeOf(["claude-*"])).toBe("some");
  });

  it("写回 core 时空数组和不写是两件事", () => {
    // `allow` 不写 = 跟方言走，`allow: []` = 一个都不给。**不能合并**
    expect(allowOf("all", ["claude-*"])).toBeNull();
    expect(allowOf("none", ["claude-*"])).toEqual([]);
    expect(allowOf("some", ["claude-*"])).toEqual(["claude-*"]);
  });
});

describe("规则与明细并存", () => {
  it("带星号的是规则，其余是模型 ID", () => {
    const { patterns, picked } = splitEntries(["claude-*", "gpt-5.5", "deepseek-*"]);
    expect(patterns).toEqual(["claude-*", "deepseek-*"]);
    expect(picked).toEqual(["gpt-5.5"]);
  });

  it("同时成立时说规则 —— 那一行取消不掉，原因是规则", () => {
    const entries = ["claude-*", "claude-opus-5"];
    expect(sourceOf(entries, "claude-opus-5")).toEqual({ kind: "pattern", pattern: "claude-*" });
    expect(sourceOf(entries, "gpt-5.5")).toBeNull();
  });

  it("勾选只加减明细，不动规则", () => {
    // 勾一下就把 claude-* 展开成几百条明细，是用户看不出原因的一次大改
    const entries = ["claude-*"];
    expect(toggleModel(entries, "gpt-5.5", true)).toEqual(["claude-*", "gpt-5.5"]);
    expect(toggleModel(["claude-*", "gpt-5.5"], "gpt-5.5", false)).toEqual(["claude-*"]);
  });

  it("一条规则算命中的模型数，不是条目数", () => {
    expect(visibleCount(["claude-*"], CATALOG)).toBe(3);
    expect(visibleCount(["claude-*", "gpt-5.5"], CATALOG)).toBe(4);
    expect(visibleCount(["nothing-matches-*"], CATALOG)).toBe(0);
  });
});

describe("表格要画的行", () => {
  it("目录里没有的明细照样列出来，否则删不掉", () => {
    // 上游改了名，或者当初手打错了 —— 那一条还在配置里
    const rows = rowsOf(["ghost-model"], CATALOG);
    expect(rows[0]).toEqual({
      id: "ghost-model",
      providers: [],
      unknown: true,
      source: { kind: "picked" },
    });
    expect(rows).toHaveLength(CATALOG.length + 1);
  });

  it("每一行说得出模型来自哪个上游", () => {
    const row = rowsOf([], CATALOG).find((r) => r.id === "claude-sonnet-5");
    expect(row?.providers).toEqual(["anthropic", "openrouter"]);
  });
});

describe("表格里「可见模型」那一栏", () => {
  it("数的是命中的模型，不是规则条数", () => {
    setLang("zh");
    // 旧的写法把 ["claude-*"] 说成「1 个模型」，实际是 3 个
    expect(scopeLabel(["claude-*"], CATALOG).text).toBe("3 个模型 · 1 条规则");
    expect(scopeLabel(["gpt-5.5"], CATALOG).text).toBe("1 个模型");
  });

  it("目录还没到手时只说规则条数，不谎报一个算不出来的数", () => {
    setLang("zh");
    expect(scopeLabel(["claude-*", "deepseek-*"], []).text).toBe("2 条规则");
    expect(scopeLabel(["claude-*", "gpt-5.5"], []).text).toBe("1 个模型 · 1 条规则");
  });

  it("「无」要标出来：它等于这把钥匙现在用不了", () => {
    setLang("zh");
    expect(scopeLabel([], CATALOG)).toEqual({ text: "无", warn: true });
    expect(scopeLabel(null, CATALOG)).toEqual({ text: "全部", warn: false });
  });
});
