import { useCallback, useEffect, useState } from "react";
import { bucketStart } from "@/format";
import { useCoreEvent } from "@/useCoreEvent";

const DAY_MS = 24 * 3_600_000;

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

/**
 * 此刻所在的这一小时（或这一天）从哪一刻起：本地日历上的整点、零点（`bucketStart`）。
 * 到了下一个就换。
 *
 * **一个定时器等到那一刻，不是轮询**：两次之间什么都不做。**钟跳了也重算**
 * （`clock_changed`：系统睡醒、时钟被改、时区换了）—— 定时器量的钟睡着时不走，睡过了
 * 零点，醒来还要再等睡前剩下的那一段才响；改了时钟、换了时区，那一刻本身就挪了。
 */
export function useStartOf(spanMs: number): number {
  const [start, setStart] = useState(() => bucketStart(Date.now(), spanMs));
  // 每次重算都换一个值，定时器才一定会重新排上 —— 时钟被往回拨过的话，到点时算出来的
  // 可能还是这一段，`start` 没变，光靠它定时器就再也排不上了
  const [aimed, setAimed] = useState(0);
  const aim = useCallback(() => {
    setStart(bucketStart(Date.now(), spanMs));
    setAimed((n) => n + 1);
  }, [spanMs]);
  useEffect(() => {
    const h = setTimeout(aim, Math.max(1_000, nextStart(start, spanMs) - Date.now()));
    return () => clearTimeout(h);
  }, [start, spanMs, aimed, aim]);
  useCoreEvent(["clock_changed"], aim);
  return start;
}

/**
 * 下一段从哪一刻起。**跨零点按日历往后数一天再归零**，不加 86400000：夏令时那两天
 * 一天不是 24 小时。
 */
export function nextStart(start: number, spanMs: number): number {
  if (spanMs < DAY_MS) return start + spanMs;
  const next = new Date(start);
  next.setDate(next.getDate() + Math.round(spanMs / DAY_MS));
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}
