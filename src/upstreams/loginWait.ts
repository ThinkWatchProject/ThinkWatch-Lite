import { useEffect, useRef } from "react";
import { subscribe } from "@/lib/tauriEvent";
import type { CoreEvent, LoginStatus, Msg } from "@/types";

/**
 * 等一次账号登录（ChatGPT、Z.ai）的结果。两个登录对话框原来各写一份一模一样的：
 *
 * · **事件是主路**：core 登录有了结果发 `login_finished`。事件只报结果，不带登上的是
 *   哪个账号（那一项只在这次登录的状态里），所以收到事件立刻问一次状态；问不到就按
 *   事件收尾。
 * · **轮询兜底**：每 `pollMs` 问一次，事件漏掉时也能收尾。控制面一时不通就下一轮再问。
 * · **只收一次尾**：事件和轮询都会报结果；`pending` 不算结果。
 * · **停了就不再回调**：对话框关掉、换了一次登录，在路上的回答落地了也不管。
 *
 * 返回停下的函数。
 */
export interface LoginResult {
  id: string;
  status: LoginStatus;
  provider?: string | null;
  error?: Msg | null;
}

/** 登录还没结果时，多久问一次 core */
export const POLL_MS = 2_000;

export function waitForLogin<S extends LoginResult>({
  login,
  fetchStatus,
  onSettled,
  listen,
  pollMs = POLL_MS,
}: {
  /** 发起登录时拿到的 ID */
  login: string;
  fetchStatus: (id: string) => Promise<S>;
  /** 有了结果（不是 `pending`）。每次登录只调一次 */
  onSettled: (s: S) => void;
  /** 订阅 core 的事件，返回退订 */
  listen: (on: (ev: CoreEvent) => void) => () => void;
  pollMs?: number;
}): () => void {
  let stopped = false;
  let settled = false;
  const settle = (s: S) => {
    if (stopped || settled || s.status === "pending") return;
    settled = true;
    onSettled(s);
  };
  const unlisten = listen((ev) => {
    if (ev.kind !== "login_finished" || ev.login !== login) return;
    fetchStatus(ev.login).then(settle, () =>
      // 状态里比事件多的只有可选的几项（登上的账号），按事件收尾时没有它们
      settle({ id: ev.login, status: ev.status, provider: ev.provider ?? null, error: ev.error ?? null } as S),
    );
  });
  const timer = setInterval(() => {
    fetchStatus(login).then(settle, () => {
      // 控制面一时不通：下一轮再问
    });
  }, pollMs);
  return () => {
    stopped = true;
    unlisten();
    clearInterval(timer);
  };
}

/**
 * 对话框里用：`login` 是正在等的那次登录（没在等是 `null`）。换了登录、对话框关掉都会
 * 停下。回调放 ref 里，订阅只跟着这次登录重建 —— 重建一次就可能漏掉那一瞬间的事件。
 */
export function useLoginWait<S extends LoginResult>(
  login: string | null,
  fetchStatus: (id: string) => Promise<S>,
  onSettled: (s: S) => void,
) {
  const cb = useRef({ fetchStatus, onSettled });
  cb.current = { fetchStatus, onSettled };
  useEffect(() => {
    if (!login) return;
    return waitForLogin<S>({
      login,
      fetchStatus: (id) => cb.current.fetchStatus(id),
      onSettled: (s) => cb.current.onSettled(s),
      listen: (on) => subscribe<CoreEvent>("core-event", (e) => on(e.payload)),
    });
  }, [login]);
}
