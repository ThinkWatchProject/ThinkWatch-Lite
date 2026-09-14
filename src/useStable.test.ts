import { describe, expect, it } from "vitest";

/**
 * `useStableState` 的判据本身（不带 React）。
 *
 * 这个 hook 的失败模式是**不对称的**：多渲染一次只是闪一下，而少渲染
 * 一次是「改了不更新」—— 用户会以为是没生效，然后反复点保存。所以
 * 「变了一定要过」比「没变一定要拦」重要得多，测试也是按这个顺序写的。
 */

/** 和 hook 里用的是同一条判据。 */
function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

describe("变更判据", () => {
  it("内容相同的两个新对象不算变", () => {
    expect(changed({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] })).toBe(false);
  });

  it("深处改了一个值算变", () => {
    expect(changed({ a: { b: 1 } }, { a: { b: 2 } })).toBe(true);
  });

  it("数组里少一项算变", () => {
    expect(changed({ p: [1, 2, 3] }, { p: [1, 2] })).toBe(true);
  });

  /**
   * 这一条是这个 hook 最该被信任的地方：**加一个新字段必须算变**。
   * core 加了字段而界面不更新，表现是「升级了但新功能没出现」。
   */
  it("多一个字段算变", () => {
    expect(changed({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  });

  it("null 和缺失要区分开", () => {
    expect(changed({ a: null }, {})).toBe(true);
  });

  /**
   * **键顺序不同会被判成「变了」。**这是 JSON 判据的已知代价。
   *
   * 对这两个数据源是安全的：它们来自 serde 序列化的 Rust 结构体，
   * 字段顺序由结构体定义固定，同一个二进制不会变。写下来是因为
   * 哪天数据源换成一个 HashMap，这条会悄悄退化成「每次都重渲染」——
   * 那时不是错，只是这个优化失效了，而没有东西会报警。
   */
  it("键顺序不同会被判成变了（已知代价）", () => {
    expect(changed({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });
});
