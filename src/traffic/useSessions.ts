import { useCallback, useEffect, useState } from "react";
import { call } from "@/control";
import { useCoreEvent } from "@/useCoreEvent";
import type { SessionView } from "@/types";

/**
 * 会话汇总。**归组表的组头要用它。**
 *
 * 从原来的会话页里搬出来的：那一页整个没了（请求和会话合成了一张表），
 * 而这份数据还要用。
 *
 * **不定时轮询。**会话是把落库的请求聚起来算的，只在有请求落地之后才
 * 会变 —— 空闲时每一遍都算出同一个答案。
 *
 * **连上之后才取**（`ready`）。它挂在 App 顶层，一开窗就会跑；那时 core 多半
 * 还在起，取回来的只有一句「连不上」。读不到也不报：列表照旧，断线的事有
 * 启动画面和顶上那条带子在说。
 */
export function useSessions(ready: boolean) {
  const [rows, setRows] = useState<SessionView[]>([]);

  const load = useCallback(async () => {
    try {
      setRows(await call("Sessions", { limit: 200 }));
    } catch {
      // 留着上一份。下一批请求落地还会再读
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  useCoreEvent(
    ["request_finished", "request_failed", "request_cancelled"],
    () => void load(),
  );

  return rows;
}
