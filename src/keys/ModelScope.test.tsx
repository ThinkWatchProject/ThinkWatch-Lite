import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelScope } from "./ModelScope";

const noop = () => {};

describe("可见模型：指定范围", () => {
  it("模型目录是空的时候，手填的模型 ID 照样列出来，可以取消", () => {
    // 规则框里填的 `gpt-5`（没有 `*`）是单独选中的一条。以前目录一空这张表就不画：
    // 规则那一栏只列带 `*` 的，它哪儿都不出现，也就删不掉
    const html = renderToStaticMarkup(
      <ModelScope scope="some" entries={["claude-*", "gpt-5"]} catalog={[]} onScope={noop} onEntries={noop} />,
    );
    expect(html).toContain("尚未获取到任何上游的模型清单");
    expect(html).toMatch(/<td[^>]*>gpt-5<\/td>/);
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
