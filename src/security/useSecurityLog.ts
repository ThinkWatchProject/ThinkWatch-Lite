import { useRef } from "react";
import { useResource, type Resource } from "@/lib/resource";
import { usePending } from "@/ui/notify";
import { windowStart, type Range } from "@/ui/range";
import type { SecurityEventsPage } from "@/types";
import { api } from "./api";

/** 一次读多少条。**一屏半** —— 再多就是替用户翻他不会看的那几页 */
const PAGE = 100;
/** core 一次最多给这么多 */
const MAX = 500;

export interface SecurityLog {
  r: Resource<SecurityEventsPage>;
  /** 这一段时间的口径。换了区间就换，页头的数字按它决定滚不滚 */
  scope: string;
  loadMore: () => void;
  loadingMore: boolean;
}

/**
 * 安全日志：一段时间里的命中，按时间倒序，一页一页往下翻。
 *
 * **页头和日志用同一次读取。**每一页都带着整段时间的总数和各做法的条数
 * （`total`、`by_outcome`），页头说的是这两样；日志列的是其中最新的若干条，
 * 往下翻才读更早的。换页再回来先画缓存（`useResource`），后台再读。
 *
 * **换了区间从第一页读起；只是来了新记录，就把已经翻出来的几页一起重读。**
 * 用户往下翻了三页正看着，一条新命中进来就把列表弹回第一页，等于把他翻过的
 * 全扔了。
 *
 * 时间窗的起点和概览用同一个函数算（`windowStart`）：从概览点进来时，条数是
 * 那几个数之和。
 */
export function useSecurityLog(range: Range, tick: number): SecurityLog {
  const scope = `${range.ms}|${range.live ? 1 : 0}|${range.custom ? 1 : 0}`;
  /** 已经翻出来多少条。重读时照这个数读，翻过的不丢 */
  const loaded = useRef(0);
  const r = useResource<SecurityEventsPage>(
    `security-log:${scope}`,
    () =>
      api.events({
        from_ms: windowStart(range),
        limit: Math.min(MAX, Math.max(PAGE, loaded.current)),
      }),
    // 库里多了请求就重读：新命中不用手动刷新
    { deps: [tick] },
  );
  loaded.current = r.data?.events.length ?? 0;

  const [loadingMore, run] = usePending();
  const loadMore = () =>
    void run(async () => {
      const last = r.data?.events[r.data.events.length - 1];
      if (!last) return;
      const p = await api.events({ from_ms: windowStart(range), before: last.id, limit: PAGE });
      // 读的这一会儿列表被重读过（来了新记录）：尾巴已经不是这一页接得上的那一条，
      // 这一页不接，免得中间缺一段。再点一次就从新的尾巴往下读。
      // 总数和各做法的条数说的是整段时间，哪一页带来的都一样：取新的这一页的
      r.mutate((prev) =>
        prev && prev.events[prev.events.length - 1]?.id === last.id
          ? { ...p, events: [...prev.events, ...p.events] }
          : (prev ?? p),
      );
    });

  return { r, scope, loadMore, loadingMore };
}
