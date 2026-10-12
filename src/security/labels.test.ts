import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { SecurityEventView, SecurityOutcomeCounts, SecurityRuleView } from "@/types";
import { byCodepoints, clock, dayHead, dayKey, modeName, modeTone, OUTCOMES, outcomeTone, ruleWhy } from "./labels";

/** 2026-09-25（周五）16:42:07，本地时区 */
const NOW = new Date(2026, 8, 25, 16, 42, 7).getTime();
const at = (d: number, h = 9, m = 5, s = 3) => new Date(2026, 8, d, h, m, s).getTime();

/**
 * 日志按天分组：今天、昨天写词，更早的写日期。
 *
 * **按本地日历分，不按「24 小时前」分** —— 昨晚 23:59 和今天 00:01 差两分钟，
 * 但是两天的事。
 */
describe("日志的分天", () => {
  it("今天、昨天写词，日期跟在后面", () => {
    expect(dayHead(at(25), NOW)).toEqual({ title: "今天", date: "9月25日周五" });
    expect(dayHead(at(24, 23, 59), NOW)).toEqual({ title: "昨天", date: "9月24日周四" });
  });

  it("更早的只写日期", () => {
    expect(dayHead(at(23), NOW)).toEqual({ title: "9月23日周三", date: null });
  });

  it("跨年带年份", () => {
    const d = dayHead(new Date(2025, 11, 31, 10).getTime(), NOW);
    expect(d.title).toContain("2025");
    expect(d.date).toBeNull();
  });

  it("英文界面按英文写", () => {
    setLang("en");
    expect(dayHead(at(25), NOW)).toEqual({ title: "Today", date: "Fri, Sep 25" });
    expect(dayHead(at(23), NOW).title).toBe("Wed, Sep 23");
  });

  it("零点两边是两天", () => {
    expect(dayKey(at(24, 23, 59, 59))).not.toBe(dayKey(at(25, 0, 0, 1)));
    expect(dayKey(at(25, 0, 0, 1))).toBe(dayKey(at(25, 23, 59, 59)));
  });

  it("行上的时刻到秒，补零", () => {
    expect(clock(at(25, 7, 3, 9))).toBe("07:03:09");
  });
});

/**
 * 颜色说的事：第三档绿、观察琥珀、关闭灰；切断和拒绝红、删除和替换绿、仅记录琥珀。
 * 页头、标签、档位和日志用的是同一套，改一处要全都对得上。
 */
describe("状态的颜色", () => {
  it("档位", () => {
    expect(modeTone("enforce")).toBe("ok");
    expect(modeTone("observe")).toBe("warn");
    expect(modeTone("off")).toBe("idle");
  });

  it("处置", () => {
    expect(outcomeTone("cut")).toBe("error");
    expect(outcomeTone("blocked")).toBe("error");
    expect(outcomeTone("stripped")).toBe("ok");
    expect(outcomeTone("replaced")).toBe("ok");
    expect(outcomeTone("recorded")).toBe("warn");
  });

  /** 页头按这个先后列各做法的条数：五种各一次，红的在前 */
  it("处置的先后", () => {
    const all: SecurityOutcomeCounts = { recorded: 0, replaced: 0, cut: 0, stripped: 0, blocked: 0 };
    expect([...OUTCOMES].sort()).toEqual(Object.keys(all).sort());
    expect(OUTCOMES.map(outcomeTone)).toEqual(["error", "error", "ok", "ok", "warn"]);
  });
});

/** 三种状态各项一样：开启、监控、关闭 */
describe("状态的名字", () => {
  it("中文", () => {
    expect((["enforce", "observe", "off"] as const).map(modeName)).toEqual(["开启", "监控", "关闭"]);
  });

  it("英文", () => {
    setLang("en");
    expect((["enforce", "observe", "off"] as const).map(modeName)).toEqual(["On", "Monitor", "Off"]);
  });
});

const hit = (x: Partial<SecurityEventView>): SecurityEventView => ({
  id: 1,
  at_ms: 0,
  request_id: 7,
  guard: "content",
  rule: "unicode-tags",
  custom: false,
  action: "stripped",
  provider: "relay",
  client: "claude-code",
  model: "claude-sonnet-4",
  excerpt: "summarize ‹U+E0049 ×74› the diff",
  count: 74,
  match: "codepoints",
  direction: "request",
  locations: [],
  more_locations: 0,
  rule_snapshot: { builtin: true, id: "unicode-tags", name: "Unicode tags", matching: "codepoints", core_version: "0.68.0" },
  outcome_detail: { action: "stripped", segments: 1 },
  ...x,
});

/**
 * 内容过滤的一条命中是不是码位规则的：是的话 `count` 是字符数，不是几处。日志里带着
 * 规则怎么认（`match`），照它说。
 */
describe("码位规则的命中", () => {
  it("照日志里的 match 认", () => {
    expect(byCodepoints(hit({}))).toBe(true);
    expect(byCodepoints(hit({ rule: "项目符号", custom: true, excerpt: "• 第一条", count: 3 }))).toBe(true);
    expect(byCodepoints(hit({ rule: "jailbreak", excerpt: "a jailbreak", count: 1, match: "contains" }))).toBe(false);
    expect(byCodepoints(hit({ rule: "代号", custom: true, excerpt: "project falcon", match: "regex" }))).toBe(false);
  });

  it("没写 match 的、别的防护的不算", () => {
    expect(byCodepoints(hit({ match: null }))).toBe(false);
    expect(byCodepoints(hit({ guard: "redact", rule: "anthropic-api-key", match: undefined }))).toBe(false);
  });
});

/** 内置内容规则的说明：中文查表；英文那句以名字开头的，名字去掉（名字在上一行） */
describe("内容规则的说明", () => {
  const rule = (why: string): SecurityRuleView => ({
    id: "bidi-controls",
    custom: false,
    name: "Bidirectional controls",
    why,
    kind: "invisible",
    matcher: { kind: "codepoints", ranges: ["U+202A–U+202E", "U+2066–U+2069"] },
    enabled: true,
    on_by_default: true,
    action: "strip",
    default_action: "strip",
  });

  it("中文查表", () => {
    expect(ruleWhy("content", rule("Bidirectional controls: they reorder text."))).toBe(
      "可使屏幕上的显示顺序与实际字符顺序不一致。",
    );
  });

  it("英文去掉开头的名字", () => {
    setLang("en");
    expect(ruleWhy("content", rule("Bidirectional controls: they reorder text."))).toBe("They reorder text.");
    expect(ruleWhy("content", rule("They reorder text."))).toBe("They reorder text.");
  });
});
