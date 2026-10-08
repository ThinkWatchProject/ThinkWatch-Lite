import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * I11：插件写的字（名字、说明、设置项的标签、日志、报错）只按纯文本画。
 *
 * React 本来就转义文本，会出问题的只有把字当成 HTML 塞进去的那几种写法。插件页和画插件
 * 运行记录的请求详情里一处都不许有 —— 以后谁为了「加粗一下日志里的关键字」写一个
 * `dangerouslySetInnerHTML`，这里就拦住。
 */
const FILES = [
  ...readdirSync("src/plugins")
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => join("src/plugins", f)),
  ...readdirSync("src/traffic/drawer")
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => join("src/traffic/drawer", f)),
  "src/traffic/RequestTable.tsx",
];

describe("插件写的字只当纯文本", () => {
  it("没有把字当成 HTML 的写法", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      for (const w of ["dangerouslySetInnerHTML", "innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"]) {
        if (src.includes(w)) bad.push(`${f}: ${w}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("插件的名字、说明、日志经过 PluginText 画", () => {
    const page = readFileSync("src/plugins/PluginsPage.tsx", "utf8");
    // 列表上的名字和说明（默认插件换成界面语言之后的那一份，见 `defaults.ts`）
    expect(page).toMatch(/<PluginText\s+text=\{w\.name\}/);
    expect(page).toMatch(/<PluginText\s+text=\{w\.description\}/);
    const logs = readFileSync("src/plugins/LogsDialog.tsx", "utf8");
    expect(logs).toMatch(/<PluginText\s+text=\{l\.text\}/);
  });
});
