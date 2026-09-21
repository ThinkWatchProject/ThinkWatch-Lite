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
 */
export function useSessions() {
  const [rows, setRows] = useState<SessionView[]>([]);

  const load = useCallback(async () => {
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      setRows(await invoke<SessionView[]>("sessions"));
    } catch (e) {
      toast.error(errorText(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useCoreEvent(
    ["request_finished", "request_failed", "request_cancelled"],
    () => void load(),
  );

  return rows;
}
