import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { setLang, textOf } from "@/i18n";
import { TooltipRoot } from "@/ui/tip";
import type { ManifestView, Overview } from "@/types";

/*
  添加插件：和编辑同一个编辑器（`Editing`），从模板起头。对话框挂在 portal 里、服务端渲染
  画不出来，换成原地画的外壳；适用范围的建议要取数，换成空的。
*/
vi.mock("@/ui/dialog", () => {
  const box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Dialog: box, DialogContent: box, DialogDescription: box, DialogFooter: box, DialogHeader: box, DialogTitle: box };
});
vi.mock("./suggestions", () => ({ useScopeSuggestions: () => ({ clients: [], models: [], upstreams: [] }) }));
vi.mock("@/control", () => ({ call: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const { Editing } = await import("./Editor");
const { editorText } = await import("./Editor.i18n");

const ov = { providers: [], config_version: "v1" } as unknown as Overview;
const noop = () => {};

/** core 读模板读出来的样子（中文那一份） */
function templateManifest(over: Partial<ManifestView> = {}): ManifestView {
  return {
    name: "新插件",
    description: "在系统提示词末尾附加「附加内容」中的文字。",
    permissions: ["system"],
    requests: ["conversation"],
    scope: { clients: [], models: [], upstreams: [] },
    on_error: "reject",
    reply_mode: "block",
    settings_schema: [{ key: "note", kind: "string", label: "附加内容", value: "" }],
    hooks: { request: true, reply_text: false, tool_call: false },
    ...over,
  };
}

function renderNew(taken: string[] = [], manifest = templateManifest()) {
  const source = textOf(editorText).template;
  return renderToStaticMarkup(
    <TooltipRoot>
      <Editing
        target={{ kind: "new", taken }}
        loaded={{ approved: null, approvedManifest: null, start: { source, inspection: { manifest, sha256: "aa", error: null } } }}
        initialTab="code"
        ov={ov}
        native={() => Promise.resolve("done")}
        onState={noop}
        onCancel={noop}
        onDone={noop}
      />
    </TooltipRoot>,
  );
}

describe("添加插件：和编辑同一个编辑器", () => {
  it("先开着「代码」页，可以从文件导入；按钮是「安装」，没有选文件、粘贴和下一步", () => {
    const html = renderNew();
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>代码/);
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*>设置/);
    expect(html).toContain("从文件导入…");
    expect(html).toMatch(/<button[^>]*>安装<\/button>/);
    for (const gone of ["下一步", "选择文件", "粘贴代码", "审核插件", "保存"]) expect(html).not.toContain(gone);
  });

  it("标题栏和「设置」页从代码读出来：名字、权限、设置项；ID 按名字给好，启用关着", () => {
    const html = renderNew();
    expect(html).toContain("新插件");
    expect(html).toContain("系统提示词");
    expect(html).toContain("ID plugin");
    expect(html).toMatch(/id="plugin-new-id"[^>]*value="plugin"/);
    expect(html).toMatch(/id="plugin-enabled-new"[^>]*aria-checked="false"|aria-checked="false"[^>]*id="plugin-enabled-new"/);
    // 设置项的标签照代码里写的；出错时、适用范围和编辑时一样
    expect(html).toContain("附加内容");
    expect(html).toContain("适用范围");
  });

  it("建议的 ID 避开已有的；按代码里的名字给", () => {
    expect(renderNew(["plugin"])).toMatch(/id="plugin-new-id"[^>]*value="plugin-2"/);
    expect(renderNew([], templateManifest({ name: "Mask ticket IDs" }))).toMatch(/id="plugin-new-id"[^>]*value="mask-ticket-ids"/);
  });

  it("英文界面：英文的模板和按钮", () => {
    setLang("en");
    const html = renderNew([], templateManifest({ name: "New plugin" }));
    expect(html).toContain("Import from file…");
    expect(html).toMatch(/<button[^>]*>Install<\/button>/);
    expect(html).toMatch(/id="plugin-new-id"[^>]*value="new-plugin"/);
    setLang("zh");
  });
});

/** 模板里的 manifest 字面量：`export const manifest = ` 后面那一对花括号 */
function literal(src: string): string {
  const open = src.indexOf("{", src.indexOf("export const manifest = "));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("no manifest literal");
}

/** 去掉注释和字符串：两种语言的模板只差在这两样 */
const code = (src: string) => src.replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\s+/g, " ");

describe("插件模板", () => {
  const both = (["zh", "en"] as const).map((lang) => ({ lang, src: editorText[lang].template }));

  it("manifest 是纯数据，写成 core 改写它时的样子，注释在它外面", () => {
    for (const { lang, src } of both) {
      const lit = literal(src);
      expect(lit, lang).not.toMatch(/\/\/|\/\*|\$\{|`/);
      // 两格缩进、一个字段一行；里面的对象和数组放得进 80 列（不算后面的逗号）就写成一行
      for (const line of lit.split("\n").slice(1, -1)) {
        expect(line, lang).toMatch(/^ {2}[a-z_]+: .*,$/);
        if (/: [[{]/.test(line)) expect(line.length - 1, lang).toBeLessThan(80);
      }
      // 照 JSON 读得出来：键加上引号、去掉结尾的逗号
      const m = JSON.parse(lit.replace(/([{,]\s*)([a-z_]+):/g, '$1"$2":').replace(/,(\s*[}\]])/g, "$1"));
      expect(m.api, lang).toBe(1);
      expect(m.permissions, lang).toEqual(["system"]);
      expect(m.on_error, lang).toBe("reject");
      expect(m.settings.note, lang).toMatchObject({ type: "string", value: "" });
      expect(m.name.length, lang).toBeGreaterThan(0);
    }
  });

  it("只有一个请求钩子，用得上申请的权限；两种语言只差在文字", () => {
    for (const { src } of both) {
      expect(src.match(/^export function (\w+)\(/gm)).toEqual(["export function onRequest("]);
      expect(src.endsWith("}\n")).toBe(true);
    }
    expect(code(both[0]!.src)).toBe(code(both[1]!.src));
  });
});
