import { describe, expect, it } from "vitest";
import { isSidebarShortcut } from "./sidebar";

/** 一次按键：`target` 是焦点所在的那个元素（只看它的标签名和能不能编辑） */
const key = (target: object | null, over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean }> = {}) =>
  ({ key: "b", metaKey: false, ctrlKey: true, target, ...over }) as unknown as KeyboardEvent;

/**
 * 收起、展开侧栏的 ⌘B / Ctrl+B。**焦点在能打字的地方时不接管**：macOS 上 Ctrl+B 是
 * 光标左移一格，编辑器里 ⌘B 常是加粗 —— 在配置编辑器里按一下，侧栏收起来了。
 */
describe("侧栏的快捷键", () => {
  it("焦点不在输入的地方：接管", () => {
    expect(isSidebarShortcut(key({ tagName: "BUTTON" }))).toBe(true);
    expect(isSidebarShortcut(key({ tagName: "DIV" }, { ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSidebarShortcut(key(null))).toBe(true);
  });

  it("在输入框、文本框、可编辑区域（配置编辑器）里：不接管", () => {
    expect(isSidebarShortcut(key({ tagName: "INPUT" }))).toBe(false);
    expect(isSidebarShortcut(key({ tagName: "TEXTAREA" }))).toBe(false);
    expect(isSidebarShortcut(key({ tagName: "DIV", isContentEditable: true }, { ctrlKey: false, metaKey: true }))).toBe(false);
  });

  it("别的键、不带修饰键：不是它", () => {
    expect(isSidebarShortcut(key({ tagName: "DIV" }, { key: "k" }))).toBe(false);
    expect(isSidebarShortcut(key({ tagName: "DIV" }, { ctrlKey: false }))).toBe(false);
  });
});
