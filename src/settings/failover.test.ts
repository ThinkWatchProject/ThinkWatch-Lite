import { describe, expect, it } from "vitest";
import type { FailoverView } from "@/types";
import { checks, draftOf } from "./FailoverSection";

const failover: FailoverView = {
  failures_to_pause: 3,
  pause_secs: 60,
  max_pause_secs: 600,
  no_balance_pause_secs: 1800,
  quota_pause_secs: 3600,
  rate_limit_max_pause_secs: 3600,
  idle_timeout_secs: 300,
  slot_wait_secs: 30,
};

const allOk = (c: Record<string, boolean>) => Object.values(c).every(Boolean);

/** 故障转移那一节：范围和 core 的校验一样，写错的那一格单独标出来 */
describe("故障转移", () => {
  it("配置里的值原样可存", () => {
    const saved = draftOf(failover);
    expect(allOk(checks(saved, saved))).toBe(true);
  });

  it("停用时长和次数不能是 0", () => {
    const saved = draftOf(failover);
    expect(checks({ ...saved, pause_secs: "0" }, saved).pause_secs).toBe(false);
    expect(checks({ ...saved, failures_to_pause: "0" }, saved).failures_to_pause).toBe(false);
    expect(checks({ ...saved, quota_pause_secs: "1.5" }, saved).quota_pause_secs).toBe(false);
  });

  it("起点改到比上限还大时，没动过的上限也标出来", () => {
    const saved = draftOf(failover);
    const c = checks({ ...saved, pause_secs: "900" }, saved);
    expect(c.pause_secs).toBe(true);
    expect(c.max_pause_secs).toBe(false);
    expect(checks({ ...saved, pause_secs: "900", max_pause_secs: "900" }, saved).max_pause_secs).toBe(true);
  });

  it("等空位的秒数可以是 0（不等），最多 300", () => {
    const saved = draftOf(failover);
    expect(saved.slot_wait_secs).toBe("30");
    expect(checks({ ...saved, slot_wait_secs: "0" }, saved).slot_wait_secs).toBe(true);
    expect(checks({ ...saved, slot_wait_secs: "300" }, saved).slot_wait_secs).toBe(true);
    expect(checks({ ...saved, slot_wait_secs: "301" }, saved).slot_wait_secs).toBe(false);
    expect(checks({ ...saved, slot_wait_secs: "" }, saved).slot_wait_secs).toBe(false);
  });

  it("无响应超时：默认 300 秒，30 到 3600 之间的整数", () => {
    const saved = draftOf(failover);
    expect(saved.idle_timeout_secs).toBe("300");
    for (const ok of ["30", "600", "3600"])
      expect(checks({ ...saved, idle_timeout_secs: ok }, saved).idle_timeout_secs).toBe(true);
    for (const bad of ["29", "3601", "0", "", "90.5"])
      expect(checks({ ...saved, idle_timeout_secs: bad }, saved).idle_timeout_secs).toBe(false);
  });
});
