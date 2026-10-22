import { describe, expect, it } from "vitest";
import { mergeOrder, moved, sortByOrder } from "./order";

const KNOWN = ["claude-code", "codex", "opencode", "zed", "cursor", "continue"];

describe("按存下的顺序排", () => {
  it("没排过：注册表顺序", () => {
    expect(sortByOrder(KNOWN, [], (x) => x)).toEqual(KNOWN);
    expect(sortByOrder(["b", "a"], [], (x) => x)).toEqual(["b", "a"]);
  });

  it("排过的在前、按存下的先后；没排过的按原来的先后跟在后面", () => {
    expect(sortByOrder(KNOWN, ["zed", "codex"], (x) => x)).toEqual([
      "zed",
      "codex",
      "claude-code",
      "opencode",
      "cursor",
      "continue",
    ]);
  });

  it("不认识的 id、重复的 id 不影响", () => {
    expect(sortByOrder(["claude-code", "codex"], ["gone", "codex", "nope", "codex", "claude-code"], (x) => x)).toEqual([
      "codex",
      "claude-code",
    ]);
  });

  it("按 id 认对象", () => {
    const rows = [{ id: "claude-code" }, { id: "codex" }];
    expect(sortByOrder(rows, ["codex"], (r) => r.id).map((r) => r.id)).toEqual(["codex", "claude-code"]);
  });
});

describe("一张表排过之后要存的顺序", () => {
  it("没排过：只存这张表里的，别处照旧按注册表", () => {
    const saved = mergeOrder([], KNOWN, ["codex", "claude-code"]);
    expect(saved).toEqual(["codex", "claude-code"]);
    // 另一张表（手动配置）不受影响
    expect(sortByOrder(["cursor", "continue"], saved, (x) => x)).toEqual(["cursor", "continue"]);
  });

  it("这张表里的占着原来的位置，别的相对顺序不动", () => {
    // 原来排过四个，这张表里的是 claude-code 和 codex
    const order = ["cursor", "claude-code", "continue", "codex"];
    const saved = mergeOrder(order, KNOWN, ["codex", "claude-code"]);
    expect(saved).toEqual(["cursor", "codex", "continue", "claude-code"]);
    expect(sortByOrder(["continue", "cursor"], saved, (x) => x)).toEqual(["cursor", "continue"]);
  });

  it("表里有从未排过的：排过之后都记下来", () => {
    const saved = mergeOrder(["codex"], KNOWN, ["opencode", "codex", "claude-code"]);
    expect(sortByOrder(["claude-code", "codex", "opencode"], saved, (x) => x)).toEqual([
      "opencode",
      "codex",
      "claude-code",
    ]);
    expect(saved).not.toContain("zed");
  });

  it("这台电脑和 WSL 共用一份：WSL 那一组排过，这台电脑上也跟着", () => {
    const saved = mergeOrder([], KNOWN, ["codex", "claude-code"]);
    expect(sortByOrder(["claude-code", "codex", "opencode"], saved, (x) => x)).toEqual([
      "codex",
      "claude-code",
      "opencode",
    ]);
  });

  it("不认识的 id、重复的 id 丢掉", () => {
    expect(mergeOrder(["gone", "codex", "codex", "zed"], KNOWN, ["claude-code", "codex"])).toEqual([
      "claude-code",
      "zed",
      "codex",
    ]);
  });
});

describe("挪一行", () => {
  it("往下、往上", () => {
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });
});
