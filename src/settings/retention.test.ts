import { describe, expect, it } from "vitest";
import type { RetentionView } from "@/types";
import { capText, checks, draftOf } from "./RetentionSection";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const retention = (body_max_bytes: number): RetentionView => ({
  body_days: 7,
  row_days: 90,
  body_max_bytes,
  body_bytes_now: 12 * MIB,
});

/**
 * 日志保留那一节的报文上限，按 GB 写在格子里。
 *
 * 配置文件里手写的上限不一定写得成一位小数的 GB。原来一律取一位：**50 MB 取成「0」**，
 * 那一格不合法，整节表单就存不了了 —— 连改一个期限都不行。
 */
describe("报文上限", () => {
  it("写得出一位小数的照旧写", () => {
    expect(capText(2 * GIB)).toBe("2");
    expect(capText(Math.round(1.5 * GIB))).toBe("1.5");
    expect(capText(Math.round(0.1 * GIB))).toBe("0.1");
  });

  it("写不出的照实写，不取整成一位小数", () => {
    expect(capText(50 * MIB)).toBe("0.0488");
    expect(capText(1.25 * GIB)).toBe("1.25");
  });

  it("小于 51 MB 的上限：没动它时这一节照样能存", () => {
    const saved = draftOf(retention(50 * MIB));
    expect(checks(saved, saved)).toEqual({ body_days: true, row_days: true, body_max_gb: true });
    // 只改了期限：上限那一格没动，照样合法
    expect(checks({ ...saved, body_days: "14" }, saved).body_max_gb).toBe(true);
  });

  it("改过的那一格照样按规矩查", () => {
    const saved = draftOf(retention(2 * GIB));
    expect(checks({ ...saved, body_max_gb: "0.05" }, saved).body_max_gb).toBe(false);
    expect(checks({ ...saved, body_max_gb: "0" }, saved).body_max_gb).toBe(false);
    expect(checks({ ...saved, body_max_gb: "0.5" }, saved).body_max_gb).toBe(true);
    expect(checks({ ...saved, body_days: "0" }, saved).body_days).toBe(false);
  });
});
