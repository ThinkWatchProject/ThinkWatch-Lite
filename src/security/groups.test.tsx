import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "@/i18n";
import { TooltipRoot } from "@/ui/tip";
import type { SecurityEventView, SecurityKindView, SecurityRuleView } from "@/types";
import { RuleTable, type RuleActions } from "./GuardTab";
import { disclosureNav } from "./rows";
import {
  countHits,
  groupOpen,
  groupRules,
  hitsFirst,
  hitsOf,
  readOpenGroups,
  writeOpenGroups,
  type RuleHits,
} from "./rules";

/**
 * 规则表的分组（规格 D6）：默认收起，组头写条数、启用条数和最近 7 天的命中次数，有命中的组
 * 排在内置规则最前，检索时匹配的组展开，组头用键盘展开收起。
 */

const rule = (x: Partial<SecurityRuleView>): SecurityRuleView => ({
  id: "r",
  custom: false,
  name: "Rule",
  kind: "ai-services",
  matcher: { kind: "prefix", prefix: "sk-", min_tail: 20 },
  enabled: true,
  on_by_default: true,
  ...x,
});

const RULES = [
  rule({ id: "anthropic-api-key", name: "Anthropic API key", name_zh: "Anthropic API 密钥", kind: "ai-services" }),
  rule({ id: "openai-api-key", name: "OpenAI API key", name_zh: "OpenAI API 密钥", kind: "ai-services", enabled: false }),
  rule({ id: "github-token", name: "GitHub token", name_zh: "GitHub 令牌", kind: "dev-platforms" }),
  rule({ id: "passport", name: "Passport number", name_zh: "护照号码", kind: "id-documents" }),
  rule({ id: "客户编号", name: "客户编号", custom: true, kind: "custom" }),
];

const KINDS: SecurityKindView[] = [
  { slug: "ai-services", name: "AI services", name_zh: "AI 服务" },
  { slug: "dev-platforms", name: "Developer platforms", name_zh: "开发平台" },
  { slug: "id-documents", name: "ID documents", name_zh: "证件" },
  { slug: "custom", name: "Custom", name_zh: "自定义" },
];

const event = (rule: string, custom = false): SecurityEventView =>
  ({ id: 1, at_ms: 0, request_id: 1, guard: "redact", rule, custom }) as SecurityEventView;

const actions: RuleActions = {
  mode: () => {},
  toggle: () => {},
  setAction: () => {},
  pending: () => false,
  open: () => {},
  remove: () => {},
  create: () => {},
  test: () => {},
};

/** 一张内存里的 localStorage：测试环境没有 window */
function fakeStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    },
  });
  return m;
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => setLang("zh"));

function table(query = "", hits?: RuleHits) {
  return renderToStaticMarkup(
    <TooltipRoot>
      <RuleTable guard="redact" mode="enforce" rules={RULES} kinds={KINDS} query={query} hits={hits} actions={actions} />
    </TooltipRoot>,
  );
}

/** 组头一行一个，按先后：「AI 服务 · 2 条 · 已开 1 条」 */
const heads = (html: string) =>
  [...html.matchAll(/data-slot="rule-group"[^>]*>(.*?)<\/tr>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, ""));
/** 画出来的规则行（不含组头）有几行 */
const ruleRows = (html: string) => (html.match(/data-row-nav=""/g)?.length ?? 0) - heads(html).length;

describe("命中次数", () => {
  it("按规则数安全日志的条数；内置和自定义同名分开算", () => {
    const hits = countHits({
      events: [event("anthropic-api-key"), event("anthropic-api-key"), event("客户编号", true), event("客户编号")],
      more: false,
    });
    expect(hits).toEqual({ counts: { "b:anthropic-api-key": 2, "c:客户编号": 1, "b:客户编号": 1 }, complete: true });
    expect(hitsOf(hits, RULES.slice(0, 2))).toBe(2);
    expect(hitsOf(hits, [RULES[4]!])).toBe(1);
    expect(hitsOf(hits, [RULES[2]!])).toBe(0);
    expect(hitsOf(undefined, RULES)).toBeUndefined();
  });

  it("日志还有下一页：数的是下限", () => {
    expect(countHits({ events: [event("passport")], more: true }).complete).toBe(false);
  });

  it("组头写条数、启用条数和命中次数；没有命中的不写次数", () => {
    const html = table("", countHits({ events: [event("github-token"), event("github-token")], more: false }));
    expect(heads(html)).toEqual([
      "开发平台 · 1 条 · 已开 1 条 · 最近 7 天命中 2 次",
      "AI 服务 · 2 条 · 已开 1 条",
      "证件 · 1 条 · 已开 1 条",
      "自定义 · 1 条 · 已开 1 条",
    ]);
  });

  it("不全时写成「N+」；英文界面同一句", () => {
    const hits = countHits({ events: [event("passport")], more: true });
    expect(heads(table("", hits))[0]).toBe("证件 · 1 条 · 已开 1 条 · 最近 7 天命中 1+ 次");
    setLang("en");
    expect(heads(table("", hits))[0]).toBe("ID documents · 1 rule · 1 on · 1+ matches in the last 7 days");
    expect(heads(table("", countHits({ events: [event("passport")], more: false })))[0]).toBe(
      "ID documents · 1 rule · 1 on · 1 match in the last 7 days",
    );
  });
});

describe("组的先后", () => {
  it("有命中的内置组排在最前，两部分各自照 core 的顺序，自定义的在最后", () => {
    const groups = groupRules(
      [
        rule({ id: "a", kind: "k1" }),
        rule({ id: "b", kind: "k2" }),
        rule({ id: "c", kind: "k3" }),
        rule({ id: "d", kind: "k4" }),
        rule({ id: "e", custom: true, kind: "custom" }),
      ],
      (r) => r,
    );
    const hit = new Set(["k3", "k2", "custom"]);
    expect(hitsFirst(groups, (g) => hit.has(g.key)).map((g) => g.key)).toEqual(["k2", "k3", "k1", "k4", "custom"]);
  });

  it("次数尚未读到：照 core 的顺序", () => {
    expect(heads(table()).map((h) => h.split(" · ")[0])).toEqual(["AI 服务", "开发平台", "证件", "自定义"]);
  });

  it("检索时照样有命中的排在前面", () => {
    // 「p」筛出 AI 服务的两条（api）和证件（passport）
    const hits = countHits({ events: [event("passport")], more: false });
    expect(heads(table("p", hits)).map((h) => h.split(" · ")[0])).toEqual(["证件", "AI 服务"]);
    expect(heads(table("", hits)).map((h) => h.split(" · ")[0])).toEqual(["证件", "AI 服务", "开发平台", "自定义"]);
  });
});

describe("展开与收起", () => {
  it("默认全部收起：只画组头", () => {
    fakeStorage();
    const html = table();
    expect(heads(html)).toHaveLength(4);
    expect(ruleRows(html)).toBe(0);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
  });

  it("记下的展开着的组按防护各一份", () => {
    const m = fakeStorage();
    writeOpenGroups("redact", new Set(["ai-services"]));
    expect(m.get("security.groups.redact")).toBe('["ai-services"]');
    expect(readOpenGroups("redact")).toEqual(new Set(["ai-services"]));
    expect(readOpenGroups("content")).toEqual(new Set());
    const html = table();
    expect(ruleRows(html)).toBe(2);
    expect(html).toContain("Anthropic API 密钥");
    expect(html).not.toContain("GitHub 令牌");
  });

  it("存的东西坏了、或者读不到：照默认收起", () => {
    const m = fakeStorage();
    m.set("security.groups.redact", "{oops");
    expect(readOpenGroups("redact")).toEqual(new Set());
    m.set("security.groups.redact", '{"a":1}');
    expect(readOpenGroups("redact")).toEqual(new Set());
    vi.unstubAllGlobals();
    // 没有 window（隐私窗口里 localStorage 会抛错，一样）
    expect(readOpenGroups("redact")).toEqual(new Set());
    expect(() => writeOpenGroups("redact", new Set(["x"]))).not.toThrow();
  });

  it("检索时匹配的组自动展开，筛掉的行不画", () => {
    fakeStorage();
    const html = table("令牌");
    expect(heads(html)).toEqual(["开发平台 · 1 条 · 已开 1 条"]);
    expect(html).toContain('aria-expanded="true"');
    expect(ruleRows(html)).toBe(1);
    expect(html).toContain("GitHub 令牌");
  });

  it("检索时收起的组只在这一次检索里算；不检索时按记下的", () => {
    const open = new Set(["a"]);
    const closed = new Set(["b"]);
    expect(groupOpen("a", false, open, closed)).toBe(true);
    expect(groupOpen("b", false, open, closed)).toBe(false);
    expect(groupOpen("b", true, open, closed)).toBe(false);
    expect(groupOpen("c", true, open, closed)).toBe(true);
  });
});

describe("组头的键盘", () => {
  /** 一次按键：组头自己收到的（不是行里的控件） */
  function press(props: ReturnType<typeof disclosureNav>, key: string, rows: object[] = []) {
    const self = { focus: vi.fn(), closest: () => ({ querySelectorAll: () => rows }) };
    const e = { key, target: self, currentTarget: self, preventDefault: vi.fn() };
    props.onKeyDown(e as never);
    return { self, e };
  }

  it("Enter、空格展开收起；→ 只展开、← 只收起", () => {
    const toggle = vi.fn();
    const closed = disclosureNav(false, toggle);
    expect(closed["aria-expanded"]).toBe(false);
    expect(closed["data-row-nav"]).toBe("");
    expect(closed.tabIndex).toBe(0);
    press(closed, "Enter");
    press(closed, " ");
    press(closed, "ArrowRight");
    press(closed, "ArrowLeft");
    expect(toggle).toHaveBeenCalledTimes(3);
    toggle.mockClear();
    const open = disclosureNav(true, toggle);
    press(open, "ArrowRight");
    expect(toggle).not.toHaveBeenCalled();
    press(open, "ArrowLeft");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("↑ ↓ 在组头和画出来的行之间走：收起的组里的行不在其中", () => {
    const toggle = vi.fn();
    const props = disclosureNav(false, toggle);
    const next = { focus: vi.fn() };
    const self = { focus: vi.fn(), closest: () => ({ querySelectorAll: () => [self, next] }) };
    const e = { key: "ArrowDown", target: self, currentTarget: self, preventDefault: vi.fn() };
    props.onKeyDown(e as never);
    expect(next.focus).toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    // 收起时表里能走到的只有四个组头
    fakeStorage();
    expect(table().match(/data-row-nav=""/g)).toHaveLength(4);
  });

  it("行里的控件自己处理按键", () => {
    const toggle = vi.fn();
    const props = disclosureNav(false, toggle);
    const e = { key: "Enter", target: {}, currentTarget: {}, preventDefault: vi.fn() };
    props.onKeyDown(e as never);
    expect(toggle).not.toHaveBeenCalled();
  });
});
