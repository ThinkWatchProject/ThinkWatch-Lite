import { useEffect, useRef, useState } from "react";

/** 新来的一项算「新」多久。和 `motion-row-in` 的时长同一个数 */
const FRESH_MS = 900;

/**
 * 刚到的那几项（请求 id、会话 id），给它们挂进场动画。
 *
 * **第一个请求进来时那一行要跳出来** —— 它是「网关真的在工作」的证明。`armed`
 * 之前（历史还没读完）什么都不算：那时满屏都在填进来，看不出哪一条是新的；
 * `armed` 那一刻在的全部记为「见过」，之后第一次出现的才是新来的。
 *
 * **只认第一次出现。**筛选放开、归组展开时重新露出来的那些不是新来的，不再滑
 * 一次；所以这里要传没筛过的全集，不是表里此刻画着的那几行。
 *
 * 每一批各自定时摘掉：新的一批到了不能把上一批的计时冲掉，不然那几项会一直
 * 挂着「新」，换个视角重挂的时候又滑一遍。
 */
export function useArrivals<K>(keys: readonly K[], armed: boolean): ReadonlySet<K> {
  const seen = useRef<Set<K> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [fresh, setFresh] = useState<ReadonlySet<K>>(() => new Set());

  useEffect(() => {
    if (!armed) return;
    if (seen.current === null) {
      seen.current = new Set(keys);
      return;
    }
    const known = seen.current;
    const news = keys.filter((k) => !known.has(k));
    if (news.length === 0) return;
    for (const k of news) known.add(k);
    setFresh((prev) => new Set([...prev, ...news]));
    const h = setTimeout(() => {
      timers.current.delete(h);
      setFresh((prev) => {
        const next = new Set(prev);
        for (const k of news) next.delete(k);
        return next;
      });
    }, FRESH_MS);
    timers.current.add(h);
  }, [keys, armed]);

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const h of all) clearTimeout(h);
    };
  }, []);

  return fresh;
}
