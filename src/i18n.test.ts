import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { getLang, messages, setLang, textOf } from "./i18n";

describe("界面语言", () => {
  const m = messages(
    { title: "用量概览", failed: (n: number) => `${n} 次失败` },
    { title: "Usage", failed: (n: number) => `${n} failed` },
  );

  it("按当前语言取文案，换了语言立刻换", () => {
    setLang("zh");
    expect(textOf(m).title).toBe("用量概览");
    expect(textOf(m).failed(3)).toBe("3 次失败");
    setLang("en");
    expect(getLang()).toBe("en");
    expect(textOf(m).failed(3)).toBe("3 failed");
    setLang("zh");
  });
});

/**
 * **界面上的字只能写在 `*.i18n.ts(x)` 里。**
 *
 * 直接写进组件的中文，换到英文界面时就是一句漏翻 —— 而且没有东西会告诉
 * 你，直到有人正好看见那一屏。这里用 TypeScript 自己的语法树找字符串和
 * JSX 文本，注释不算（注释是写给开发者的，照样用中文）。
 */
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/;

/**
 * 还没迁到词表里的文件。**只减不增**：迁完一个就从这里删掉，下面有一条
 * 检查会在「已经迁完却还留在清单上」时报错。新文件一律不许进这个清单。
 */
const PENDING = new Set<string>([
  "src/App.tsx",
  "src/Clients.tsx",
  "src/Config.tsx",
  "src/ConfigDialogs.tsx",
  "src/ConfigText.tsx",
  "src/Connect.tsx",
  "src/Dashboard.tsx",
  "src/format.ts",
  "src/Guard.tsx",
  "src/keys/KeyDialog.tsx",
  "src/keys/KeysPage.tsx",
  "src/keys/KeysTable.tsx",
  "src/keys/labels.ts",
  "src/keys/RotateDialog.tsx",
  "src/labels.ts",
  "src/Notices.tsx",
  "src/NoticeSettings.tsx",
  "src/RequestDrawer.tsx",
  "src/routing/DryRunDialog.tsx",
  "src/routing/fields.tsx",
  "src/routing/GroupDialog.tsx",
  "src/routing/GroupTable.tsx",
  "src/routing/model.ts",
  "src/routing/RouteConfirmDialogs.tsx",
  "src/routing/RouteDialog.tsx",
  "src/routing/RouteTable.tsx",
  "src/routing/RoutingPage.tsx",
  "src/routing/RuleDialog.tsx",
  "src/Security.tsx",
  "src/Sessions.tsx",
  "src/triggers.ts",
  "src/ui/charts.tsx",
  "src/ui/dialog.tsx",
  "src/ui/range.tsx",
  "src/ui/sheet.tsx",
  "src/Update.tsx",
  "src/updateFlow.ts",
  "src/UpdateWindow.tsx",
  "src/upstreams/BillingSection.tsx",
  "src/upstreams/ChatgptAccountSection.tsx",
  "src/upstreams/ChatgptLoginDialog.tsx",
  "src/upstreams/ConnectionSection.tsx",
  "src/upstreams/DeleteDialog.tsx",
  "src/upstreams/HeaderEditor.tsx",
  "src/upstreams/labels.ts",
  "src/upstreams/ModelsPanel.tsx",
  "src/upstreams/ModelsSection.tsx",
  "src/upstreams/presets.ts",
  "src/upstreams/PriceSheetDialog.tsx",
  "src/upstreams/PriceSheetTable.tsx",
  "src/upstreams/ProxyDialog.tsx",
  "src/upstreams/ProxyTable.tsx",
  "src/upstreams/SecuritySection.tsx",
  "src/upstreams/TestDialogs.tsx",
  "src/upstreams/UpstreamDialog.tsx",
  "src/upstreams/upstreamForm.ts",
  "src/upstreams/UpstreamsPage.tsx",
  "src/upstreams/UpstreamTable.tsx",
  "src/useLive.ts",
  "src/useRequests.ts",
]);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 词表、语言模块本身、测试：这些地方本来就该有中文 */
function exempt(path: string): boolean {
  return /\.i18n\.tsx?$/.test(path) || path.startsWith(join("src", "i18n")) || /\.test\.tsx?$/.test(path);
}

/** 一个文件里带中文的字符串字面量和 JSX 文本 */
function chineseLiterals(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n) ||
      ts.isJsxText(n)
    ) {
      if (CJK.test(n.text)) {
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        out.push(`${path}:${line + 1} ${n.text.trim().replace(/\s+/g, " ").slice(0, 40)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("界面文案都在词表里", () => {
  const all = files("src").filter((p) => !exempt(p));

  it("组件和工具函数里不直接写中文", () => {
    const bad = all.filter((p) => !PENDING.has(p)).flatMap(chineseLiterals);
    expect(bad).toEqual([]);
  });

  it("迁完的文件已从待迁清单上删掉", () => {
    const stale = [...PENDING].filter((p) => !all.includes(p) || chineseLiterals(p).length === 0);
    expect(stale).toEqual([]);
  });
});
