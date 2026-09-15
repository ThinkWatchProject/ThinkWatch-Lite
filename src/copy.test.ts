import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 文案的机械检查。
 *
 * 这里测的不是逻辑，是**几类会反复回来的错误**。每一条都至少犯过一次，
 * 而它们的共同点是：编译通过、类型正确、跑起来也不报错，只是界面上显示
 * 的东西不对。没有东西会告诉你，除非有人正好看到那一屏。
 */

const SRC = "src";

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** 去掉注释 —— 注释是写给开发者的，不受这些规矩管。 */
function visible(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const files = tsxFiles(SRC).map((f) => ({
  path: f,
  text: visible(readFileSync(f, "utf8")),
}));

describe("界面文案", () => {
  /**
   * **犯过三次了。**`**粗体**` 是 Markdown，JSX 的文本节点里它就是四个
   * 星号，会原样显示给用户。注释里可以那么写，界面上不行。
   */
  it("JSX 文本里没有 Markdown 的粗体星号", () => {
    const bad: string[] = [];
    for (const f of files) {
      // >文本** 或 **文本< —— 出现在标签之间的星号
      for (const m of f.text.matchAll(/>[^<>{}]*\*\*[^<>{}]*</g)) {
        bad.push(`${f.path}: ${m[0].slice(0, 60).trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 产品不自称「我们」，也不替用户说「我」。
   *
   * 生产力工具用名词短语和祈使句陈述状态：「写入客户端配置」而不是
   * 「帮我写进客户端配置」，「标记已读」而不是「我看过了」。
   */
  it("界面上不出现第一人称", () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/(我们|帮我|我看过|我的改动)/g)) {
        const i = m.index ?? 0;
        bad.push(`${f.path}: …${f.text.slice(Math.max(0, i - 18), i + 14).replace(/\s+/g, " ")}…`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 同一个动作只能有一种说法。
   *
   * 「关掉」和「关闭」曾经在两个对话框上各用一个 —— 用户不会意识到那是
   * 同一个动作，只会觉得这个产品是好几个人拼起来的。
   */
  it("同义词没有混用", () => {
    const pairs: [RegExp, string][] = [
      [/关掉/g, "统一用「关闭」"],
      [/测一下|测速一下/g, "统一用「测试」"],
      [/算账/g, "统一用「预估」或「计算」"],
    ];
    const bad: string[] = [];
    for (const f of files) {
      for (const [re, hint] of pairs) {
        for (const m of f.text.matchAll(re)) {
          bad.push(`${f.path}: ${m[0]} —— ${hint}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 字号只能从那四级里选。
   *
   * 按尺寸命名的类（`text-xs`）和硬编码的 `text-[12px]` 是同一个毛病：
   * 下一个人按「看起来差不多大」来选，于是层级又没了。
   *
   * **`src/ui/` 不在此列。**那里放的是 shadcn 抄进来的组件，它们统一
   * 写 `text-sm` / `text-xs`。这不是破例：下面那条检查保证这两个名字
   * 在 `index.css` 里被绑到 13px 和 11px —— 也就是 tw-body 和 tw-label
   * 本身。同一个字阶，两个名字，不是第五第六级。
   */
  it("没有绕过 type scale 的字号", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f.path.startsWith(join(SRC, "ui"))) continue;
      for (const m of f.text.matchAll(/text-(xs|sm|base|\[\d+px\])/g)) {
        bad.push(`${f.path}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * 上面那条豁免赖以成立的前提。
   *
   * 绑定一旦没了，`text-sm` 会悄悄退回 Tailwind 默认的 14px —— 一个
   * 字阶里没有的字号，而且是从组件里渗进来的，不会有任何一处代码看起来
   * 是错的。
   */
  it("text-sm / text-xs 绑在字阶上", () => {
    const css = readFileSync(join(SRC, "index.css"), "utf8");
    expect(css).toContain("--text-sm: 0.8125rem"); // 13px = tw-body
    expect(css).toContain("--text-xs: 0.6875rem"); // 11px = tw-label
  });
});
