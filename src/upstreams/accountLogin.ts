import { useEffect, useRef, useState } from "react";
import { textOf } from "@/i18n";
import type { ChatgptLoginStatus, ZaiFamily, ZaiLoginStatus } from "@/types";
import { api } from "./api";
import { accountPanelText } from "./AccountPanel.i18n";
import { coreText, errorText, planLabel } from "./labels";
import { useLoginWait } from "./loginWait";

/** 登录哪一种账号 */
export type LoginKind = "chatgpt" | "zai";

/**
 * 怎么开始：`browser` 在默认浏览器里打开授权页；`link` 不开浏览器，把登录链接复制下来
 * 去别的浏览器里打开；`device` 拿一个设备码去任意浏览器里输（只有 ChatGPT 有）
 */
export type LoginStart = "browser" | "link" | "device";

/** 登上的是谁：邮箱（Z.ai 可能是昵称）和套餐。读不出来的那一项是 null */
export interface LoginAccount {
  who: string | null;
  plan: string | null;
}

export type LoginPhase =
  | { at: "idle" }
  /** 等浏览器里授权。`opened`：授权页已经在默认浏览器里打开（否则是复制了链接） */
  | { at: "browser"; id: string; url: string; expiresAt: number; opened: boolean }
  /** 等在别处输设备码 */
  | { at: "device"; id: string; code: string; url: string; expiresAt: number }
  /** 上游已经由 core 写进配置 */
  | { at: "done"; provider: string; account: LoginAccount | null };

export interface LoginParams {
  name: string;
  proxy: string;
  /** Z.ai / BigModel 登哪一边 */
  family: ZaiFamily;
}

export interface AccountLogin {
  kind: LoginKind;
  phase: LoginPhase;
  /** 正在发起哪一种。转圈的是被点的那个按钮 */
  starting: LoginStart | null;
  error: string | null;
  /** 等着授权或输码：别的都不能动 */
  waiting: boolean;
  start: (how: LoginStart, p: LoginParams) => Promise<void>;
  /** 放弃这一次，回到开始之前 */
  cancel: () => Promise<void>;
  /** 再打开一次授权页（设备码登录是验证网址） */
  reopen: () => void;
  /** 复制登录链接（设备码登录是验证网址）或设备码。失败时抛出去，按钮不打勾 */
  copy: (item: "url" | "code") => Promise<void>;
}

/**
 * 一次账号登录（ChatGPT、Z.ai / BigModel）从开始到结束：新建上游的「账号」一步和
 * ChatGPT 的重新登录都用它。
 *
 * · **结果由 core 发事件，轮询兜底**（`useLoginWait`）。
 * · **只认眼下这一次**：换一种方式重新开始时（改用设备码、重新获取），core 让上一次作废，
 *   那一次的「已取消」可能先到 —— 它不是这一次的结果，不收。
 * · **离开时收尾**：等着的时候对话框关了，这一次登录也取消（core 同一时刻只有一次登录，
 *   留着它只会占着回调端口直到过期）。
 */
export function useAccountLogin(
  kind: LoginKind,
  onDone: (provider: string, account: LoginAccount | null) => void,
): AccountLogin {
  const [phase, setPhase] = useState<LoginPhase>({ at: "idle" });
  const [starting, setStarting] = useState<LoginStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waitingId = phase.at === "browser" || phase.at === "device" ? phase.id : null;
  /**
   * 眼下这一次的 ID。**只在这里几处改，不跟着渲染改**：开始新的一次之前清掉，这时上一次
   * 还在 `phase` 里、订阅也还没换，它的结果到了也不收
   */
  const current = useRef<string | null>(null);
  const cancelOf = (id: string) => (kind === "chatgpt" ? api.cancelChatgptLogin(id) : api.cancelZaiLogin(id));

  useLoginWait<ChatgptLoginStatus | ZaiLoginStatus>(
    waitingId,
    kind === "chatgpt" ? api.chatgptLoginStatus : api.zaiLoginStatus,
    (s) => {
      if (s.id !== current.current) return;
      current.current = null;
      if (s.status === "done" && s.provider) {
        const account = accountOf(s);
        setPhase({ at: "done", provider: s.provider, account });
        onDone(s.provider, account);
        return;
      }
      setPhase({ at: "idle" });
      const t = textOf(accountPanelText);
      setError(s.error ? coreText(s.error) : s.status === "expired" ? t.expired : t.cancelled);
    },
  );

  // 对话框关了还在等：取消这一次（取消失败也无妨，它最多 15 分钟后自己过期）
  const cancelRef = useRef(cancelOf);
  cancelRef.current = cancelOf;
  useEffect(
    () => () => {
      const id = current.current;
      if (id) cancelRef.current(id).catch(() => {});
    },
    [],
  );

  async function start(how: LoginStart, p: LoginParams) {
    /** 换一种方式重新开始时，正在等的那一次 */
    const previous = current.current;
    current.current = null;
    setStarting(how);
    setError(null);
    try {
      const open = how === "browser";
      const expires = (secs: number) => Date.now() + secs * 1000;
      if (kind === "chatgpt") {
        const login = await api.startChatgptLogin(p.name.trim(), p.proxy, how === "device" ? "device" : "browser", open);
        current.current = login.id;
        setPhase(
          login.user_code && login.verification_url
            ? {
                at: "device",
                id: login.id,
                code: login.user_code,
                url: login.verification_url,
                expiresAt: expires(login.expires_in_secs),
              }
            : {
                at: "browser",
                id: login.id,
                url: login.authorize_url ?? "",
                expiresAt: expires(login.expires_in_secs),
                opened: open,
              },
        );
        if (how === "link") await api.copyChatgptLogin(login.id, "url");
      } else {
        const login = await api.startZaiLogin(p.family, p.name.trim(), p.proxy, open);
        current.current = login.id;
        setPhase({
          at: "browser",
          id: login.id,
          url: login.authorize_url,
          expiresAt: expires(login.expires_in_secs),
          opened: open,
        });
        if (how === "link") await api.copyZaiLogin(login.id);
      }
    } catch (e) {
      setError(errorText(e));
      // 没开始成：回到开始之前。正在等的那一次 core 可能已经让它作废了，也可能没有 ——
      // 一并取消，免得界面上还显示着一个不会再有结果的等待
      if (current.current === null) {
        setPhase({ at: "idle" });
        if (previous) cancelOf(previous).catch(() => {});
      }
    } finally {
      setStarting(null);
    }
  }

  async function cancel() {
    const id = current.current;
    current.current = null;
    setPhase({ at: "idle" });
    setError(null);
    if (id) await cancelOf(id).catch(() => {});
  }

  function reopen() {
    if (!waitingId) return;
    (kind === "chatgpt" ? api.reopenChatgptLogin(waitingId) : api.reopenZaiLogin(waitingId)).catch((e) =>
      setError(errorText(e)),
    );
  }

  async function copy(item: "url" | "code") {
    if (!waitingId) return;
    try {
      await (kind === "chatgpt" ? api.copyChatgptLogin(waitingId, item) : api.copyZaiLogin(waitingId));
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  }

  return { kind, phase, starting, error, waiting: waitingId != null, start, cancel, reopen, copy };
}

/** 登录结果里的账号：ChatGPT 是邮箱和套餐，Z.ai 是一个邮箱或昵称 */
function accountOf(s: ChatgptLoginStatus | ZaiLoginStatus): LoginAccount | null {
  const a = s.account;
  if (a == null) return null;
  if (typeof a === "string") return { who: a, plan: null };
  const plan = planLabel(a.plan);
  return a.email || plan ? { who: a.email ?? null, plan } : null;
}
