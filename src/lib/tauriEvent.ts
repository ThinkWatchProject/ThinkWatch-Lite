import { useEffect, useRef } from "react";
import { listen, type EventCallback, type EventName, type Options, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * 听 Rust 那边发来的事件。**界面里的事件订阅一律走这里**，不直接调 `listen`、`once`
 * 或窗口上的 `listen`/`onXxx`（`source.test.ts` 盯着）。窗口范围的事件用 `options.target`。
 *
 * **直接用 `listen` 退订会抛错，还可能根本没退掉。**`listen` 兑现时，Tauri 只是把「在
 * 页面里登记这个监听」的那段脚本排进了应用主线程的队列，应答却是从异步运行时直接发回
 * 来的 —— 两者谁先到页面说不准。真应用里换页时实测：一千来次订阅里有几十次应答先到，
 * 脚本多半晚几毫秒到几十毫秒才跟上。这个空档里退订，Tauri 的 `_unlisten` 去读
 * `listeners[eventId].handlerId`，那一项还没有：
 *
 * · 退订函数是 async 的，抛出来的错误成了一个没人接的 rejection，换页时成串地出；
 * · 它抛在通知 Rust 之前，Rust 那边的登记原样留着。脚本随后到达、监听照常装上，之后
 *   每来一个事件，都去调那个已经卸掉的组件的回调。
 *
 * 退订偏偏最容易撞进这个空档：effect 的清理先于 `listen` 兑现时（StrictMode 的双跑、
 * 刚挂上就卸掉的页面），`un.then((f) => f())` 正好在兑现的那一刻退。
 *
 * 所以这里：
 *
 * · 退订函数是同步的，什么时候调都行，调几次都只退一次。注册还没完成就记下，完成的
 *   那一刻退；
 * · 一退订，回调当场失效，不等 Tauri 那边真的退掉；
 * · 退订失败不往外抛，隔一会儿再退一次，那时脚本早到了；再不行就算了 —— 回调反正已经
 *   失效。再退一次不会退掉别的：上面那种失败抛在动任何东西之前，别的失败（通知 Rust 的
 *   那一下没送到）重来一遍也只是按同一个号再删一次。
 */
export function subscribe<T>(event: EventName, handler: EventCallback<T>, options?: Options): Unsubscribe {
  let live = true;
  let unlisten: UnlistenFn | null = null;
  const ready = listen<T>(
    event,
    (e) => {
      if (live) handler(e);
    },
    options,
  ).then((f) => {
    unlisten = f;
    if (!live) release(f);
  });
  // 只退订、没人等 `ready` 的地方，「不在应用里」的那次拒绝不该成为没人接的 rejection
  ready.catch(() => {});
  const off = () => {
    if (!live) return;
    live = false;
    if (unlisten) release(unlisten);
  };
  return Object.assign(off, { ready });
}

/**
 * 退订。**同步、随时可调、调几次都只退一次**，可以直接当 effect 的清理函数返回。
 */
export type Unsubscribe = (() => void) & {
  /**
   * 注册完成时兑现，注册失败（不在应用里）时拒绝，跟着 `listen` 返回的那个 promise 落定。
   * 「先挂上监听再读一次现状」的地方等它：它兑现时 Rust 那边已经记下了这个监听，之后发出
   * 的事件都会发给它。
   */
  readonly ready: Promise<void>;
};

/**
 * 组件挂着的时候听一个事件。回调总是用最新的那一个（页面里通常是个每次渲染都新的闭包），
 * 订阅只跟着事件名重建 —— 重建一次就可能漏掉那一瞬间的事件。
 */
export function useTauriEvent<T>(event: EventName, handler: EventCallback<T>): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe<T>(event, (e) => latest.current(e)), [event]);
}

/** 第一次没退掉之后隔多久再退。登记脚本多半只晚几毫秒到几十毫秒，这里留足余量 */
export const RETRY_MS = 250;

function release(f: UnlistenFn, again = true): void {
  attempt(f).catch((e: unknown) => {
    if (again) setTimeout(() => release(f, false), RETRY_MS);
    else if (import.meta.env.DEV) console.debug("[tauri-event] unlisten failed", e);
  });
}

/** 调一次退订函数，同步抛出和异步拒绝一样收成一个 promise */
function attempt(f: UnlistenFn): Promise<void> {
  try {
    return Promise.resolve(f());
  } catch (e) {
    return Promise.reject(e);
  }
}
