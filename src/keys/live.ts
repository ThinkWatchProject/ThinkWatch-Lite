import { useMemo } from "react";
import type { RequestRow } from "@/types";

/**
 * 此刻有请求在跑的密钥（`client` 就是密钥名）。密钥页、客户端页上用量那一格的
 * 「请求中」看它。
 *
 * 数据是外壳那份实时请求列表（`useRequests`）：它自己接着 core 的事件，开窗时还补过
 * core 的「此刻在跑的」快照，这里不另起一路。**只在这一组密钥变了时换引用** ——
 * 流式请求每一帧都在改列表，而这两页只关心谁在跑、谁跑完了。
 */
export function useBusyKeys(rows: RequestRow[]): ReadonlySet<string> {
  const sig = JSON.stringify([...new Set(rows.filter((r) => r.state === "in_flight").map((r) => r.client))].sort());
  return useMemo(() => new Set(JSON.parse(sig) as string[]), [sig]);
}
