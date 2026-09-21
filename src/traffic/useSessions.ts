import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { errorText } from "@/i18n/core.i18n";
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
 * **窗口筛的是会话，不是轮次**（core 那边保证）：一次跨过边界的任务
 * 整条留下，轮次和金额都是整次任务的 —— 「那次重构花了多少」问的不是
 * 它落在某个窗口里的那一段。
 */
export function useSessions(within: { fromMs: number; toMs: number } | null) {
  const [rows, setRows] = useState<SessionView[]>([]);
  const from = within?.fromMs ?? null;
  const to = within?.toMs ?? null;

  const load = useCallback(async () => {
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      setRows(await invoke<SessionView[]>("sessions", { fromMs: from, toMs: to }));
    } catch (e) {
      toast.error(errorText(e));
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useCoreEvent(
    ["request_finished", "request_failed", "request_cancelled"],
    () => void load(),
  );

  return rows;
}
