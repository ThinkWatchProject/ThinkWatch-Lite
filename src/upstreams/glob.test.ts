import { describe, expect, it } from "vitest";
import { globMatch } from "./glob";

/** 参考实现：逐字符回溯。慢，但一眼能看出是对的 */
function reference(p: string, s: string): boolean {
  if (p === "") return s === "";
  if (p[0] === "*") return reference(p.slice(1), s) || (s !== "" && reference(p, s.slice(1)));
  return s !== "" && p[0] === s[0] && reference(p.slice(1), s.slice(1));
}

function all(alphabet: string, max: number): string[] {
  const out = [""];
  let layer = [""];
  for (let i = 0; i < max; i++) {
    layer = layer.flatMap((w) => [...alphabet].map((c) => w + c));
    out.push(...layer);
  }
  return out;
}

describe("模型名通配", () => {
  it("常见写法", () => {
    expect(globMatch("claude-opus-*", "claude-opus-4-5")).toBe(true);
    expect(globMatch("*sonnet*", "claude-sonnet-4-5")).toBe(true);
    expect(globMatch("claude-opus", "claude-opus-4-5")).toBe(false);
    expect(globMatch("Claude-Opus-*", "claude-opus-4-5")).toBe(true);
  });

  /** 和 core 一起修的那个错：结尾那一段在前面也出现过 */
  it("最后一个 * 之后的部分锚定在结尾", () => {
    expect(globMatch("*-mini", "gpt-4o-mini-2024-mini")).toBe(true);
    expect(globMatch("a*b", "abxb")).toBe(true);
    expect(globMatch("ab*ba", "aba")).toBe(false);
  });

  /** 和 core 那边同一个穷举：模式 ≤ 5 个字符、字符串 ≤ 6 个，字母表 a、b */
  it("短输入上和回溯匹配器的结果一致", () => {
    const bad: string[] = [];
    for (const p of all("ab*", 5)) {
      for (const s of all("ab", 6)) {
        if (globMatch(p, s) !== reference(p, s)) bad.push(`${p} ~ ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
