/** 一处要标出来的地方。下标按 UTF-16 码元，和 JavaScript 的字符串下标一致 */
export interface Mark {
  start: number;
  end: number;
  /** `bad`：会被切断；`warn`：会被替换或记录 */
  tone: "warn" | "bad";
}

const TONE: Record<Mark["tone"], string> = {
  warn: "rounded-sm bg-amber-200/80 text-foreground dark:bg-amber-400/30",
  bad: "rounded-sm bg-red-200/80 text-foreground dark:bg-red-500/35",
};

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
        {text.slice(start, end)}
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
