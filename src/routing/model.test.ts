import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ConditionView, RouteView, RuleView } from "@/types";
import {
  blankRule,
  draftFromView,
  draftNotes,
  draftToInput,
  flowOf,
  insertIndex,
  liftShadowed,
  move,
  routeSummary,
  ruleProblem,
  splitCompare,
  usersOf,
  type RuleDraft,
} from "./model";

function view(p: Partial<RuleView> & { name: string }): RuleView {
  return { conditions: [], catch_all: false, phase_two: false, shadowed: false, ...p };
}

function rule(name: string, p: Partial<RuleDraft> = {}): RuleDraft {
  return { ...blankRule("pool"), name, ...p };
}

const model = (glob: string): ConditionView => ({ field: "model", values: [glob] });

describe("规则草稿", () => {
  it("视图读进来、交回去是同一套写法", () => {
    const v = view({
      name: "长上下文",
      conditions: [{ field: "input_tokens", values: [">200k"] }, model("claude-*")],
      to: "长上下文池",
    });
    const input = draftToInput(draftFromView(v));
    expect(input).toEqual({
      name: "长上下文",
      conditions: v.conditions,
      to: "长上下文池",
      deny: null,
      set: null,
    });
  });

  it("三种命中后各自只交它用得到的字段", () => {
    const deny = draftFromView(view({ name: "禁用 Opus", conditions: [model("claude-opus-*")], deny: "不提供" }));
    expect(deny.action).toBe("deny");
    // 拒绝时附加项不起作用，即使草稿里还留着
    expect(draftToInput({ ...deny, model: "x" })).toMatchObject({ to: null, deny: "不提供", set: null });

    const cont = draftFromView(
      view({ name: "标题用小模型", conditions: [{ field: "intent", values: ["titling"] }], set: { model: "claude-haiku-4-5" } }),
    );
    expect(cont.action).toBe("continue");
    expect(draftToInput(cont)).toMatchObject({ to: null, deny: null, set: { model: "claude-haiku-4-5" } });
  });

  it("比较式拆成比较符和数值，写回去时拼上", () => {
    expect(splitCompare(">200k")).toEqual([">", "200k"]);
    expect(splitCompare(">= 32k")).toEqual([">=", "32k"]);
    expect(splitCompare("==0")).toEqual(["=", "0"]);
    const d = rule("x", { conditions: [{ field: "input_tokens", values: ["<=32k"] }] });
    expect(draftToInput(d).conditions).toEqual([{ field: "input_tokens", values: ["<=32k"] }]);
  });

  it("保存按钮旁边说出还缺什么", () => {
    expect(ruleProblem(rule(""), [])).toBe("填写规则名称");
    expect(ruleProblem(rule("兜底"), ["兜底"])).toBe("规则名称「兜底」已存在");
    expect(ruleProblem(rule("a", { conditions: [{ field: "input_tokens", values: [">"] }] }), [])).toContain("数值");
    expect(ruleProblem(rule("a", { conditions: [{ field: "input_tokens", values: [">200q"] }] }), [])).toContain("有误");
    expect(ruleProblem(rule("a", { action: "deny" }), [])).toBe("填写拒绝原因");
    expect(ruleProblem(rule("a", { action: "continue" }), [])).toContain("改写参数或安全要求");
    expect(
      ruleProblem(rule("a", { conditions: [{ field: "provider_would_be", values: ["relay"] }] }), []),
    ).toContain("不能转发");
    expect(ruleProblem(rule("a"), [])).toBeNull();
  });
});

describe("规则在路由里的处境", () => {
  const catchAll = rule("兜底");
  const gemini = rule("Gemini", { conditions: [model("gemini-*")] });
  const rewrite = rule("限制输出", { action: "continue", maxTokens: "4096" });

  it("兜底之后的转发不会生效，只附加改写的照常生效", () => {
    const notes = draftNotes([catchAll, gemini, rewrite]);
    expect(notes.map((n) => n.shadowed)).toEqual([false, true, false]);
    expect(notes[0]!.catchAll).toBe(true);
  });

  it("「添加规则」插在第一条兜底之前", () => {
    expect(insertIndex([gemini, catchAll, rewrite])).toBe(1);
    expect(insertIndex([gemini])).toBe(1);
    // 只附加改写的规则不算兜底
    expect(insertIndex([rewrite, gemini])).toBe(2);
  });

  it("「移至兜底规则之前」只挪被挡住的，其余次序不变", () => {
    const b = rule("b", { conditions: [model("b-*")] });
    const out = liftShadowed([rewrite, catchAll, gemini, b]);
    expect(out.map((r) => r.name)).toEqual(["限制输出", "Gemini", "b", "兜底"]);
  });

  it("移动一项", () => {
    expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(move(["a", "b", "c"], 0, 5)).toEqual(["b", "c", "a"]);
  });
});

describe("路由列表", () => {
  const route = (p: Partial<RouteView>): RouteView => ({
    name: "codex",
    default: false,
    builtin: false,
    has_catch_all: true,
    clients: [],
    rules: [],
    ...p,
  });

  it("默认路由的使用者包括没指定路由的密钥", () => {
    const clients = [
      { name: "claude-code", key: "tw-a", max_concurrent: null, route: null, allow: null },
      { name: "codex", key: "tw-b", max_concurrent: null, route: "codex", allow: null },
    ];
    expect(usersOf(route({ name: "默认", default: true }), clients)).toEqual(["claude-code"]);
    expect(usersOf(route({}), clients)).toEqual(["codex"]);
  });

  it("规则一栏只列决定去向的规则，内置策略组显示为「全部上游」", () => {
    const r = route({
      rules: [
        view({ name: "标题用小模型", set: { model: "m" } }),
        view({ name: "禁用 Opus", deny: "不提供" }),
        view({ name: "兜底", to: "__all__", catch_all: true }),
        view({ name: "Gemini", to: "openrouter", shadowed: true }),
      ],
    });
    expect(flowOf(r)).toEqual([
      { rule: "禁用 Opus", target: null },
      { rule: "兜底", target: "全部上游" },
    ]);
    expect(routeSummary(r)).toEqual({ text: "4 条规则 · 1 条位于兜底规则之后，不会生效", warn: true });
    expect(routeSummary(route({ has_catch_all: false, rules: [] })).text).toBe("0 条规则 · 尚无兜底规则");
  });

  it("英文的规则数分单复数", () => {
    setLang("en");
    expect(routeSummary(route({ rules: [view({ name: "a", to: "x", catch_all: true })] })).text).toBe("1 rule");
    const shadowed = [view({ name: "a", shadowed: true }), view({ name: "b", shadowed: true })];
    expect(routeSummary(route({ has_catch_all: false, rules: shadowed })).text).toBe(
      "2 rules · 2 are after the catch-all rule and have no effect · No catch-all rule yet",
    );
  });
});
