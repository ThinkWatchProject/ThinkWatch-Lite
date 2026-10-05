import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { ModelScope } from "./ModelScope";
import type { CatalogModel } from "./scope";

const noop = () => {};

describe("可见模型：指定范围", () => {
  it("模型目录是空的时候，手填的模型 ID 照样列出来，可以取消", () => {
    // 规则框里填的 `gpt-5`（没有 `*`）是单独选中的一条。以前目录一空这张表就不画：
    // 规则那一栏只列带 `*` 的，它哪儿都不出现，也就删不掉
    const html = renderToStaticMarkup(
      <ModelScope scope="some" entries={["claude-*", "gpt-5"]} catalog={[]} onScope={noop} onEntries={noop} />,
    );
    expect(html).toContain("尚未获取到任何上游的模型清单");
    expect(html).toMatch(/<td[^>]*><span class="font-mono">gpt-5<\/span><\/td>/);
    // 勾着的勾选框，点一下就是取消
    expect(html).toMatch(/aria-label="gpt-5"[^>]*aria-checked="true"|aria-checked="true"[^>]*aria-label="gpt-5"/);
  });

  it("目录是空的、也没有单独选中的：只写那一句说明，不画一张空表", () => {
    const html = renderToStaticMarkup(
      <ModelScope scope="some" entries={["claude-*"]} catalog={[]} onScope={noop} onEntries={noop} />,
    );
    expect(html).toContain("尚未获取到任何上游的模型清单");
    expect(html).not.toContain("<table");
  });
});

const ALIASED: CatalogModel[] = [
  { id: "deepseek-v4.1", providers: ["relay-cn"], alias: ["DeepSeek-v4.1-flash"], aliases: [] },
  { id: "DeepSeek-v4.1-flash", providers: ["relay-cn"], aliases: ["deepseek-v4.1"] },
  { id: "glm-4.6", providers: ["zai", "bigmodel"], aliases: [] },
];

/** 一行 `<tr>…</tr>` 里有这个模型名的那一行 */
function rowOf(html: string, id: string): string {
  return html.split("<tr").find((r) => r.includes(`aria-label="${id}"`)) ?? "";
}

describe("可见模型：别名", () => {
  it("别名带一个「别名」标记；随模型放行的勾上、点不动，写明随哪个", () => {
    setLang("zh");
    const html = renderToStaticMarkup(
      <ModelScope scope="some" entries={["DeepSeek-v4.1-flash"]} catalog={ALIASED} onScope={noop} onEntries={noop} />,
    );
    const alias = rowOf(html, "deepseek-v4.1");
    expect(alias).toContain(">别名<");
    expect(alias).toContain("随 DeepSeek-v4.1-flash 放行");
    expect(alias).toMatch(/aria-checked="true"/);
    expect(alias).toMatch(/disabled=""|data-disabled/);
    // 那个模型自己是单独选中的，能取消
    const model = rowOf(html, "DeepSeek-v4.1-flash");
    expect(model).toContain("单独选中");
    expect(model).not.toContain(">别名<");
    expect(model).not.toMatch(/disabled=""|data-disabled/);
    // 表格下面说明这条规矩
    expect(html).toContain("范围里有某个上游模型，指向它的别名也一起可见；只选别名，原来的名称不可见。");
    expect(html).toContain("可见 2 / 共 3");
  });

  it("只选别名，它的模型不勾", () => {
    setLang("zh");
    const html = renderToStaticMarkup(
      <ModelScope scope="some" entries={["deepseek-v4.1"]} catalog={ALIASED} onScope={noop} onEntries={noop} />,
    );
    expect(rowOf(html, "deepseek-v4.1")).toContain("单独选中");
    expect(rowOf(html, "DeepSeek-v4.1-flash")).toMatch(/aria-checked="false"/);
    expect(html).toContain("可见 1 / 共 3");
  });

  it("目录里没有别名时不写那句说明", () => {
    setLang("zh");
    const html = renderToStaticMarkup(
      <ModelScope
        scope="some"
        entries={["glm-*"]}
        catalog={[{ id: "glm-4.6", providers: ["zai"] }]}
        onScope={noop}
        onEntries={noop}
      />,
    );
    expect(html).not.toContain("指向它的别名");
  });
});
