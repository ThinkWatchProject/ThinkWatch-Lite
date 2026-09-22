import { useEffect, useState } from "react";

/**
 * 现在的时刻，每隔一段时间更新一次。
 *
 * **给只随时间变化的文字用**，比如额度的「多久后重置」：数据没变，是时间在走。
 * 用它的组件自己重画，不去问 core —— 问了也是同一个答案。
 */
export function useNow(periodMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(h);
  }, [periodMs]);
  return now;
}
