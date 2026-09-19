import { useRef, useState, type PointerEvent } from "react";

/**
 * 拖动把手调整一张列表的顺序。
 *
 * **用指针事件，不用 HTML5 拖放。**Tauri 的窗口默认接管拖放（为了接住从
 * Finder 拖进来的文件），网页里的 `dragstart` / `drop` 因此时有时无；指针
 * 事件不受它影响。行上标 `data-reorder-row={i}`，把手上摊 `handle(i)`。
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const from = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  /** 放下时会落到哪个位置之前（等于长度时是末尾） */
  const [target, setTarget] = useState<number | null>(null);

  function locate(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-reorder-row]");
    if (!el) return null;
    const i = Number(el.dataset.reorderRow);
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? i : i + 1;
  }

  function handle(i: number) {
    return {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          // 把后续的移动都交给把手，指针离开它也不丢
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // 指针已经不在了（比如刚按下就被系统取消）：照常开始，松开时会结束
        }
        from.current = i;
        setDragging(i);
        setTarget(null);
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        if (from.current == null) return;
        setTarget(locate(e));
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const start = from.current;
        from.current = null;
        setDragging(null);
        setTarget(null);
        if (start == null) return;
        const to = locate(e);
        if (to == null) return;
        // 落在自己前后等于没动；往后挪时，拿走自己之后下标要减一
        const dest = to > start ? to - 1 : to;
        if (dest !== start) onMove(start, dest);
      },
      onPointerCancel: () => {
        from.current = null;
        setDragging(null);
        setTarget(null);
      },
      style: { cursor: dragging === i ? "grabbing" : "grab", touchAction: "none" as const },
    };
  }

  /** 这一行要不要画插入线：`before` 画在它上沿，`after` 画在它下沿（只有最后一行用） */
  function marker(i: number, count: number): "before" | "after" | null {
    if (dragging == null || target == null) return null;
    if (target === dragging || target === dragging + 1) return null;
    if (target === i) return "before";
    if (i === count - 1 && target === count) return "after";
    return null;
  }

  return { handle, dragging, marker };
}
