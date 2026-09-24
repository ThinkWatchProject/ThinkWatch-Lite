import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 改配置必须走 `patchConfig()`。
 *
 * **这不是洁癖，是一个真出过的 bug。**`invoke()` 的参数类型是
 * `Record<string, unknown>`，所以 `ops` 里写什么都能编译过去。`Guard.tsx`
 * 里写的是 `op: "set"` —— 协议里没有这个操作，于是防护模式那三个按钮
 * 从第一天起一次都没生效过，每次点都被后端拒掉。
 *
 * 包一层之后 `PatchOp[]` 才真的被检查。这条测试保证没人绕开它。
 */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("配置补丁", () => {
  it("没有人绕过 patchConfig 直接调", () => {
    const bad = tsFiles("src")
      .filter((f) => !f.endsWith("patch.ts") && !f.endsWith("patch.test.ts"))
      .filter((f) => readFileSync(f, "utf8").includes('call("PatchConfig"'))
      .map((f) => `${f}：改配置要走 patchConfig()，那里 PatchOp[] 才会被类型检查`);
    expect(bad).toEqual([]);
  });

  it("用到的 op 都在协议里", () => {
    const allowed = new Set(["replace", "append", "remove", "clear"]);
    const bad: string[] = [];
    for (const f of tsFiles("src")) {
      const text = readFileSync(f, "utf8");
      // 只看紧跟在 patchConfig( 之后的那些，别把别的 op 字段算进来
      for (const m of text.matchAll(/patchConfig\(\s*\[?([\s\S]{0,400}?)\]?,\s*\w/g)) {
        for (const o of (m[1] ?? "").matchAll(/\bop: "(\w+)"/g)) {
          if (!allowed.has(o[1]!)) bad.push(`${f}: op "${o[1]}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
