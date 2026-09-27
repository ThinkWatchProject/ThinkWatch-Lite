import { describe, expect, it } from "vitest";
import { parseDecimal } from "./decimal";

describe("输入框里的小数", () => {
  it("小数点写成逗号也认", () => {
    // 以前 `Number("0,5")` 是 NaN：用逗号作小数点的地区在价格框里一个数都填不进去
    expect(parseDecimal("0,5")).toBe(0.5);
    expect(parseDecimal("1,25")).toBe(1.25);
    expect(parseDecimal(" 2,5 ")).toBe(2.5);
    expect(parseDecimal(",5")).toBe(0.5);
    // 打到一半的样子
    expect(parseDecimal("1,")).toBe(1);
  });

  it("写成点的照旧", () => {
    expect(parseDecimal("0.5")).toBe(0.5);
    expect(parseDecimal("3")).toBe(3);
    expect(parseDecimal("0.")).toBe(0);
    expect(parseDecimal("-1.5")).toBe(-1.5);
  });

  it("逗号和点都有、逗号不止一个：不猜，认不出", () => {
    // 1,000.5 是千分位还是别的，说不准；按 1 算比报错更糟
    expect(parseDecimal("1,000.5")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal("1.2,3")).toBeNull();
  });

  it("空的、不是数的：null", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("Infinity")).toBeNull();
  });
});
