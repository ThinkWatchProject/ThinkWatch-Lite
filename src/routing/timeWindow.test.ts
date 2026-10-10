import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import {
  blankTimeWindow,
  describeDays,
  describeTimeWindow,
  formatDays,
  formatTime,
  formatTimeWindow,
  isOvernight,
  parseTime,
  parseTimeWindow,
  timeValueText,
} from "./timeWindow";

/** 周一在前的七个布尔值，给出选中的下标 */
const days = (...on: number[]) => [0, 1, 2, 3, 4, 5, 6].map((i) => on.includes(i));

afterEach(() => setLang("zh"));

describe("时间", () => {
  it("HH:MM，小时 0–24，24 只能带 :00", () => {
    expect(parseTime("09:00")).toBe(540);
    expect(parseTime("9:00")).toBe(540);
    expect(parseTime(" 23:59 ")).toBe(23 * 60 + 59);
    expect(parseTime("24:00")).toBe(1440);
    expect(parseTime("24:01")).toBeNull();
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("09:60")).toBeNull();
    expect(parseTime("0900")).toBeNull();
    expect(parseTime("9")).toBeNull();
    expect(parseTime("")).toBeNull();
  });

  it("写回去补零，1440 是 24:00", () => {
    expect(formatTime(540)).toBe("09:00");
    expect(formatTime(5)).toBe("00:05");
    expect(formatTime(1440)).toBe("24:00");
  });
});

describe("语法往返", () => {
  it.each([
    ["mon-fri 09:00-18:00", days(0, 1, 2, 3, 4), 540, 1080],
    ["sat,sun 00:00-24:00", days(5, 6), 0, 1440],
    ["22:00-06:00", days(0, 1, 2, 3, 4, 5, 6), 1320, 360],
    ["fri-mon 20:00-08:00", days(4, 5, 6, 0), 1200, 480],
    ["mon,wed,fri 12:00-13:00", days(0, 2, 4), 720, 780],
  ])("%s", (text, want, start, end) => {
    const w = parseTimeWindow(text);
    expect(w).toEqual({ days: want, start, end });
    expect(formatTimeWindow(w!)).toBe(text);
  });

  it("大小写、多余空白、两天写成范围：读得进，写出来是规范形", () => {
    expect(formatTimeWindow(parseTimeWindow("  Mon-Fri   9:00 - 18:00 ")!)).toBe("mon-fri 09:00-18:00");
    expect(formatTimeWindow(parseTimeWindow("SAT-SUN 00:00-24:00")!)).toBe("sat,sun 00:00-24:00");
    expect(formatTimeWindow(parseTimeWindow("mon-sun 09:00-18:00")!)).toBe("09:00-18:00");
    expect(formatTimeWindow(parseTimeWindow("mon,tue,wed,thu,fri 09:00-18:00")!)).toBe("mon-fri 09:00-18:00");
    // 周日接着周一算连着：写成一段
    expect(formatTimeWindow(parseTimeWindow("mon-wed,fri,sun 12:00-13:00")!)).toBe("fri,sun-wed 12:00-13:00");
  });

  it("绕过周日的范围", () => {
    expect(parseTimeWindow("fri-mon 09:00-10:00")!.days).toEqual(days(4, 5, 6, 0));
    expect(parseTimeWindow("sun-mon 09:00-10:00")!.days).toEqual(days(6, 0));
    // 两天不写成范围，跨周的两天各归各位
    expect(formatDays(days(6, 0))).toBe("mon,sun");
    expect(formatDays(days(5, 6, 0))).toBe("sat-mon");
    expect(formatDays(days(3, 4, 5, 6, 0, 1))).toBe("thu-tue");
    // 几段按周一在前排；跨周的一段整个排在它开始的那天
    expect(formatDays(days(0, 2, 3, 6))).toBe("mon,wed,thu,sun");
    expect(formatDays(days(0, 2, 4, 5, 6))).toBe("wed,fri-mon");
  });

  it("一天一天的、全选的、没选的", () => {
    expect(formatDays(days(2))).toBe("wed");
    expect(formatDays(days(0, 1, 2, 3, 4, 5, 6))).toBe("");
    expect(formatTimeWindow({ days: days(), start: 540, end: 1080 })).toBeNull();
    expect(blankTimeWindow()).toEqual({ days: days(0, 1, 2, 3, 4, 5, 6), start: 540, end: 1080 });
    expect(formatTimeWindow(blankTimeWindow())).toBe("09:00-18:00");
  });

  it("跨夜", () => {
    expect(isOvernight(parseTimeWindow("22:00-06:00")!)).toBe(true);
    expect(isOvernight(parseTimeWindow("09:00-18:00")!)).toBe(false);
    expect(isOvernight(parseTimeWindow("00:00-24:00")!)).toBe(false);
  });

  it.each([
    "",
    "09:00",
    "09:00-",
    "9-18",
    "09:00-18:00-20:00",
    "mon-fri",
    "mon-fri 09:00-25:00",
    "mon-fri 09:00-24:01",
    "24:00-06:00",
    "09:00-09:00",
    "monday 09:00-18:00",
    "mon,, fri 09:00-18:00",
    "mon-tue-wed 09:00-18:00",
    "mon fri 09:00-18:00",
    "09:00-18:00 mon-fri",
    "09:00–18:00",
  ])("写错的：%j", (text) => {
    expect(parseTimeWindow(text)).toBeNull();
  });
});

describe("写成人话", () => {
  it("中文", () => {
    expect(describeTimeWindow(parseTimeWindow("mon-fri 09:00-18:00")!)).toBe("周一至周五 09:00–18:00");
    expect(describeTimeWindow(parseTimeWindow("sat,sun 00:00-24:00")!)).toBe("周六、周日 00:00–24:00");
    expect(describeTimeWindow(parseTimeWindow("22:00-06:00")!)).toBe("22:00–次日 06:00");
    expect(describeTimeWindow(parseTimeWindow("fri-mon 20:00-08:00")!)).toBe("周五至周一 20:00–次日 08:00");
    expect(describeTimeWindow(parseTimeWindow("mon,wed,fri 12:00-13:00")!)).toBe("周一、周三、周五 12:00–13:00");
    expect(describeDays(days(0, 1, 2, 3, 4, 5, 6))).toBe("");
  });

  it("英文", () => {
    setLang("en");
    expect(describeTimeWindow(parseTimeWindow("mon-fri 09:00-18:00")!)).toBe("Mon–Fri 09:00–18:00");
    expect(describeTimeWindow(parseTimeWindow("sat,sun 00:00-24:00")!)).toBe("Sat, Sun 00:00–24:00");
    expect(describeTimeWindow(parseTimeWindow("22:00-06:00")!)).toBe("22:00–06:00 next day");
    expect(describeTimeWindow(parseTimeWindow("fri-mon 20:00-08:00")!)).toBe("Fri–Mon 20:00–08:00 next day");
  });

  it("条件的值：写不对的按原文；试算的当前时刻也认", () => {
    expect(timeValueText("mon-fri 09:00-18:00")).toBe("周一至周五 09:00–18:00");
    expect(timeValueText("whenever")).toBe("whenever");
    expect(timeValueText("fri 16:42")).toBe("周五 16:42");
    setLang("en");
    expect(timeValueText("Fri 16:42")).toBe("Fri 16:42");
    expect(timeValueText("fri 24:00")).toBe("fri 24:00");
  });
});
