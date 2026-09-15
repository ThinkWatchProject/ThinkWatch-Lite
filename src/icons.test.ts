import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 图标这一层的纪律，原来只写在注释里。
 *
 * 换成 lucide 重导出之后，一次手滑就能让两个概念指到同一个图形，而那在
 * 类型上完全合法、在界面上只是「怎么两个格子长一样」。
 */
describe("源列表图标", () => {
  const src = readFileSync("src/ui/icons.tsx", "utf8");
  const pairs = [...src.matchAll(/export \{ (\w+) as (Icon\w+) \}/g)].flatMap(
    // `noUncheckedIndexedAccess` 下捕获组是 `string | undefined`
    (m) => (m[1] && m[2] ? [{ lucide: m[1], name: m[2] }] : []),
  );

  it("每个概念都映到一个图形", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(12);
  });

  /**
   * **最要紧的一条。**收起源列表之后只剩图标，路由 / 网关 / 客户端 /
   * 上游是四个最容易混的概念，认错的代价是点错页。
   */
  it("没有两个概念共用同一个图形", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const { lucide, name } of pairs) {
      const had = seen.get(lucide);
      if (had) clashes.push(`${had} 和 ${name} 都用了 ${lucide}`);
      else seen.set(lucide, name);
    }
    expect(clashes).toEqual([]);
  });

  it("全部来自 lucide，没有留下手画的", () => {
    expect(src).not.toContain("<svg");
    expect(src).not.toContain("<path");
  });
});
