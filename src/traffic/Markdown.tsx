import { memo, useMemo, type ReactNode } from "react";
import { lexer, type Token, type Tokens } from "marked";
import { cn } from "@/lib/utils";
import { useMarker } from "@/security/Highlight";

/**
 * 模型写的 Markdown 排出来：标题、粗体、列表、表格、代码块。`marked` 只用来切出语法树，画成
 * React 元素，**不经过 HTML**：模型写的 `<script>`、`<img>` 原样显示成字，不会被网页执行或去拉图。
 *
 * - 叶子上的字都过一遍 `useMarker`，安全命中照样标出来（跨了粗体等格式的命中只在折叠行上有点）
 * - 单个换行就是换行（`breaks`）：模型的回答按行写，不该并成一段
 * - 链接只显示文字、悬停看地址，不能点：点了会把应用的窗口导航走；图片只显示替代文字
 * - 顶层每一块按原文 `memo`：回答在长时只有最后一块重画
 */
export function Markdown({ text, tail }: { text: string; tail?: ReactNode }) {
  const blocks = useMemo(() => lexer(text, { gfm: true, breaks: true }).filter((b) => b.type !== "space"), [text]);
  return (
    <div className="flex flex-col gap-2 wrap-break-word">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        return <Block key={i} token={b} raw={b.raw} tail={last ? tail : undefined} />;
      })}
      {blocks.length === 0 && tail}
    </div>
  );
}

/** `raw` 单独传：`memo` 比的是它，同一段原文切出来的对象每次都是新的 */
const Block = memo(
  function Block({ token, tail }: { token: Token; raw: string; tail?: ReactNode }) {
    return <BlockToken t={token} tail={tail} />;
  },
  (a, b) => a.raw === b.raw && a.tail === b.tail,
);

/** 字可以跟在末尾的块（段落、标题）把 `tail`（光标、省略号）接在行尾，其余的另起一行 */
function BlockToken({ t, tail }: { t: Token; tail?: ReactNode }) {
  const own = <BlockBody t={t} tail={tail} />;
  return t.type === "paragraph" || t.type === "heading" || t.type === "text" ? (
    own
  ) : (
    <>
      {own}
      {tail}
    </>
  );
}

function BlockBody({ t, tail }: { t: Token; tail?: ReactNode }) {
  const mark = useMarker();
  const tok = t as Tokens.Generic;
  switch (t.type) {
    case "paragraph":
      return (
        <p>
          <Inline tokens={tok.tokens} />
          {tail}
        </p>
      );
    case "text":
      // 紧凑列表项里的字：不包段落
      return (
        <span>
          {tok.tokens ? <Inline tokens={tok.tokens} /> : mark(tok.text)}
          {tail}
        </span>
      );
    case "heading":
      return (
        <p className={cn("font-semibold text-foreground", tok.depth === 1 ? "tw-title" : "tw-head")}>
          <Inline tokens={tok.tokens} />
          {tail}
        </p>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border border-border bg-surface px-2.5 py-2 font-mono tw-label leading-relaxed whitespace-pre text-foreground">
          {mark((t as Tokens.Code).text)}
        </pre>
      );
    case "blockquote":
      return (
        <div className="flex flex-col gap-2 border-l-2 border-border pl-3 text-muted-foreground">
          <Blocks tokens={(t as Tokens.Blockquote).tokens} />
        </div>
      );
    case "list":
      return <List t={t as Tokens.List} />;
    case "table":
      return <Table t={t as Tokens.Table} />;
    case "hr":
      return <hr className="border-border" />;
    case "html":
    case "def":
    default:
      // 模型写的 HTML、认不出的块：原样的字
      return <p className="whitespace-pre-wrap">{mark(t.raw.replace(/\n+$/, ""))}</p>;
  }
}

function Blocks({ tokens }: { tokens: Token[] }) {
  return tokens.filter((b) => b.type !== "space").map((b, i) => <BlockToken key={i} t={b} />);
}

function List({ t }: { t: Tokens.List }) {
  const Tag = t.ordered ? "ol" : "ul";
  return (
    <Tag
      start={t.ordered && t.start !== "" && t.start !== 1 ? Number(t.start) : undefined}
      className={cn(
        "flex flex-col pl-5 marker:text-muted-foreground",
        t.ordered ? "list-decimal" : "list-disc [&_ul]:list-[circle]",
        t.loose ? "gap-2" : "gap-0.5",
      )}
    >
      {t.items.map((item, i) => (
        <li key={i} className={cn("pl-0.5", item.task && "list-none -ml-5")}>
          <div className="flex flex-col gap-1">
            <ItemBody item={item} />
          </div>
        </li>
      ))}
    </Tag>
  );
}

/** 任务项（`- [x]`）：一个勾或一个空框代替圆点，不能点 */
function ItemBody({ item }: { item: Tokens.ListItem }) {
  const tokens = item.tokens.filter((b) => b.type !== "checkbox" && b.type !== "space");
  if (!item.task) return <Blocks tokens={tokens} />;
  return (
    <div className="flex gap-1.5">
      <span aria-hidden className="w-3.5 shrink-0 text-muted-foreground">
        {item.checked ? "☑" : "☐"}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <Blocks tokens={tokens} />
      </div>
    </div>
  );
}

const ALIGN = { left: "text-left", center: "text-center", right: "text-right" } as const;

function Table({ t }: { t: Tokens.Table }) {
  const cell = (c: Tokens.TableCell, i: number, head: boolean) => {
    const Tag = head ? "th" : "td";
    return (
      <Tag
        key={i}
        className={cn(
          "border border-border px-2 py-1 align-top",
          head && "bg-surface font-medium",
          c.align ? ALIGN[c.align] : "text-left",
        )}
      >
        <Inline tokens={c.tokens} />
      </Tag>
    );
  };
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="border-collapse">
        <thead>
          <tr>{t.header.map((c, i) => cell(c, i, true))}</tr>
        </thead>
        <tbody>
          {t.rows.map((row, r) => (
            <tr key={r}>{row.map((c, i) => cell(c, i, false))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Inline({ tokens }: { tokens: Token[] | undefined }) {
  if (!tokens) return null;
  return tokens.map((t, i) => <InlineToken key={i} t={t} />);
}

function InlineToken({ t }: { t: Token }) {
  const mark = useMarker();
  const tok = t as Tokens.Generic;
  switch (t.type) {
    case "text":
      return tok.tokens ? <Inline tokens={tok.tokens} /> : mark(tok.text);
    case "escape":
      return mark(tok.text);
    case "strong":
      return (
        <strong className="font-semibold">
          <Inline tokens={tok.tokens} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inline tokens={tok.tokens} />
        </em>
      );
    case "del":
      return (
        <del className="text-muted-foreground">
          <Inline tokens={tok.tokens} />
        </del>
      );
    case "codespan":
      return (
        <code className="rounded bg-surface px-1 font-mono text-[0.92em] wrap-anywhere">{mark(tok.text)}</code>
      );
    case "br":
      return <br />;
    case "link": {
      const l = t as Tokens.Link;
      return (
        <span title={l.href} className="underline decoration-muted-foreground/50 underline-offset-2">
          <Inline tokens={l.tokens} />
        </span>
      );
    }
    case "image": {
      const img = t as Tokens.Image;
      return (
        <span title={img.href} className="text-muted-foreground">
          {mark(img.text ? `[${img.text}]` : t.raw)}
        </span>
      );
    }
    default:
      // 行内的 HTML 标签和认不出的：原样的字
      return mark(t.raw);
  }
}
