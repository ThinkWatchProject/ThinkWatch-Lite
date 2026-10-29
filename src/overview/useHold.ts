import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** 往上找滚动的那一层（页面自己的滚动层，见 shell/Pages.tsx） */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * 换区间之后滚动位置补多少：让 `el` 回到它原来在屏幕上的高度（`was`，视口坐标）。内容变短、
 * 滚不到那么下面时，差的那一截（`short`）要在页尾临时补出来。
 */
export function holdTarget(
  m: { scrollTop: number; scrollHeight: number; clientHeight: number; top: number },
  was: number,
): { scrollTop: number; short: number } {
  const want = m.scrollTop + (m.top - was);
  const max = m.scrollHeight - m.clientHeight;
  return { scrollTop: Math.max(0, want), short: Math.max(0, Math.ceil(want - max)) };
}

/**
 * 在热力图上点了一天：时间范围换成那一天，**热力图留在指针底下。**
 *
 * 换了区间，上面几块的高度可能会变（去向、额度两张卡片按行数撑高），下面的明细表也可能
 * 短一截。新数据画出来之后按热力图移动的距离把滚动位置补回去；页面短了、补不回
 * 时在页尾临时垫一段空白，到下一次换区间为止。
 */
export function useHold(shownId: string | undefined) {
  const hold = useRef<{ id: string; el: HTMLElement; was: number } | null>(null);
  const [pad, setPad] = useState<{ id: string; px: number } | null>(null);
  const start = useCallback((id: string, el: HTMLElement) => {
    hold.current = { id, el, was: el.getBoundingClientRect().top };
  }, []);
  useLayoutEffect(() => {
    const h = hold.current;
    if (!h || h.id !== shownId || !h.el.isConnected) return;
    const sc = scrollParent(h.el);
    if (!sc) {
      hold.current = null;
      return;
    }
    const at = holdTarget(
      { scrollTop: sc.scrollTop, scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, top: h.el.getBoundingClientRect().top },
      h.was,
    );
    if (at.short > 0) {
      // 先把空白垫上，下一次画完再补滚动位置
      setPad((p) => ({ id: h.id, px: (p && p.id === h.id ? p.px : 0) + at.short }));
      return;
    }
    sc.scrollTop = at.scrollTop;
    hold.current = null;
  });
  return { start, pad: pad && pad.id === shownId ? pad.px : 0 };
}
