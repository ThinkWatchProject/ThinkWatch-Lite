import { describe, expect, it } from "vitest";
import { howToUpdate, type Install } from "./Update";

/**
 * 这一条是产品决定，不是界面细节。
 *
 * Homebrew 把应用移进 `/Applications`，并记下它放进去的是哪一版。应用
 * 自己把那个包换掉之后，那条记录指向的版本已经不在磁盘上了，而下一次
 * `brew upgrade` 会拿旧的那版盖回来 —— 用户什么都没做，被降了一级。
 *
 * Rust 那一侧也挡着（`update_install` 对这一档直接返回错误）。这里再测
 * 一遍，是因为界面上多出一个安装按钮本身就是错的：它承诺了一件做不到
 * 的事，而用户要点下去才知道。
 */
describe("谁来做更新", () => {
  it("Homebrew 装的不给安装按钮", () => {
    expect(howToUpdate("homebrew").can).toBe(false);
  });

  it("手工装的可以自己更新", () => {
    expect(howToUpdate("standalone").can).toBe(true);
  });

  it("开发构建不自更新", () => {
    expect(howToUpdate("dev").can).toBe(false);
  });

  /** 每一档都要说清接下来该做什么 —— 一个不能点的按钮旁边必须有出路 */
  it("每一档都给出一句说明", () => {
    const all: Install[] = ["homebrew", "standalone", "dev"];
    for (const k of all) expect(howToUpdate(k).how.length).toBeGreaterThan(8);
  });
});
