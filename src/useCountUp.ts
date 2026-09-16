import { useEffect, useRef, useState } from "react";

/** 走完一次要多久。**短** —— 这是一个数字落定，不是一段表演。 */
const MS = 350;

/**
 * 让一个数字走到新值，而不是直接跳过去。
 *
 * **只在同一个口径里走。**换时间范围时那不是「涨了」，是换了一个东西
 * 在看 —— 让它从 251k 滚到 661k，看起来像用量突然翻了三倍。所以
 * `scope` 一变就直接落到新值，一帧都不动。
 *
 * **它不会在什么都没发生的时候动。**上游那个 `useStableState` 保证
 * 内容没变就不重渲染，所以这里每一次动都对应着真的多了几个请求 ——
 * 和之前那个「刷新一次图表重演一遍」是两回事：那个是拿动画掩盖一次
 * 无意义的刷新，这个是把一次真实的变化说出来。
 *
 * 系统里关掉了动效就直接落值 —— 这类装饰性动画是 `prefers-reduced-
 * motion` 最典型的适用对象。
 */
export function useCountUp(value: number, scope: string, ms = MS): number {
  const [shown, setShown] = useState(value);
  /** 当前画到哪儿了。**不能从 state 读** —— 那样每一帧都会重启动画 */
  const at = useRef(value);
  const last = useRef(scope);

  useEffect(() => {
    const jump =
      last.current !== scope ||
      at.current === value ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    last.current = scope;
    if (jump) {
      at.current = value;
      setShown(value);
      return;
    }
    const from = at.current;
    const t0 = performance.now();
    let id = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - t0) / ms);
      // 缓出：开头快、末尾慢。读起来是「落定」，不是「匀速爬」
      at.current = from + (value - from) * (1 - (1 - k) ** 3);
      setShown(k < 1 ? at.current : value);
      if (k < 1) id = requestAnimationFrame(step);
      else at.current = value;
    });
    return () => cancelAnimationFrame(id);
  }, [value, scope, ms]);

  return shown;
}
