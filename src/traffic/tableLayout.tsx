import { createContext, useContext, useLayoutEffect, useMemo, useState, type ComponentProps, type CSSProperties, type RefObject } from "react";
import { TableCell } from "@/ui/table";
import type { Columns } from "./columns";
import { NAME_PX, type Col } from "./virtual";
import "./tableLayout.css";

const PAD = 12;
const GUTTER = 20;
export const ACTION_WIDTH = 24;
const FLEX_MIN = { model: 112, client: 68, upstream: 88 };
type Sizes = Partial<Record<Col, number>>;
type Cell = Col | "actions";
export interface ColumnLayout {
  widths: Sizes;
  width: number;
  styles: Partial<Record<Cell, CSSProperties>>;
  pins: Partial<Record<Cell, "left" | "right">>;
  edges?: Partial<Record<Cell, "left" | "right">>;
}

/** 名字列先收缩到可辨认的宽度，数字按真实内容保留；剩下的宽度优先给模型列。 */
export function sizeColumns(columns: Col[], measured: Sizes, available: number, floors: Sizes = {}): { widths: Sizes; width: number } {
  const widths: Sizes = {};
  const minimum: Sizes = {};
  for (const col of columns) {
    const label = measured[col] ?? (col === "status" ? 44 : 80);
    if (col === "model" || col === "client" || col === "upstream") {
      minimum[col] = Math.max(FLEX_MIN[col], floors[col] ?? 0);
      widths[col] = Math.max(minimum[col]!, Math.min(NAME_PX[col] + PAD, label));
    } else widths[col] = label;
  }
  const total = () => ACTION_WIDTH + columns.reduce((sum, col) => sum + widths[col]!, 0);
  const excess = Math.max(0, total() - available);
  // 按各列能让出的空间等比例收缩，不让某一列独自变成几个像素。
  const room = columns.reduce((sum, col) => sum + (minimum[col] ? widths[col]! - minimum[col]! : 0), 0);
  for (const col of columns) {
    if (!minimum[col] || !room) continue;
    const take = Math.min(widths[col]! - minimum[col]!, Math.ceil(excess * (widths[col]! - minimum[col]!) / room));
    widths[col]! -= take;
  }
  const extra = Math.max(0, available - total());
  const stretch = columns.includes("model") ? "model" : columns.find((col) => minimum[col] !== undefined) ?? columns[0];
  if (stretch) widths[stretch]! += extra;
  return { widths, width: Math.ceil(total()) };
}

/** 固定范围过宽时从中间向两边退让，保留设置；换回大窗口自动恢复。 */
export function pinnedColumns(columns: Col[], pinned: Columns["pinned"], widths: Sizes, available: number): Pick<ColumnLayout, "styles" | "pins"> {
  const left = columns.filter((c) => pinned[c] === "left");
  const right = columns.filter((c) => pinned[c] === "right");
  const sum = (cols: Col[]) => cols.reduce((s, c) => s + widths[c]!, 0);
  const budget = Math.max(0, available - ACTION_WIDTH - 96);
  while (sum(left) + sum(right) > budget && (left.length || right.length)) {
    if (sum(left) > sum(right)) left.pop();
    else right.shift();
  }
  const styles: ColumnLayout["styles"] = {};
  const pins: ColumnLayout["pins"] = {};
  let offset = GUTTER;
  for (const col of left) {
    styles[col] = { position: "sticky", left: offset, zIndex: 2 };
    pins[col] = "left";
    offset += widths[col]!;
  }
  if (right.length) {
    styles.actions = { position: "sticky", right: GUTTER, zIndex: 2 };
    pins.actions = "right";
  }
  offset = GUTTER + ACTION_WIDTH;
  for (const col of [...right].reverse()) {
    styles[col] = { position: "sticky", right: offset, zIndex: 2 };
    pins[col] = "right";
    offset += widths[col]!;
  }
  return { styles, pins };
}

const EMPTY: ColumnLayout = { widths: {}, width: 0, styles: {}, pins: {} };
export const TrafficLayout = createContext(EMPTY);
export function columnProps(layout: ColumnLayout, col: Cell) {
  return { "data-column": col, "data-pinned": layout.pins[col], "data-pin-edge": layout.edges?.[col], style: layout.styles[col] };
}
export function TrafficCell({ col, ...props }: ComponentProps<typeof TableCell> & { col: Cell }) {
  return <TableCell {...props} {...columnProps(useContext(TrafficLayout), col)} />;
}

/** 只测表头里稳定的样本，不随虚拟滚动量表体；字体与窗口变化都重新计算。 */
export function useColumnLayout(table: RefObject<HTMLTableElement | null>, scroller: RefObject<HTMLElement | null>, columns: Col[], pinned: Columns["pinned"], samples: unknown) {
  const [metrics, setMetrics] = useState<{ measured: Sizes; floors: Sizes; available: number }>({ measured: {}, floors: {}, available: 720 });
  useLayoutEffect(() => {
    const el = table.current, scroll = scroller.current;
    if (!el || !scroll) return;
    const measure = () => {
      if (!scroll.clientWidth) return;
      const measured: Sizes = {};
      const floors: Sizes = {};
      for (const col of columns) {
        const header = el.querySelector<HTMLElement>(`thead [data-column="${col}"]`);
        if (!header) continue;
        const samples = header.querySelectorAll<HTMLElement>("[data-column-label], [data-column-measure] > div");
        measured[col] = Math.ceil(Math.max(0, ...Array.from(samples, (s) => s.getBoundingClientRect().width)) + PAD);
        if (col === "upstream") {
          // 名字能省略；安全和转换徽标只能在徽标之间换行，不能截掉警告或次数。
          const badges = header.querySelectorAll<HTMLElement>("[data-column-measure] [data-slot=badge]");
          floors[col] = Math.ceil(Math.max(0, ...Array.from(badges, (b) => b.getBoundingClientRect().width)) + PAD);
        }
      }
      const available = Math.max(0, scroll.clientWidth - GUTTER * 2);
      setMetrics((prev) => prev.available === available && columns.every((c) => prev.measured[c] === measured[c] && prev.floors[c] === floors[c]) ? prev : { measured, floors, available });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    el.querySelectorAll<HTMLElement>("[data-column-label], [data-column-measure] > div").forEach((s) => observer.observe(s));
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; observer.disconnect(); };
  }, [table, scroller, columns, samples]);
  return useMemo(() => {
    const sized = sizeColumns(columns, metrics.measured, metrics.available, metrics.floors);
    const fixed = pinnedColumns(columns, pinned, sized.widths, metrics.available);
    const edges: ColumnLayout["edges"] = {};
    if (sized.width > metrics.available) {
      const left = columns.filter((c) => fixed.pins[c] === "left").at(-1);
      const right = columns.find((c) => fixed.pins[c] === "right");
      if (left) edges[left] = "left";
      if (right) edges[right] = "right";
    }
    return { ...sized, ...fixed, edges };
  }, [columns, pinned, metrics]);
}
