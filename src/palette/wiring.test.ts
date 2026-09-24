import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 命令面板只负责把人送过去：「新建上游…」是 `nav.open("upstreams", { create: … })`，
 * 打开对话框的是上游页里的 `useNavParams("upstreams", …)`。**两头在两个文件里**，
 * 重写一页时很容易把接收的那一段丢掉 —— 类型照过、运行也不报错，只是面板里选了之后
 * 只换页、不开对话框。
 *
 * 这里从 `items.tsx` 找出面板送出的每一对（页，参数），再查有没有一个源文件接住它：
 * 文件里有 `useNavParams("<页>"`（或者外壳在 App.tsx 里按 `NavParams["<页>"]` 处理的
 * 流量筛选、搜索框），并且读了 `.<参数>`。
 */

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** `nav.open("keys", { edit: k.name })` → keys / edit。三元式两边的对象都算 */
function sent(src: string): [string, string][] {
  const out = new Map<string, [string, string]>();
  for (const m of src.matchAll(/nav\.open\(\s*"(\w+)"\s*,([^)]*)\)/g)) {
    for (const k of m[2]!.matchAll(/[{,]\s*(\w+)\s*:/g)) out.set(`${m[1]}.${k[1]}`, [m[1]!, k[1]!]);
  }
  return [...out.values()];
}

describe("命令面板送出的参数", () => {
  const files = sources("src").map((f) => ({ f, text: readFileSync(f, "utf8") }));
  const pairs = sent(readFileSync("src/palette/items.tsx", "utf8"));

  it("找得到送出的参数（这条检查本身还管用）", () => {
    expect(pairs.length).toBeGreaterThan(10);
    expect(pairs).toContainEqual(["upstreams", "create"]);
    expect(pairs).toContainEqual(["clients", "setup"]);
  });

  it("每一个都有页面（或外壳）接住", () => {
    const missing = pairs.filter(([surface, key]) => {
      const readers = files.filter(
        ({ text }) => text.includes(`useNavParams("${surface}"`) || text.includes(`NavParams["${surface}"]`),
      );
      return !readers.some(({ text }) => new RegExp(`\\.${key}\\b`).test(text));
    });
    expect(missing.map(([s, k]) => `${s}.${k}`)).toEqual([]);
  });
});
