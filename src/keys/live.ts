import { useMemo } from "react";
import { useRequestsView, type RequestsView } from "@/useRequests";
import type { RequestRow } from "@/types";

/** 每一份请求列表算一次：几个订阅的地方各自取，不各算一遍 */
const signatures = new WeakMap<readonly RequestRow[], string>();

/** 在跑的密钥，排好、连成一个字符串。**按值比较**：这一组没变，订阅的那一页就不重画 */
function busySignature(v: RequestsView): string {
  let sig = signatures.get(v.rows);
  if (sig === undefined) {
    sig = JSON.stringify([...new Set(v.rows.filter((r) => r.state === "in_flight").map((r) => r.client))].sort());
    signatures.set(v.rows, sig);
  }
  return sig;
}

/**
 * 此刻有请求在跑的密钥（`client` 就是密钥名）。密钥页、客户端页上用量那一格的
 * 「请求中」看它。
 *
 * 数据是外壳那份实时请求列表（`useRequests`）：它自己接着 core 的事件，开窗时还补过
 * core 的「此刻在跑的」快照，这里不另起一路。**只在这一组密钥变了时重画、换引用** ——
 * 流式请求每一帧都在改列表，而这两页只关心谁在跑、谁跑完了。
 */
export function useBusyKeys(): ReadonlySet<string> {
  const sig = useRequestsView(busySignature);
  return useMemo(() => new Set(JSON.parse(sig) as string[]), [sig]);
}
