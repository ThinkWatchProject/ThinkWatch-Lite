import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { applyEvent, type CoreEvent, type RequestRow } from "./types";

/** 列表上限。超过就丢最老的 —— 实时视图不是历史，历史在 SQLite 里。 */
const MAX_ROWS = 500;

/**
 * 实时请求列表。
 *
 * **每条事件都 setState 会把 React 打死**（DESIGN.md §7.3）：一个流式
 * 请求每秒几十条事件，十个并发就是每秒几百次重渲染。所以事件先进
 * `useRef` 的缓冲区，按帧 flush 一次 —— 60fps 下用户根本看不出区别，
 * 而重渲染次数降了一到两个数量级。
 */
export function useRequests() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  // 本地应答单独计数。**这是个正向数字**（§4.8）—— 它既证明客户端确实
  // 连上了，又说明那些探测一分钱都没花。
  const [locallyAnswered, setLocallyAnswered] = useState(0);
  const store = useRef(new Map<number, RequestRow>());
  const pending = useRef<CoreEvent[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      frame.current = null;
      if (pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      let local = 0;
      for (const ev of batch) {
        if (ev.kind === "locally_answered") local += 1;
        applyEvent(store.current, ev);
      }
      if (local > 0) setLocallyAnswered((n) => n + local);
      // 超出上限时按 id 顺序丢最老的
      if (store.current.size > MAX_ROWS) {
        const ids = [...store.current.keys()].sort((a, b) => a - b);
        for (const id of ids.slice(0, store.current.size - MAX_ROWS)) {
          store.current.delete(id);
        }
      }
      setRows([...store.current.values()].sort((a, b) => b.id - a.id));
    };

    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    const un = listen<CoreEvent>("core-event", (e) => {
      pending.current.push(e.payload);
      schedule();
    });

    // 窗口不可见时不必再排帧 —— 后台标签页的 rAF 本来就会被节流，
    // 但显式断掉能省下事件堆积。
    return () => {
      un.then((f) => f());
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return { rows, locallyAnswered };
}
