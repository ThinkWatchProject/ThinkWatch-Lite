import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CoreEvent } from "./types";

/**
 * 关心的那几种事件到了就回调一次。
 *
 * **这是用来替掉定时轮询的。**在它之前，几个页面各自挂着
 * `setInterval`：会话每 10 秒重算一遍聚合，客户端每 5 秒重扫一遍磁盘。
 * 那些查询的答案只在请求落地或者文件被改动时才会变，而这两件事 core
 * 都会报 —— 也就是说，绝大多数轮问到的是上一次的同一个答案。空闲的
 * 机器上，它们加起来是每分钟三十多次无效查询。
 *
 * **节流，不是防抖。**往后推的话，一串不断的请求会让刷新永远排不上号
 * —— 而那正是最该刷新的时候。排上之后到期就刷，中间来多少条都只刷
 * 这一次。
 *
 * 每个页面自己订阅，不从 App 一层层传下去：Tauri 的事件通道本来就支持
 * 多个监听者，而「这一页关心哪几种事件」写在这一页里才看得懂。
 *
 * **事件流丢过事件（`events_dropped`）也回调**：丢掉的那几条里可能正有这一页
 * 关心的，当它们发生过，重读一次。
 */
export function useCoreEvent(
  kinds: readonly CoreEvent["kind"][],
  onChange: () => void,
  throttleMs = 2_500,
) {
  // 回调每次渲染都是新的（页面里通常是个闭包），但订阅不该跟着重建 ——
  // 重建一次就会漏掉那一瞬间的事件。所以回调放 ref，依赖里只留种类。
  const cb = useRef(onChange);
  cb.current = onChange;
  const want = kinds.join(",");

  useEffect(() => {
    const set = new Set([...want.split(","), "events_dropped"]);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const un = listen<CoreEvent>("core-event", (e) => {
      if (!set.has(e.payload.kind) || timer) return;
      timer = setTimeout(() => {
        timer = null;
        cb.current();
      }, throttleMs);
    });
    return () => {
      void un.then((f) => f());
      if (timer) clearTimeout(timer);
    };
  }, [want, throttleMs]);
}
