import { describe, expect, it } from "vitest";
import type { SecurityRuleView } from "@/types";
import {
  actionAllowed,
  actionOf,
  adjustForScope,
  groupChecked,
  groupRules,
  groupTarget,
  matchAllowed,
  patternText,
  ruleMatches,
  scopeChoice,
  scopeOf,
  scopeOfChoice,
} from "./rules";

const rule = (x: Partial<SecurityRuleView>): SecurityRuleView => ({
  id: "r",
  custom: false,
  name: "Rule",
  kind: "invisible",
  matcher: { kind: "codepoints", ranges: ["U+200B"] },
  enabled: true,
  on_by_default: true,
  ...x,
});

describe("分组", () => {
  it("内置规则按类别各一组，先后按第一次出现；自定义的总在最后", () => {
    const rules = [
      rule({ id: "a", kind: "invisible" }),
      rule({ id: "c1", custom: true, kind: "custom" }),
      rule({ id: "b", kind: "injection" }),
      rule({ id: "a2", kind: "invisible" }),
    ];
    const groups = groupRules(rules, (r) => r);
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["invisible", ["a", "a2"]],
      ["injection", ["b"]],
      ["custom", ["c1"]],
    ]);
    expect(groups.map((g) => g.custom)).toEqual([false, false, true]);
  });
});

describe("组标题的复选框", () => {
  it("全部启用、部分启用（半选）、全部停用", () => {
    expect(groupChecked([{ enabled: true }, { enabled: true }])).toBe(true);
    expect(groupChecked([{ enabled: true }, { enabled: false }])).toBe("indeterminate");
    expect(groupChecked([{ enabled: false }])).toBe(false);
  });

  it("全部启用时点它全部停用，否则全部启用", () => {
    expect(groupTarget([{ enabled: true }, { enabled: true }])).toBe(false);
    expect(groupTarget([{ enabled: true }, { enabled: false }])).toBe(true);
    expect(groupTarget([{ enabled: false }])).toBe(true);
  });
});

describe("检索", () => {
  it("按界面上的名字、英文名、id 和写法找，不分大小写", () => {
    const r = rule({
      id: "project-codename",
      custom: true,
      name: "project-codename",
      matcher: { kind: "contains", text: "北极星", case_sensitive: false },
    });
    expect(ruleMatches(r, "项目代号", "代号")).toBe(true);
    expect(ruleMatches(r, "项目代号", "CODENAME")).toBe(true);
    expect(ruleMatches(r, "项目代号", "北极")).toBe(true);
    expect(ruleMatches(r, "项目代号", "南极")).toBe(false);
    expect(ruleMatches(r, "项目代号", "  ")).toBe(true);
  });

  it("写法：正则、文字、码位、前缀、域名后缀；没有写法的是空的", () => {
    expect(patternText(rule({ matcher: { kind: "regex", pattern: "TKT-\\d{6}" } }))).toBe("TKT-\\d{6}");
    expect(patternText(rule({ matcher: { kind: "codepoints", ranges: ["U+200B", "U+E0000–U+E007F"] } }))).toBe(
      "U+200B U+E0000–U+E007F",
    );
    expect(patternText(rule({ matcher: { kind: "prefix", prefix: "sk-ant-", min_tail: 20 } }))).toBe("sk-ant-");
    expect(patternText(rule({ matcher: { kind: "domain-suffix", suffixes: [".corp", ".internal"] } }))).toBe(
      ".corp .internal",
    );
    expect(patternText(rule({ matcher: { kind: "jwt" } }))).toBe("");
  });
});

describe("缺省值", () => {
  it("不给检查对象就是只查请求", () => {
    expect(scopeOf(rule({}))).toEqual(["request"]);
    expect(scopeOf(rule({ scope: [] }))).toEqual(["request"]);
    expect(scopeOf(rule({ scope: ["response"] }))).toEqual(["response"]);
  });

  it("不给动作：密钥与隐私替换为占位符，其余仅记录", () => {
    expect(actionOf("redact", {})).toBe("placeholder");
    expect(actionOf("content", {})).toBe("record");
    expect(actionOf("inspect_tools", { action: "cut" })).toBe("cut");
  });
});

/** 规格 §5.2 */
describe("检查对象与动作、匹配方式的联动", () => {
  it("三个选项和配置里的写法互换", () => {
    expect(scopeChoice(["request"])).toBe("request");
    expect(scopeChoice(["response"])).toBe("response");
    expect(scopeChoice(["response", "request"])).toBe("both");
    expect(scopeOfChoice("both")).toEqual(["request", "response"]);
    expect(scopeOfChoice("response")).toEqual(["response"]);
  });

  it("含回答时「拒绝」「码位」不可选；只查请求时都可选", () => {
    for (const c of ["response", "both"] as const) {
      expect(actionAllowed("content", "block", c)).toBe(false);
      expect(matchAllowed("codepoints", c)).toBe(false);
      for (const a of ["strip", "replace", "record"] as const) expect(actionAllowed("content", a, c)).toBe(true);
    }
    expect(actionAllowed("content", "block", "request")).toBe(true);
    expect(matchAllowed("codepoints", "request")).toBe(true);
    // 别的防护没有检查对象
    expect(actionAllowed("inspect_tools", "cut", "request")).toBe(true);
  });

  it("改成含回答：已选「拒绝」换成「删除」、「码位」换成「包含」，并说明换了哪几项", () => {
    expect(adjustForScope("both", "block", "codepoints")).toEqual({
      action: "strip",
      match: "contains",
      changed: { action: true, match: true },
    });
    expect(adjustForScope("response", "replace", "regex")).toEqual({
      action: "replace",
      match: "regex",
      changed: { action: false, match: false },
    });
    expect(adjustForScope("request", "block", "codepoints").changed).toEqual({ action: false, match: false });
  });
});
