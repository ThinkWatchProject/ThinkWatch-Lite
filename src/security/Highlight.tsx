/** 一处要标出来的地方。下标按 UTF-16 码元，和 JavaScript 的字符串下标一致 */
export interface Mark {
  start: number;
  end: number;
  /** `bad`：会被切断、拒绝；`strip`：会被删掉；`warn`：会被替换或只记录 */
  tone: "warn" | "bad" | "strip";
}

/**
 * 标记的底色：状态色压到低透明度，底边一道实色 —— 不加内边距（等宽字里一格
 * 内边距会把后面的字全推歪），跨行时每一行各自带着底色和底边。会被删掉的那几处
 * 再划一道线：删掉之后发出去的样子里没有它们。
 */
const TONE: Record<Mark["tone"], string> = {
  warn: "rounded-[3px] bg-warning/25 text-foreground shadow-[inset_0_-1.5px_0_0_var(--warning)] box-decoration-clone",
  bad: "rounded-[3px] bg-destructive/20 text-foreground shadow-[inset_0_-1.5px_0_0_var(--destructive)] box-decoration-clone",
  strip:
    "rounded-[3px] bg-destructive/10 text-muted-foreground line-through decoration-destructive/70 shadow-[inset_0_-1.5px_0_0_color-mix(in_oklab,var(--destructive)_60%,transparent)] box-decoration-clone",
};

/**
 * 看不见的字符：Unicode 说默认不显示的那些（零宽、双向控制、标签字符、变体选择符…），
 * 以及私用区（没有标准字形，多数字体里是空白）
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Co}]/u;

const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, "0");

/**
 * 标出来的那一段里，**看不见的字符画成码位**：一个画成 `‹U+200B›`，连成一串的写第一个的
 * 码位和一共几个（`‹U+E0049 ×12›`），和 core 给的片段同一种写法。不画的话，命中了码位
 * 规则的那一处是一块空的底色 —— 正是要找的东西看不见。没标出来的字照原样。
 */
export function drawInvisible(text: string): string {
  let out = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length > 0) out += `‹U+${hex(run[0]!)}${run.length > 1 ? ` ×${run.length}` : ""}›`;
    run = [];
  };
  for (const ch of text) {
    if (INVISIBLE.test(ch)) run.push(ch.codePointAt(0)!);
    else {
      flush();
      out += ch;
    }
  }
  flush();
  return out;
}

/**
 * 一段测试文本，命中的地方标出来。
 *
 * **下标是 core 算的**，按 UTF-16 码元给 —— 这边照着切，不再自己找一遍：
 * 界面再跑一次正则的话，JavaScript 和 Rust 的正则方言不完全一样，标出来的
 * 位置就可能和网关真正命中的不是同一处。
 *
 * 几处重叠时按先后合并，后一处只标没被前一处盖住的那部分。
 */
export function Highlight({ text, marks }: { text: string; marks: Mark[] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    const start = Math.max(m.start, at);
    const end = Math.min(m.end, text.length);
    if (end <= start) continue;
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className={TONE[m.tone]}>
        {drawInvisible(text.slice(start, end))}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <div className="font-mono tw-body leading-relaxed break-all whitespace-pre-wrap">{parts}</div>
  );
}

/** 第几行。**从 1 数**，和编辑器的行号一致 */
export function lineOf(text: string, at: number): number {
  let n = 1;
  for (let i = 0; i < at && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
