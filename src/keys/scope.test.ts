import { describe, expect, it } from "vitest";

import { setLang } from "@/i18n";
import type { KnownModel } from "@/types";
import { scopeLabel } from "./labels";
import {
  allowOf,
  hasAliases,
  inheritedFrom,
  locked,
  patternHits,
  rowsOf,
  sameModel,
  scopeOf,
  sourceOf,
  splitEntries,
  toggleModel,
  visibleCount,
} from "./scope";

const CATALOG: KnownModel[] = [
  { id: "claude-opus-5", providers: ["anthropic"], aliases: [] },
  { id: "claude-sonnet-5", providers: ["anthropic", "openrouter"], aliases: [] },
  { id: "claude-haiku-4-5", providers: ["anthropic"], aliases: [] },
  { id: "deepseek-chat", providers: ["deepseek"], aliases: [] },
  { id: "gpt-5.5", providers: ["openrouter"], aliases: [] },
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
      alias: null,
      source: { kind: "picked" },
    });
    expect(rows).toHaveLength(CATALOG.length + 1);
  });

  it("每一行说得出模型来自哪个上游", () => {
    const row = rowsOf([], CATALOG).find((r) => r.id === "claude-sonnet-5");
    expect(row?.providers).toEqual(["anthropic", "openrouter"]);
  });
});

describe("单独选中的模型和 core 一样不分大小写", () => {
  // core 的 glob_match 两边都按 ASCII 转小写：`Claude-Opus-5` 放行的就是 claude-opus-5
  it("手写成别的大小写的那一条，目录里那一行照样算选中，不多出一行目录外的", () => {
    expect(sourceOf(["Claude-Opus-5"], "claude-opus-5")).toEqual({ kind: "picked" });
    const rows = rowsOf(["Claude-Opus-5"], CATALOG);
    expect(rows).toHaveLength(CATALOG.length);
    expect(rows.find((r) => r.id === "claude-opus-5")?.source).toEqual({ kind: "picked" });
    expect(visibleCount(["GPT-5.5"], CATALOG)).toBe(1);
  });

  it("勾上不再写一条；取消时大小写不同的那条一起拿掉，规则不动", () => {
    expect(toggleModel(["GPT-5.5"], "gpt-5.5", true)).toEqual(["GPT-5.5"]);
    expect(toggleModel(["claude-*", "Claude-Opus-5", "claude-opus-5"], "claude-opus-5", false)).toEqual(["claude-*"]);
  });

  it("只转 ASCII 字母，和 core 的 to_ascii_lowercase 一样", () => {
    expect(sameModel("É-model", "é-model")).toBe(false);
    expect(sameModel("MODEL-É", "model-É")).toBe(true);
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

/**
 * 目录里带别名的样子（core 的 `/models`）：别名和同名真模型只出现一次（就是别名），
 * 真名那一项的 `aliases` 是指向它的别名
 */
const WITH_ALIASES: KnownModel[] = [
  { id: "anthropic/claude-sonnet-5", providers: ["openrouter"], aliases: ["claude-sonnet-5"] },
  {
    id: "claude-sonnet-5",
    providers: ["anthropic", "bedrock", "openrouter"],
    alias: ["claude-sonnet-5", "us.anthropic.claude-sonnet-5-v1:0", "anthropic/claude-sonnet-5"],
    aliases: [],
  },
  { id: "deepseek-v4.1", providers: ["relay-cn"], alias: ["DeepSeek-v4.1-flash"], aliases: [] },
  { id: "DeepSeek-v4.1-flash", providers: ["relay-cn"], aliases: ["deepseek-v4.1"] },
  { id: "glm-4.6", providers: ["zai", "bigmodel"], aliases: [] },
  { id: "us.anthropic.claude-sonnet-5-v1:0", providers: ["bedrock"], aliases: ["claude-sonnet-5"] },
];

const src = (entries: string[], id: string) => {
  const m = WITH_ALIASES.find((x) => x.id === id)!;
  return sourceOf(entries, m.id, m.alias);
};

describe("别名：继承只从真名到别名", () => {
  it("范围里有别名列表里的某个模型，别名随它放行，点不动", () => {
    const s = src(["DeepSeek-v4.1-flash"], "deepseek-v4.1");
    expect(s).toEqual({ kind: "inherited", model: "DeepSeek-v4.1-flash" });
    expect(locked(s)).toBe(true);
    // 那个模型本身是单独选中的，照常能取消
    expect(src(["DeepSeek-v4.1-flash"], "DeepSeek-v4.1-flash")).toEqual({ kind: "picked" });
    expect(locked({ kind: "picked" })).toBe(false);
  });

  it("规则命中别名列表里的模型名，别名同样随那个模型放行", () => {
    expect(src(["us.anthropic.*"], "claude-sonnet-5")).toEqual({
      kind: "inherited",
      model: "us.anthropic.claude-sonnet-5-v1:0",
    });
    expect(src(["deepseek-*"], "deepseek-v4.1")).toEqual({ kind: "pattern", pattern: "deepseek-*" });
  });

  it("只选别名，它的模型不可见", () => {
    const entries = ["deepseek-v4.1"];
    expect(src(entries, "deepseek-v4.1")).toEqual({ kind: "picked" });
    expect(src(entries, "DeepSeek-v4.1-flash")).toBeNull();
    // 规则只命中别名的名称时也一样
    expect(src(["claude-sonnet-*"], "anthropic/claude-sonnet-5")).toBeNull();
    expect(src(["claude-sonnet-*"], "us.anthropic.claude-sonnet-5-v1:0")).toBeNull();
  });

  it("规则直接命中别名的名称时说规则，不说继承", () => {
    // 那一行取消不掉的原因是规则；同时也随某个模型放行，说哪个都对，规则更直接
    expect(src(["claude-sonnet-*", "anthropic/claude-sonnet-5"], "claude-sonnet-5")).toEqual({
      kind: "pattern",
      pattern: "claude-sonnet-*",
    });
  });

  it("单独选中了别名、又随某个模型放行时说继承：锁住这一行的是那个模型", () => {
    const s = src(["deepseek-v4.1", "DeepSeek-v4.1-flash"], "deepseek-v4.1");
    expect(s).toEqual({ kind: "inherited", model: "DeepSeek-v4.1-flash" });
    expect(locked(s)).toBe(true);
  });

  it("别名列表里和它同名的那个模型不算继承：选中这个名字就是直接选中别名，能取消", () => {
    // 写成「随 claude-sonnet-5 放行」的话，这一行就再也取消不掉了
    expect(src(["claude-sonnet-5"], "claude-sonnet-5")).toEqual({ kind: "picked" });
    expect(inheritedFrom(["claude-sonnet-5"], "claude-sonnet-5", WITH_ALIASES[1]!.alias!)).toBeNull();
    expect(inheritedFrom(["Claude-Sonnet-5"], "claude-sonnet-5", ["CLAUDE-SONNET-5"])).toBeNull();
  });

  it("按列表顺序说第一个放行它的模型", () => {
    const entries = ["anthropic/claude-sonnet-5", "us.anthropic.claude-sonnet-5-v1:0"];
    expect(src(entries, "claude-sonnet-5")).toEqual({
      kind: "inherited",
      model: "us.anthropic.claude-sonnet-5-v1:0",
    });
  });

  it("继承和 core 一样不分大小写", () => {
    expect(src(["deepseek-v4.1-FLASH"], "deepseek-v4.1")).toEqual({
      kind: "inherited",
      model: "DeepSeek-v4.1-flash",
    });
  });

  it("真名不随别名放行，也不随别的真名放行", () => {
    // 不是别名就不看继承：真名那一项的 `aliases` 只是反查，不参与
    expect(sourceOf(["deepseek-v4.1"], "DeepSeek-v4.1-flash")).toBeNull();
    expect(sourceOf(["deepseek-v4.1"], "DeepSeek-v4.1-flash", null)).toBeNull();
  });
});

describe("别名：数数和画行", () => {
  it("可见数算上随模型放行的别名", () => {
    // 设计稿：claude-sonnet-* 命中别名、DeepSeek-v4.1-flash 单独选中、deepseek-v4.1 随它放行
    expect(visibleCount(["claude-sonnet-*", "DeepSeek-v4.1-flash"], WITH_ALIASES)).toBe(3);
    expect(visibleCount(["deepseek-v4.1"], WITH_ALIASES)).toBe(1);
    expect(visibleCount(["us.anthropic.*"], WITH_ALIASES)).toBe(2);
  });

  it("「命中 N 个」只按名称数，别名按它自己的名称", () => {
    expect(patternHits("claude-sonnet-*", WITH_ALIASES)).toBe(1);
    expect(patternHits("deepseek-*", WITH_ALIASES)).toBe(2);
    // 别名 claude-sonnet-5 随这个模型放行，但规则命中的只有模型本身
    expect(patternHits("us.anthropic.*", WITH_ALIASES)).toBe(1);
  });

  it("每一行带上别名的模型列表，真名是 null", () => {
    const rows = rowsOf(["DeepSeek-v4.1-flash"], WITH_ALIASES);
    const alias = rows.find((r) => r.id === "deepseek-v4.1")!;
    expect(alias.alias).toEqual(["DeepSeek-v4.1-flash"]);
    expect(alias.source).toEqual({ kind: "inherited", model: "DeepSeek-v4.1-flash" });
    expect(rows.find((r) => r.id === "glm-4.6")!.alias).toBeNull();
    expect(rowsOf(["ghost"], WITH_ALIASES)[0]!.alias).toBeNull();
  });

  it("单独选中的别名在目录里，不算目录外的明细", () => {
    expect(rowsOf(["deepseek-v4.1"], WITH_ALIASES)).toHaveLength(WITH_ALIASES.length);
  });

  it("目录里有没有别名", () => {
    expect(hasAliases(WITH_ALIASES)).toBe(true);
    expect(hasAliases(CATALOG)).toBe(false);
  });

  it("继承是算出来的，不写进 allow：勾选只加减用户自己的那一条", () => {
    const on = toggleModel([], "DeepSeek-v4.1-flash", true);
    expect(on).toEqual(["DeepSeek-v4.1-flash"]);
    expect(toggleModel(on, "DeepSeek-v4.1-flash", false)).toEqual([]);
    // 选别名只写别名
    expect(toggleModel(["claude-sonnet-*"], "deepseek-v4.1", true)).toEqual(["claude-sonnet-*", "deepseek-v4.1"]);
  });

  it("表格里「可见模型」那一栏算上随模型放行的别名", () => {
    setLang("zh");
    expect(scopeLabel(["claude-sonnet-*", "DeepSeek-v4.1-flash"], WITH_ALIASES).text).toBe("3 个模型 · 1 条规则");
    expect(scopeLabel(["DeepSeek-v4.1-flash"], WITH_ALIASES).text).toBe("2 个模型");
  });
});
