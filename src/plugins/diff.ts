/**
 * 两份文字的逐行对比，按改动成段（hunk）给出来：改动的行带着前后几行原样的，
 * 中间大段没动的收成一行「n 行未改动」。插件代码的更改、试运行的改写前后都用它。
 */
import { diffRows, type DiffRow } from "@/clients/PlanDialog";

/** 改动前后各留几行原样的 */
const CONTEXT = 3;

/**
 * 中间那段的表最多多大。`diffRows` 是 O(n·m) 的 LCS：两千行对两千行是四百万格、
 * 十几 MB，再大窗口就会卡住。插件文件上限 1 MB，整份重写过的大文件超过它时，不逐行配，
 * 直接画成「旧的全删、新的全加」—— 慢一点没关系，卡住不行。
 */
const MAX_CELLS = 4_000_000;

export type Line = DiffRow & {
  /** 改之前的行号（加的行没有） */
  a: number | null;
  /** 改之后的行号（删的行没有） */
  b: number | null;
};

export type Piece = { kind: "lines"; lines: Line[] } | { kind: "skip"; count: number };

/** 逐行对比，带行号 */
export function lineDiff(before: string, after: string): Line[] {
  const rows = tooBig(before, after) ? wholesale(before, after) : diffRows(before, after);
  let a = 0;
  let b = 0;
  return rows.map((r) => {
    if (r.kind === "same") return { ...r, a: ++a, b: ++b };
    if (r.kind === "del") return { ...r, a: ++a, b: null };
    return { ...r, a: null, b: ++b };
  });
}

/** 没动的行少于这么多就照样列出来，不收成一行（收起一两行比列出来还占地方） */
const MIN_SKIP = 3;

/** 按改动成段。一处改动都没有时是空的 */
export function hunks(lines: Line[], context = CONTEXT): Piece[] {
  const changed = lines.map((l) => l.kind !== "same");
  if (!changed.includes(true)) return [];
  const keep = lines.map((_, i) => {
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return false;
  });
  const out: Piece[] = [];
  for (let i = 0; i < lines.length; ) {
    if (keep[i]) {
      const run: Line[] = [];
      while (i < lines.length && keep[i]) run.push(lines[i++]!);
      const prev = out[out.length - 1];
      if (prev?.kind === "lines") prev.lines.push(...run);
      else out.push({ kind: "lines", lines: run });
    } else {
      const from = i;
      while (i < lines.length && !keep[i]) i++;
      const count = i - from;
      if (count >= MIN_SKIP) out.push({ kind: "skip", count });
      else {
        // 太短的照样列出，和前后两段并成一段
        const run = lines.slice(from, i);
        const prev = out[out.length - 1];
        if (prev?.kind === "lines") prev.lines.push(...run);
        else out.push({ kind: "lines", lines: run });
      }
    }
  }
  return out;
}

/** 增删各几行 */
export function tally(lines: Line[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/** 两头相同的行摘掉之后，中间那段的表会不会太大（和 `diffRows` 同样地摘） */
function tooBig(before: string, after: string): boolean {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return (a.length - head - tail) * (b.length - head - tail) > MAX_CELLS;
}

/** 不逐行配：两头相同的照样，中间旧的全删、新的全加 */
function wholesale(before: string, after: string): DiffRow[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return [
    ...a.slice(0, head).map((text) => ({ text, kind: "same" as const })),
    ...a.slice(head, a.length - tail).map((text) => ({ text, kind: "del" as const })),
    ...b.slice(head, b.length - tail).map((text) => ({ text, kind: "add" as const })),
    ...a.slice(a.length - tail).map((text) => ({ text, kind: "same" as const })),
  ];
}
