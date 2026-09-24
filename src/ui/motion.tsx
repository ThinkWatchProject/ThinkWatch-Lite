import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useCountUp } from "@/useCountUp";

/**
 * 动效工具。**CSS 优先**：进场、换页、换标签、新行、条形、脉冲都是 `index.css`
 * 里的 `motion-*` 类（见 src/ui/README.md 的「Motion」一节）。这里只放 CSS
 * 一个人做不到的三件事：
 *
 * · `Reveal`：出现和消失都要动画的一块（横幅、行内提示）。消失时要先留在
 *   DOM 里把动画放完再卸掉，而 React 一卸就没了。
 * · `usePresentList`：列表里被删掉的那一行先淡出再消失，新来的那一行滑进来。
 * · `AnimatedNumber`：数字走到新值，不跳。
 *
 * 没有引入 `motion`（framer-motion）：要的只是进出场和计数，几十行就够，
 * 不值得一个 60KB 的依赖和第二套动画写法。
 */

/** 系统里关掉了动效 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 出场动画的时长，和 `--motion-base` 同一个数 */
const EXIT_MS = 200;

/**
 * 出现时展开、淡入，消失时收起、淡出的一块。
 *
 * 高度用 `grid-template-rows: 0fr ↔ 1fr` 过渡，不量高度：内容换行、窗口变窄
 * 都不用重算。旧版 WebKit 不支持这个过渡时退化为直接出现和消失。
 *
 *   <Reveal show={rejected !== null}>
 *     <Banner tone="warning" title={t.rejectedTitle}>…</Banner>
 *   </Reveal>
 */
export function Reveal({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(show);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  /** 出场时还要画的那份内容。**不用新的 children**：调用方这时往往已经传 null 了 */
  const last = useRef(children);
  if (show) last.current = children;

  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    setOpen(false);
    const h = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(h);
  }, [show]);

  // 进场：先按收起的样子排一次版，再切到展开，过渡才有起点
  useLayoutEffect(() => {
    if (!mounted || !show || open) return;
    ref.current?.getBoundingClientRect();
    setOpen(true);
  }, [mounted, show, open]);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      data-slot="reveal"
      data-state={open ? "open" : "closed"}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-(--motion-base) ease-(--motion-ease) motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{show ? children : last.current}</div>
    </div>
  );
}

/** `usePresentList` 给每一项的状态 */
export type Presence = "enter" | "idle" | "exit";

type Key = string | number;
type Present<T> = { item: T; key: Key; presence: Presence };

/** 新行的进场动画多长，和 `motion-row-in` 同一个数 */
const ENTER_MS = 900;

/**
 * 列表的进出场。把要画的列表交给它，拿回来的列表里：
 *
 * · 第一次有数据时就在的项是 `idle`（开页、读完第一批不闪一整屏）；
 * · 之后新出现的项在 `ENTER_MS` 内是 `enter` —— 行上挂 `motion-row-in`；
 * · 刚被删掉的项还留在原来的位置上，状态 `exit` —— 行上挂 `motion-row-out`，
 *   `EXIT_MS` 之后才真正消失。
 *
 *   const shown = usePresentList(keys, (k) => k.name);
 *   shown.map(({ item, key, presence }) => (
 *     <TableRow key={key} className={rowMotion(presence)}>…</TableRow>
 *   ))
 */
export function usePresentList<T>(items: readonly T[], keyOf: (item: T) => Key): Present<T>[] {
  /** 每个键第一次出现的时刻。第一批是 -Infinity：不算「新来的」 */
  const born = useRef(new Map<Key, number>());
  /** 正在淡出的项，和开始淡出的时刻 */
  const dying = useRef(new Map<Key, { entry: Present<T>; at: number }>());
  /** 上一次画出来的（含正在淡出的），用来给淡出的项找回原来的位置 */
  const prev = useRef<Present<T>[]>([]);
  const [tick, setTick] = useState(0);
  const now = performance.now();
  const calm = prefersReducedMotion();

  const keys = new Set<Key>();
  const initial = prev.current.length === 0;
  for (const item of items) {
    const k = keyOf(item);
    keys.add(k);
    if (!born.current.has(k)) born.current.set(k, initial ? -Infinity : now);
    dying.current.delete(k);
  }
  for (const p of prev.current) {
    if (!keys.has(p.key) && !dying.current.has(p.key) && p.presence !== "exit" && !calm) {
      dying.current.set(p.key, { entry: { ...p, presence: "exit" }, at: now });
    }
    if (!keys.has(p.key)) born.current.delete(p.key);
  }
  for (const [k, d] of dying.current) if (now - d.at >= EXIT_MS) dying.current.delete(k);

  const fresh: Present<T>[] = items.map((item) => {
    const key = keyOf(item);
    const b = born.current.get(key) ?? -Infinity;
    return { item, key, presence: !calm && now - b < ENTER_MS ? "enter" : "idle" };
  });
  // 淡出的项插回它在上一次列表里前一项的后面
  const out: Present<T>[] = [];
  let i = 0;
  for (const p of prev.current) {
    if (keys.has(p.key)) {
      while (i < fresh.length && fresh[i]!.key !== p.key) out.push(fresh[i++]!);
      if (i < fresh.length) out.push(fresh[i++]!);
    } else {
      const d = dying.current.get(p.key);
      if (d) out.push(d.entry);
    }
  }
  while (i < fresh.length) out.push(fresh[i++]!);
  prev.current = out;

  // 有项在淡出、或者在进场：到点再画一次，把它们收掉或者转成 idle
  const pending = dying.current.size > 0 || out.some((p) => p.presence === "enter");
  useEffect(() => {
    if (!pending) return;
    const h = setTimeout(() => setTick((n) => n + 1), EXIT_MS);
    return () => clearTimeout(h);
  }, [pending, tick]);

  return out;
}

/** 行上该挂的动效类 */
export function rowMotion(p: Presence): string | undefined {
  return p === "enter" ? "motion-row-in" : p === "exit" ? "motion-row-out" : undefined;
}

/**
 * 走到新值的数字。等宽数字，格式由调用方给（金额、token、次数各有各的写法）。
 *
 * `scope`：数字的口径（时间范围、筛选条件）。**口径一变直接落到新值**，不从旧值
 * 滚过去 —— 换了口径不是「涨了」。见 `useCountUp`。
 *
 *   <AnimatedNumber value={sum.cost_micros} format={fmtCost} scope={range} />
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  scope = "",
  className,
}: {
  value: number;
  format?: (n: number) => ReactNode;
  scope?: string;
  className?: string;
}) {
  const shown = useCountUp(value, scope);
  return <span className={cn("tw-num", className)}>{format(shown)}</span>;
}
