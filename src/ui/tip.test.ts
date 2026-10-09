import { describe, expect, it } from "vitest";
import { clipped } from "./tip";

/** 量得出宽度的一块：`scrollWidth` 是字要多宽，`clientWidth` 是给了多宽 */
const box = (scrollWidth: number, clientWidth: number, children: Element[] = []): Element =>
  ({ scrollWidth, clientWidth, querySelectorAll: () => children }) as unknown as Element;

describe("截没截断", () => {
  it("这一块放不下自己的字", () => {
    expect(clipped(box(320, 208))).toBe(true);
    expect(clipped(box(186, 208))).toBe(false);
    expect(clipped(box(208, 208))).toBe(false);
  });

  it("这一块放得下，里面有一段被截了（组头那一串名字：第一项截断，或者其余那段）", () => {
    expect(clipped(box(208, 208, [box(300, 196), box(12, 12)]))).toBe(true);
    expect(clipped(box(208, 208, [box(80, 80), box(140, 12)]))).toBe(true);
    expect(clipped(box(208, 208, [box(80, 80), box(60, 128)]))).toBe(false);
  });

  it("行内元素、还没挂上的量不出宽度，记作放得下", () => {
    expect(clipped(box(0, 0))).toBe(false);
    expect(clipped(null)).toBe(false);
  });
});
