import { describe, expect, it } from "vitest";
import { codeKey, comboText, hotkeyCombo, isInAppCombo } from "./keys";

// 测试里不是任何一个平台（`platform.ts` 的 "other"），主修饰键按 Ctrl 算
describe("呼出快捷键", () => {
  it("物理键位写成键上的字", () => {
    expect(codeKey("KeyH")).toBe("H");
    expect(codeKey("Digit7")).toBe("7");
    expect(codeKey("Comma")).toBe(",");
    expect(codeKey("ArrowUp")).toBe("up");
    expect(codeKey("Space")).toBe("space");
    expect(codeKey("F5")).toBe("F5");
  });

  it("修饰键按 Ctrl、Alt、Shift、Win / Super 的顺序", () => {
    const c = hotkeyCombo({ ctrl: true, alt: true, shift: true, meta: true, code: "KeyH" });
    expect(c).toEqual(["ctrl", "alt", "shift", "meta", "H"]);
    expect(comboText(hotkeyCombo({ ctrl: true, alt: true, shift: false, meta: false, code: "KeyH" }))).toBe(
      "Ctrl+Alt+H",
    );
  });

  /** 拿去做呼出的话，界面里那个就按不到了 */
  it("界面里已有的快捷键算占用，出厂的 Ctrl+Alt+H 不算", () => {
    expect(isInAppCombo(["ctrl", "K"])).toBe(true);
    expect(isInAppCombo(["ctrl", "1"])).toBe(true);
    expect(isInAppCombo(["ctrl", "="])).toBe(true);
    expect(isInAppCombo(["ctrl", ","])).toBe(true);
    expect(isInAppCombo(["ctrl", "alt", "K"])).toBe(false);
    expect(isInAppCombo(["ctrl", "alt", "H"])).toBe(false);
    expect(isInAppCombo(["meta", "K"])).toBe(false);
  });
});
