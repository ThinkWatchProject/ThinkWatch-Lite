import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/[.](ts|tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 制表、换行、回车以外的 C0 控制字符 */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  return false;
}

describe("源码文件", () => {
  /**
   * **下拉框里的占位值曾经是一个字面的 NUL 字节。**编译和运行都没问题，
   * 但 git 从此把整个文件当二进制：PR 里看不到这个文件的 diff，评审时等于
   * 没审。
   */
  it("不含 NUL 等控制字符", () => {
    const bad = sources("src").filter((f) => hasControlChar(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});
