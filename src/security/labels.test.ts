import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { SecurityOutcomeCounts } from "@/types";
import { clock, dayHead, dayKey, modeTone, OUTCOMES, outcomeTone } from "./labels";

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
 * 颜色说的事：拦截绿、观察琥珀、关闭灰；切断和拒绝红、替换绿、仅记录琥珀。
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
    expect(outcomeTone("replaced")).toBe("ok");
    expect(outcomeTone("recorded")).toBe("warn");
  });

  /** 页头按这个先后列各做法的条数：四种各一次，红的在前 */
  it("处置的先后", () => {
    const all: SecurityOutcomeCounts = { recorded: 0, replaced: 0, cut: 0, blocked: 0 };
    expect([...OUTCOMES].sort()).toEqual(Object.keys(all).sort());
    expect(OUTCOMES.map(outcomeTone)).toEqual(["error", "error", "ok", "warn"]);
  });
});
