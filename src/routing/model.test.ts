import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ConditionView, DryRunCandidate, GroupView, RouteView, RuleView } from "@/types";
import {
  addOnsText,
  balanceNotes,
  balanceShares,
  blankPinned,
  blankRule,
  canLift,
  copyDraft,
  draftFromView,
  draftNotes,
  draftToInput,
  flowOf,
  insertIndex,
  liftShadowed,
  move,
  parseWeight,
  ratioText,
  routeProblems,
  ruleProblem,
  splitCompare,
  strategyText,
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

  it("指定模型：读进来、交回去是同一个列表，顺序不变", () => {
    const to = [
      { provider: "bedrock", model: "us.anthropic.claude-opus-5-v1:0" },
      { provider: "anthropic", model: "claude-opus-5" },
    ];
    const v: RuleView = {
      name: "Opus 走 Bedrock",
      conditions: [model("claude-opus-5")],
      to,
      set: { max_tokens: 8192 },
      catch_all: false,
      phase_two: false,
      shadowed: false,
    };
    const d = draftFromView(v);
    expect(d.action).toBe("forward");
    expect(d.toKind).toBe("pinned");
    expect(d.to).toBe("");
    expect(d.pinned.map((p) => [p.provider, p.model])).toEqual(to.map((p) => [p.provider, p.model]));
    expect(draftToInput(d)).toEqual({
      name: "Opus 走 Bedrock",
      conditions: v.conditions,
      to,
      deny: null,
      set: { model: null, max_tokens: 8192, thinking: null },
    });
    // 上游或策略组照旧是一个名称
    expect(draftFromView(view({ name: "兜底", to: "__all__" })).toKind).toBe("target");
  });

  it("指定模型时「模型改为」不起作用：不写进配置，也不算附加项", () => {
    const d = rule("a", { toKind: "pinned", pinned: [blankPinned("anthropic", "claude-opus-5")], model: "x", maxTokens: "4096" });
    expect(draftToInput(d).set).toEqual({ model: null, max_tokens: 4096, thinking: null });
    expect(addOnsText(d)).toBe("max_tokens 改为 4096");
    // 切回上游或策略组，留着的「模型改为」照常生效
    expect(draftToInput({ ...d, toKind: "target" }).set?.model).toBe("x");
    // 只有转发才有指定模型：继续匹配的规则照常改模型
    expect(draftToInput({ ...d, action: "continue" }).set?.model).toBe("x");
    expect(draftToInput({ ...d, action: "continue" }).to).toBeNull();
  });

  it("指定模型交回去时去掉两头的空白；复制出来的草稿不共用行", () => {
    const d = rule("a", { toKind: "pinned", pinned: [blankPinned(" anthropic ", " claude-opus-5 ")] });
    expect(draftToInput(d).to).toEqual([{ provider: "anthropic", model: "claude-opus-5" }]);
    const c = copyDraft(d);
    expect(c.pinned[0]).not.toBe(d.pinned[0]);
    expect(c.pinned[0]!.key).not.toBe(d.pinned[0]!.key);
  });

  it("指定模型缺什么", () => {
    const pinned = (...rows: [string, string][]) =>
      rule("a", { toKind: "pinned", pinned: rows.map(([p, m]) => blankPinned(p, m)) });
    expect(ruleProblem(pinned(), [])).toBe("添加至少一个指定模型");
    expect(ruleProblem(pinned(["anthropic", "claude-opus-5"], ["", "x"]), [])).toBe("选择第 2 个指定模型的上游");
    expect(ruleProblem(pinned(["anthropic", " "]), [])).toBe("填写第 1 个指定模型的模型名");
    expect(ruleProblem(pinned(["anthropic", "claude-opus-5"]), [])).toBeNull();
    // 选定上游之后才判断的规则不能转发，指定模型也一样
    expect(
      ruleProblem({ ...pinned(["a", "b"]), conditions: [{ field: "provider_would_be", values: ["a"] }] }, []),
    ).toContain("不能转发");
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

  it("max_tokens 要是正整数：0 写回去会被当成没填", () => {
    expect(ruleProblem(rule("a", { action: "continue", maxTokens: "0" }), [])).toContain("max_tokens");
    expect(ruleProblem(rule("a", { action: "continue", maxTokens: "4096" }), [])).toBeNull();
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

  it("被挡住的兜底规则不挪：两条兜底怎么排都是一条挡住另一条", () => {
    const copy = rule("兜底 副本");
    expect(liftShadowed([catchAll, copy]).map((r) => r.name)).toEqual(["兜底", "兜底 副本"]);
    expect(canLift([catchAll, copy])).toBe(false);
    expect(canLift([catchAll, gemini])).toBe(true);
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
      { name: "claude-code", key: "tw-a", max_concurrent: null, route: null, allow: null, limits: [] },
      { name: "codex", key: "tw-b", max_concurrent: null, route: "codex", allow: null, limits: [] },
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
      { rule: "禁用 Opus", name: null, target: null },
      { rule: "兜底", name: "__all__", target: "全部上游" },
    ]);
    expect(routeProblems(r)).toEqual(["1 条位于兜底规则之后，不会生效"]);
    expect(routeProblems(route({ has_catch_all: false, rules: [] }))).toEqual(["尚无兜底规则"]);
    expect(routeProblems(route({ rules: [view({ name: "兜底", to: "x", catch_all: true })] }))).toEqual([]);
  });

  it("规则一栏里指定模型写成「上游 · 模型」，备用的只说个数", () => {
    const r: RouteView = {
      ...route({}),
      rules: [
        {
          ...view({ name: "Opus 走 Bedrock" }),
          to: [
            { provider: "bedrock", model: "us.anthropic.claude-opus-5-v1:0" },
            { provider: "anthropic", model: "claude-opus-5" },
          ],
        },
        { ...view({ name: "官方 Sonnet" }), to: [{ provider: "anthropic", model: "claude-sonnet-5" }] },
        // 空列表不是去向（core 的校验拦得住，这里只求不当成转发）
        { ...view({ name: "空" }), to: [] },
      ],
    };
    expect(flowOf(r)).toEqual([
      { rule: "Opus 走 Bedrock", name: "bedrock", target: "bedrock · us.anthropic.claude-opus-5-v1:0，备用 1 个" },
      { rule: "官方 Sonnet", name: "anthropic", target: "anthropic · claude-sonnet-5" },
    ]);
  });

  it("英文的数量分单复数", () => {
    setLang("en");
    const shadowed = [view({ name: "a", shadowed: true }), view({ name: "b", shadowed: true })];
    expect(routeProblems(route({ has_catch_all: false, rules: shadowed }))).toEqual([
      "2 are after the catch-all rule and have no effect",
      "No catch-all rule yet",
    ]);
  });
});

describe("轮询组的比例和分配依据", () => {
  const group = (p: Partial<GroupView>): GroupView => ({
    name: "分流",
    builtin: false,
    kind: "load-balance",
    providers: ["anthropic", "openrouter"],
    weights: { anthropic: 1, openrouter: 1 },
    balance_by: "weights",
    ...p,
  });

  it("权重只收 1 到 100 的整数", () => {
    expect(parseWeight("1")).toBe(1);
    expect(parseWeight(" 100 ")).toBe(100);
    for (const bad of ["", "0", "101", "1.5", "-3", "7k", " "]) expect(parseWeight(bad)).toBeNull();
  });

  it("平均分时不写比例，按成员的顺序写出不平均的", () => {
    expect(ratioText(group({}))).toBeNull();
    expect(ratioText(group({ weights: { anthropic: 7, openrouter: 3 } }))).toBe("7 : 3");
    // 别的类型不用权重
    expect(ratioText(group({ kind: "fallback", weights: {} }))).toBeNull();
  });

  it("策略名后面补上比例和不是只看比例的分配依据", () => {
    setLang("zh");
    expect(balanceNotes(group({}))).toEqual([]);
    expect(strategyText(group({}))).toBe("轮询");
    expect(strategyText(group({ weights: { anthropic: 7, openrouter: 3 } }))).toBe("轮询（7 : 3）");
    expect(strategyText(group({ balance_by: "latency" }))).toBe("轮询（按速度）");
    expect(strategyText(group({ weights: { anthropic: 2, openrouter: 1 }, balance_by: "latency-health" }))).toBe(
      "轮询（2 : 1 · 按速度和稳定性）",
    );
    setLang("en");
    expect(strategyText(group({ weights: { anthropic: 7, openrouter: 3 }, balance_by: "health" }))).toBe(
      "Round robin (7 : 3 · By reliability)",
    );
  });

  it("试算的占比按权重 × 系数分，熔断着的不参加", () => {
    const c = (provider: string, weight: number | null, balance_factor: number | null = null): DryRunCandidate => ({
      provider,
      weight,
      balance_factor,
    });
    expect(balanceShares({ candidate_models: [c("a", 7), c("b", 3)], circuit_open: [] })).toEqual([0.7, 0.3]);
    const auto = balanceShares({ candidate_models: [c("a", 2, 2.25), c("b", 1, 0.5)], circuit_open: [] });
    expect(auto[0]).toBeCloseTo(0.9);
    expect(auto[1]).toBeCloseTo(0.1);
    expect(balanceShares({ candidate_models: [c("a", 1), c("b", 1), c("c", 2)], circuit_open: ["c"] })).toEqual([
      0.5, 0.5, 0,
    ]);
    // 全都熔断着时都算：网关照样一家家试
    expect(balanceShares({ candidate_models: [c("a", 3), c("b", 1)], circuit_open: ["a", "b"] })).toEqual([0.75, 0.25]);
    // 不是轮询组：没有权重，也就没有占比
    expect(balanceShares({ candidate_models: [c("a", null)], circuit_open: [] })).toEqual([null]);
  });
});
