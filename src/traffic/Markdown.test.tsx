import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HitNeedles } from "@/security/Highlight";
import { Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("排出粗体、列表、表格和代码块", () => {
    const out = html("共 **499 个**文件：\n\n- 业务代码\n- 测试代码\n\n| a | b |\n|-|-:|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```");
    expect(out).toContain("<strong");
    expect(out).toContain(">499 个</strong>");
    expect(out).toMatch(/<ul[^>]*><li[^>]*><div[^>]*><span>业务代码<\/span>/);
    expect(out).toContain("<table");
    expect(out).toMatch(/<td class="[^"]*text-right[^"]*">2<\/td>/);
    expect(out).toContain("const a = 1;</pre>");
    expect(out).not.toContain("**");
  });

  it("单个换行就是换行", () => {
    expect(html("第一行\n第二行")).toBe(`<div class="flex flex-col gap-2 wrap-break-word"><p>第一行<br/>第二行</p></div>`);
  });

  it("模型写的 HTML 原样显示成字，不变成元素", () => {
    const out = html('<script>alert(1)</script>\n\n文字 <img src="https://x/y.png"> ![图](https://x/z.png)');
    expect(out).not.toMatch(/<script|<img/);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;img src=");
  });

  it("链接只显示文字，不是能点的链接", () => {
    const out = html("[文档](https://example.com/a) 和 https://example.com/b");
    expect(out).not.toContain("<a ");
    expect(out).toContain('title="https://example.com/a"');
  });

  it("安全命中在格式里照样标出来", () => {
    const out = renderToStaticMarkup(
      <HitNeedles.Provider value={[{ text: "sk-secret", tone: "bad" }]}>
        <Markdown text={"密钥 **sk-secret** 和 `sk-secret`"} />
      </HitNeedles.Provider>,
    );
    expect(out.match(/<mark/g)).toHaveLength(2);
  });

  it("尾巴接在最后一段的行尾", () => {
    const out = renderToStaticMarkup(<Markdown text={"- a\n\n结尾"} tail={<i>|</i>} />);
    expect(out).toContain("<p>结尾<i>|</i></p>");
  });
});
