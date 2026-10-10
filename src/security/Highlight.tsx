import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";
import type { SecurityEventView, SecurityOutcome } from "@/types";

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
export const TONE: Record<Mark["tone"], string> = {
  warn: "rounded-[3px] bg-warning/25 text-foreground shadow-[inset_0_-1.5px_0_0_var(--warning)] box-decoration-clone",
  bad: "rounded-[3px] bg-destructive/20 text-foreground shadow-[inset_0_-1.5px_0_0_var(--destructive)] box-decoration-clone",
  strip:
    "rounded-[3px] bg-destructive/10 text-muted-foreground line-through decoration-destructive/70 shadow-[inset_0_-1.5px_0_0_color-mix(in_oklab,var(--destructive)_60%,transparent)] box-decoration-clone",
};

/** 命中那一段的底色：会被切断、拒绝的红，会被删除的划掉，其余（替换、只记录）琥珀 */
export function toneOf(action: SecurityOutcome): Mark["tone"] {
  return action === "cut" || action === "blocked" ? "bad" : action === "stripped" ? "strip" : "warn";
}

/** 要在报文里标出来的一段字，和它的底色 */
export interface Needle {
  text: string;
  tone: Mark["tone"];
}

/** 一处命中是画出来的码位（`‹U+E0049 ×74›`），报文里没有这几个字 */
const DRAWN = /‹U\+[0-9A-F]{4,6}(?: ×\d+)?›/;

const SEVERITY: Record<Mark["tone"], number> = { warn: 0, strip: 1, bad: 2 };

/**
 * 一条请求的安全命中，在报文里认得出的那几段字。
 *
 * - **每一处命中的那一段**（`locations[].matched`）。core 给的已经脱敏过，和存下的报文是同一套
 *   打码，报文里写着的就是它
 * - **替换掉的凭据的占位符**：拦截档下存下的请求里、发给上游的请求里，凭据的位置写的是占位符
 * - **原始报文里是 JSON**：带引号、反斜杠、换行的那一段在报文里是转义过的，转义的写法也认
 *
 * 画出码位的那种（码位规则的命中）报文里没有那几个字，不标。同一段字几条命中都有的，按最重的
 * 处置上色。长的在前：一段是另一段的一部分时，标长的那一段
 */
export function needlesOf(events: readonly SecurityEventView[] | undefined): Needle[] {
  const tone = new Map<string, Mark["tone"]>();
  const add = (text: string, t: Mark["tone"]) => {
    if (text.trim().length < 2 || DRAWN.test(text)) return;
    for (const v of new Set([text, JSON.stringify(text).slice(1, -1)])) {
      const was = tone.get(v);
      if (was === undefined || SEVERITY[t] > SEVERITY[was]) tone.set(v, t);
    }
  };
  for (const d of events ?? []) {
    const t = toneOf(d.outcome_detail.action);
    for (const l of d.locations) add(l.matched, t);
    if (d.outcome_detail.action === "replaced") for (const p of d.outcome_detail.placeholders) add(p, t);
  }
  return [...tone].map(([text, t]) => ({ text, tone: t })).sort((a, b) => b.text.length - a.text.length);
}

/**
 * 请求详情「内容」里要标出来的字（`needlesOf`）。给了的地方，报文和对话里的正文按它标出命中；
 * 没给是空的，什么都不标
 */
export const HitNeedles = createContext<readonly Needle[]>([]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 按 `HitNeedles` 标字的函数：一段字进去，命中的几段包上底色出来。没有要标的时候原样返回，
 * 一个字都不多切
 */
export function useMarker(): (text: string) => ReactNode {
  const needles = useContext(HitNeedles);
  return useMemo(() => {
    if (needles.length === 0) return (text: string) => text;
    const tone = new Map(needles.map((n) => [n.text, n.tone]));
    const re = new RegExp(needles.map((n) => escape(n.text)).join("|"), "g");
    return (text: string) => {
      re.lastIndex = 0;
      if (!re.test(text)) return text;
      const parts: ReactNode[] = [];
      let at = 0;
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        if (m.index > at) parts.push(text.slice(at, m.index));
        parts.push(
          <mark key={m.index} className={TONE[tone.get(m[0]) ?? "warn"]}>
            {m[0]}
          </mark>,
        );
        at = m.index + m[0].length;
      }
      if (at < text.length) parts.push(text.slice(at));
      return parts;
    };
  }, [needles]);
}

/**
 * 一段收起的内容里有没有命中：有的话是其中最重的那种底色，没有是 `null`。收起的那一行据此带一个
 * 点，命中不会藏在折叠里没人看见。不是字的（一组消息）按 JSON 找，只在有要标的字时才转
 */
export function useHitTone(source: unknown): Mark["tone"] | null {
  const needles = useContext(HitNeedles);
  return useMemo(() => {
    if (needles.length === 0 || source == null) return null;
    const text = typeof source === "string" ? source : JSON.stringify(source);
    let best: Mark["tone"] | null = null;
    for (const n of needles) if (text.includes(n.text) && (best === null || SEVERITY[n.tone] > SEVERITY[best])) best = n.tone;
    return best;
  }, [source, needles]);
}

/**
 * 一个自己滚的框（原始报文那几框）里第一次画出命中时，把第一处滚到框的上三分之一。只滚这个框，
 * 不动外面的页面；滚过一次就不再管，用户自己往哪儿滚都行。`enabled` 为假（回答正在长、跟着最新）
 * 时不滚
 */
export function useScrollToFirstHit(box: RefObject<HTMLElement | null>, enabled = true) {
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || done.current || !enabled) return;
    const m = el.querySelector("mark");
    if (!m) return;
    done.current = true;
    const top = m.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  });
}

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
export function Highlight({
  text,
  marks,
  small = false,
}: {
  text: string;
  marks: Mark[];
  /** 小一号（`tw-label`），和请求详情里的报文同一个字号。规则测试里是正文字号 */
  small?: boolean;
}) {
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
    <div className={cn("font-mono leading-relaxed break-all whitespace-pre-wrap", small ? "tw-label" : "tw-body")}>
      {parts}
    </div>
  );
}

/** 第几行。**从 1 数**，和编辑器的行号一致 */
export function lineOf(text: string, at: number): number {
  let n = 1;
  for (let i = 0; i < at && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}
