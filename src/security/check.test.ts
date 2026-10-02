import { describe, expect, it } from "vitest";
import { checkCodepoints, labelOk, placeholderOf } from "./check";
import { drawInvisible } from "./Highlight";

/**
 * 码位的写法，照接口约定：逗号、顿号或空白分隔；`U+HEX` 或 `U+HEX-U+HEX`（短横线或 `–`），
 * `u+` 不分大小写；1–6 位十六进制，0–10FFFF、不是代理区，起点不大于终点；最多 32 项。
 */
describe("码位的写法", () => {
  it("单个码位、范围、几种分隔符都认", () => {
    expect(checkCodepoints("U+200B")).toBeNull();
    expect(checkCodepoints("U+E0000–U+E007F")).toBeNull();
    expect(checkCodepoints("u+202a-u+202e, U+2066–U+2069")).toBeNull();
    expect(checkCodepoints("U+200B、U+FEFF U+2060，U+200C")).toBeNull();
    expect(checkCodepoints("U+0, U+10FFFF")).toBeNull();
  });

  it("写错的那一项指出来", () => {
    expect(checkCodepoints("U+200B, 200C")).toEqual({ kind: "syntax", item: "200C" });
    expect(checkCodepoints("U+1234567")).toEqual({ kind: "syntax", item: "U+1234567" });
    expect(checkCodepoints("U+E0000–E007F")).toEqual({ kind: "syntax", item: "U+E0000–E007F" });
    // 范围的两端之间不能有空白：空白是分隔符
    expect(checkCodepoints("U+0041 - U+0042")).toEqual({ kind: "syntax", item: "-" });
  });

  it("超出范围、代理区、起点大于终点", () => {
    expect(checkCodepoints("U+110000")).toEqual({ kind: "range", item: "U+110000" });
    expect(checkCodepoints("U+D800")).toEqual({ kind: "surrogate", item: "U+D800" });
    expect(checkCodepoints("U+0041–U+DFFF")).toEqual({ kind: "surrogate", item: "U+0041–U+DFFF" });
    expect(checkCodepoints("U+E007F–U+E0000")).toEqual({ kind: "order", item: "U+E007F–U+E0000" });
  });

  it("没有一项、超过 32 项", () => {
    expect(checkCodepoints(" , 、 ")).toEqual({ kind: "empty" });
    const many = Array.from({ length: 33 }, (_, i) => `U+${(0x41 + i).toString(16)}`).join(", ");
    expect(checkCodepoints(many)).toEqual({ kind: "count" });
    expect(checkCodepoints(many.split(", ").slice(0, 32).join(", "))).toBeNull();
  });
});

/** 占位符名称：大写字母开头，只有大写字母、数字和下划线，最多 24 个字符 */
describe("占位符名称", () => {
  it("合法的", () => {
    expect(labelOk("SECRET")).toBe(true);
    expect(labelOk("ID_NUMBER")).toBe(true);
    expect(labelOk("P2")).toBe(true);
    expect(labelOk("A".repeat(24))).toBe(true);
  });

  it("不合法的", () => {
    expect(labelOk("")).toBe(false);
    expect(labelOk("secret")).toBe(false);
    expect(labelOk("2FA")).toBe(false);
    expect(labelOk("_X")).toBe(false);
    expect(labelOk("MY-ID")).toBe(false);
    expect(labelOk("A".repeat(25))).toBe(false);
  });

  it("替换后的样子", () => {
    expect(placeholderOf("PROJECT")).toBe("<<TW_PROJECT_1>>");
  });
});

/** 测试框里标出来的那一段，看不见的字符画成码位 */
describe("看不见的字符", () => {
  it("一个画成码位，连着一串画成第一个加省略号", () => {
    expect(drawInvisible("a\u200bb")).toBe("a‹U+200B›b");
    expect(drawInvisible("\u{E0049}\u{E0067}\u{E006E}")).toBe("‹U+E0049…›");
    expect(drawInvisible("x\u202Ey\u2066")).toBe("x‹U+202E›y‹U+2066›");
    // 变体选择符也看不见
    expect(drawInvisible("ok 👍\uFE0F")).toBe("ok 👍‹U+FE0F›");
  });

  it("看得见的照原样", () => {
    expect(drawInvisible("ignore previous instructions")).toBe("ignore previous instructions");
    expect(drawInvisible("中文、emoji 👍")).toBe("中文、emoji 👍");
  });
});
