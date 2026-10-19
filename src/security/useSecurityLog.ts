import { useRef } from "react";
import { useResource, type Resource } from "@/lib/resource";
import { usePending } from "@/ui/notify";
import { windowStart, type Range } from "@/ui/range";
import type { Guard, SecurityEventsPage } from "@/types";
import { api } from "./api";

/** 一次读多少条。**一屏半** —— 再多就是替用户翻他不会看的那几页 */
const PAGE = 100;
/** core 一次最多给这么多。导出整段时按它翻页 */
export const MAX_PAGE = 500;

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
 *
 * `guard` 只读这一项的（日志「类型」列头的筛选），总数和各做法的条数也只数这一项。
 * `skip` 什么都不读：页面一直挂着全部的那一份，筛选着的时候才挂这一份。
 */
export function useSecurityLog(range: Range, tick: number, guard: Guard | null = null, skip = false): SecurityLog {
  // 自定义区间按起点认：它的 `ms` 是建它那一刻量的，同一天再选一次就是另一个数
  const scope = `${range.from ?? range.ms}|${range.live ? 1 : 0}|${range.custom ? 1 : 0}`;
  /** 已经翻出来多少条。重读时照这个数读，翻过的不丢 */
  const loaded = useRef(0);
  const r = useResource<SecurityEventsPage>(
    skip ? null : `security-log:${scope}:${guard ?? "all"}`,
    () =>
      api.events({
        guard,
        from_ms: windowStart(range),
        limit: Math.min(MAX_PAGE, Math.max(PAGE, loaded.current)),
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
      const p = await api.events({ guard, from_ms: windowStart(range), before: last.id, limit: PAGE });
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

/**
 * 日志按类型筛着时画哪一份。这一类读到过就是它（缓存，后台再读）；**刚换到一类、还没
 * 读到**时，先把全部的那一份里这一类的挑出来画着 —— 不然表换成骨架，列头上的筛选
 * 跟着消失、焦点丢掉。读到了无声换成这一类的。读失败了照常报错，不拿挑出来的顶着
 */
export function narrowed(only: SecurityLog, all: SecurityLog, guard: Guard): SecurityLog {
  const page = all.r.data;
  if (only.r.data !== undefined || !only.r.loading || !page) return only;
  const events = page.events.filter((e) => e.guard === guard);
  return { ...only, r: { ...only.r, data: { ...page, events }, loading: false } };
}
