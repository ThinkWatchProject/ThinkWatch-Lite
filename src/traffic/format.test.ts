import { describe, expect, it } from "vitest";
import { tokens } from "./format";

/**
 * 会话那一侧的 token 数（组头的上下文峰值、详情里的用量）。
 *
 * **先取整，再定单位**：999_600 取整是「1000k」，进了位就该写成「1.0M」，和同一列里
 * 别的「2.7M」是一种写法。
 */
describe("会话的 token 数", () => {
  it("千以上换 k，百万以上换 M", () => {
    expect(tokens(463)).toBe("463");
    expect(tokens(48_200)).toBe("48k");
    expect(tokens(2_698_000)).toBe("2.7M");
  });

  it("取整进了位的，按下一档写", () => {
    expect(tokens(999_499)).toBe("999k");
    expect(tokens(999_600)).toBe("1.0M");
  });
});
