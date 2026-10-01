import { call } from "@/control";
import { useResource } from "@/lib/resource";

/**
 * 有没有一条真正经过网关的请求，以及最新那条是哪一条。
 *
 * **网关自己答的不算**（`local`）：Claude Code 一连上就会发几个探测（数 token、
 * 取配额），网关在本地就答了 —— 那说明客户端接进来了，却还不是「请求经过网关发往
 * 上游」。概览判断「从没用过」用的是同一个口径。
 *
 * 只看最近的几十条：要回答的是「有没有」和「最新一条是谁」，用了一段时间的人最近
 * 几十条里不可能全是探测。
 */
export interface FirstRequest {
  /** `null` = 还没取到 */
  used: boolean | null;
  /** 最新一条真正的请求的 id，「查看这条请求」打开它 */
  latestId: number | null;
}

const PEEK = 50;

export function useFirstRequest(): FirstRequest {
  const r = useResource(
    "guide:first-request",
    async () => {
      const rows = await call("History", { limit: PEEK });
      return rows.find((row) => !row.local)?.id ?? null;
    },
    { events: ["request_finished", "request_failed", "request_cancelled"] },
  );
  if (r.data === undefined) return { used: null, latestId: null };
  return { used: r.data !== null, latestId: r.data };
}
