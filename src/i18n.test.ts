import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
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
 * 还没迁到词表里的文件。**现在是空的 —— 全都迁完了。**清单留着当守卫：
 * 新写的文件一律不许进来，下面第一条检查就是那道门。
 */
const PENDING = new Set<string>([]);

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

/**
 * **词表里没有用不到的句子。**
 *
 * 界面改版时删掉一处文字，词表里那一条常常留着：没有东西会报错，词表越积越多，翻译的人
 * 还在改一句早就没人看得见的话（审查时一次查出过十几条）。这里用 TypeScript 的类型检查
 * 找每一条有没有被读到 —— 按名字搜不行，`title`、`all` 这种名字到处都是。
 *
 * 一条算用到了：
 *
 * · `t.title`、`t.title[guard]["edit"]`、解构 `const { title } = t`：类型检查认得出是哪一条；
 * · 按变量取（`t.kinds[kind]`）：变量是几个固定的字（`"a" | "b"`）时只算那几条，是任意
 *   字符串时整组都算；
 * · 一组整个交出去（`Object.entries(t.secrets)`、存进 `Record<string, string>`）：整组都算；
 * · 词表交给一个自己写了形状的参数（`t: { useTable: string }`）：按那个形状里的名字算。
 *
 * 测试文件里用到的不算：只有测试读的句子，界面上照样看不见。
 */
describe("词表里没有用不到的句子", () => {
  it("每一条都有地方用", { timeout: 120_000 }, () => {
    const config = ts.parseJsonConfigFileContent(ts.readConfigFile("tsconfig.json", ts.sys.readFile).config, ts.sys, ".");
    const roots = files("src").filter((p) => !/\.test\.tsx?$/.test(p));
    const program = ts.createProgram(roots, config.options);
    const checker = program.getTypeChecker();
    const sources = program.getSourceFiles().filter((sf) => !sf.isDeclarationFile && !sf.fileName.includes("node_modules"));

    /** 每一条的声明（`messages(…)` 中文那一份里的属性）→ 文件和路径 */
    const entries = new Map<ts.Node, string>();
    /** 值是一组（嵌套对象）的那几条 → 那一组 */
    const groups = new Map<ts.Node, ts.ObjectLiteralExpression>();
    const used = new Set<ts.Node>();
    const collect = (obj: ts.ObjectLiteralExpression, prefix: string) => {
      for (const p of obj.properties) {
        if (!p.name) continue;
        const name = p.name.getText();
        entries.set(p, prefix + name);
        if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) {
          groups.set(p, p.initializer);
          collect(p.initializer, `${prefix}${name}.`);
        }
      }
    };
    for (const sf of sources) {
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "messages") {
          const zh = n.arguments[0];
          if (zh && ts.isObjectLiteralExpression(zh)) collect(zh, `${relative(".", sf.fileName)}: `);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(entries.size).toBeGreaterThan(1000);

    const entriesOf = (sym: ts.Symbol | undefined) => (sym?.declarations ?? []).filter((d) => entries.has(d));
    const markAll = (obj: ts.ObjectLiteralExpression) => {
      for (const p of obj.properties) {
        used.add(p);
        if (ts.isPropertyAssignment(p) && ts.isObjectLiteralExpression(p.initializer)) markAll(p.initializer);
      }
    };
    /** 用到了一条。是一组、又没有接着往下取（整组交出去了）的话，整组都算 */
    const use = (d: ts.Node, at?: ts.Node) => {
      used.add(d);
      const g = groups.get(d);
      if (!g) return;
      const p = at?.parent;
      const chained = p && (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === at;
      if (!chained) markAll(g);
    };
    const parts = (t: ts.Type) => (t.isUnion() ? t.types : [t]);

    for (const sf of sources) {
      const visit = (n: ts.Node) => {
        if (ts.isPropertyAccessExpression(n)) {
          for (const d of entriesOf(checker.getSymbolAtLocation(n.name))) use(d, n);
        } else if (ts.isElementAccessExpression(n)) {
          const obj = checker.getTypeAtLocation(n.expression);
          const keys = parts(checker.getTypeAtLocation(n.argumentExpression));
          const fixed = keys.every((k) => k.isStringLiteral());
          for (const t of parts(obj)) {
            const props = fixed
              ? keys.map((k) => t.getProperty((k as ts.StringLiteralType).value))
              : t.getProperties();
            for (const s of props) for (const d of entriesOf(s)) use(d, n);
          }
        } else if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
          const t = checker.getTypeAtLocation(n.parent);
          for (const d of entriesOf(t.getProperty((n.propertyName ?? n.name).getText()))) use(d);
        }
        // 交给一个形状不同的类型（参数、带类型的变量）：按那个类型里的名字算
        if (ts.isIdentifier(n) || ts.isPropertyAccessExpression(n) || ts.isCallExpression(n)) {
          const ctx = checker.getContextualType(n);
          const type = ctx && checker.getTypeAtLocation(n);
          if (ctx && type && type.getProperties().some((s) => entriesOf(s).length > 0)) {
            const open = ctx.getStringIndexType() !== undefined || (ctx.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
            const names = open ? type.getProperties().map((s) => s.name) : ctx.getProperties().filter((c) => entriesOf(c).length === 0).map((c) => c.name);
            for (const name of names) for (const d of entriesOf(type.getProperty(name))) use(d);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }

    const unused = [...entries].filter(([d]) => !used.has(d)).map(([, path]) => path);
    expect(unused).toEqual([]);
  });
});
