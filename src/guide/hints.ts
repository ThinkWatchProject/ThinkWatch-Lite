import { useSyncExternalStore } from "react";

/**
 * 引导提示：在用到某处的那一刻说一句下一步，点「不再显示」之后不再出现。
 *
 * **记在这台电脑上（localStorage），不进 config.yaml。**这是「这个人看过没有」，
 * 不是网关的配置：连到远程 core 时也不该跟着服务器走，换一台电脑重新看一遍也无妨。
 * 读写失败（隐私模式、存储被清）就当没看过 —— 多提示一次的代价远小于少一次。
 */
export type HintId =
  /** 上游页：有了上游，还没有客户端接进来 */
  | "next-clients"
  /** 客户端页：还没有上游 */
  | "next-upstream"
  /** 客户端页：接进来了，还没有请求 */
  | "next-request"
  /** 概览：第一条请求到了 */
  | "first-request"
  /** 流量页：点开一条请求能看到什么 */
  | "traffic-open-row"
  /** 安全页：防护出厂是观察 */
  | "security-observe"
  /**
   * 上游页「别名」标签：同一模型在几个上游名称不同的一条建议，点过「忽略」。
   * 后面是这条建议的标识（`aliases/logic.ts` 的 `suggestionKey`）
   */
  | `alias-suggestion:${string}`;

const KEY = "tw-guide";

interface Stored {
  /** 点过「不再显示」的 */
  dismissed: string[];
  /**
   * 概览上的「开始使用」出现过。**第一条请求的那句只说给走过这几步的人**：升级上来
   * 的老用户早就有请求了，对他们说「第一条请求已经过网关」是胡话
   */
  setupSeen: boolean;
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Stored>;
      return {
        dismissed: Array.isArray(v.dismissed) ? v.dismissed.filter((x) => typeof x === "string") : [],
        setupSeen: v.setupSeen === true,
      };
    }
  } catch {
    // 读不出来就当没看过
  }
  return { dismissed: [], setupSeen: false };
}

let state: Stored = read();
const listeners = new Set<() => void>();

function commit(next: Stored) {
  state = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 存不进去：这一次运行里照样不再出现，下次启动再提示一遍
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// 快照：同一份状态返回同一个值，React 才不会每次都当成变了。第三个参数（服务端快照）
// 给的是同一个函数 —— 测试用 renderToStaticMarkup 画组件时要它
const getDismissed = () => state.dismissed;
const getSetupSeen = () => state.setupSeen;
const getAnyDismissed = () => state.dismissed.length > 0;

/**
 * 一条提示此刻该不该出现：条件成立、而且没点过「不再显示」。
 *
 * `when` 是那一刻的事实（还没有上游、还没有请求……），由调用方算；**数据没取到时
 * 传 false**，不要在数据到之前先闪一下。
 */
export function useHint(id: HintId, when: boolean): { show: boolean; dismiss: () => void } {
  const dismissed = useSyncExternalStore(subscribe, getDismissed, getDismissed);
  return {
    show: when && !dismissed.includes(id),
    dismiss: () => {
      if (!state.dismissed.includes(id)) commit({ ...state, dismissed: [...state.dismissed, id] });
    },
  };
}

/**
 * 点过「不再显示」的全部提示。一处要看好几条的时候用（「别名」标签上的几条建议、
 * 标签名旁的小圆点），一条一条的用 `useHint`
 */
export function useDismissedHints(): readonly string[] {
  return useSyncExternalStore(subscribe, getDismissed, getDismissed);
}

/** 一次记下好几条「不再显示」（「忽略」全部建议） */
export function dismissHints(ids: readonly HintId[]) {
  const add = [...new Set(ids)].filter((id) => !state.dismissed.includes(id));
  if (add.length > 0) commit({ ...state, dismissed: [...state.dismissed, ...add] });
}

/** 「开始使用」出现过没有（见 `Stored.setupSeen`） */
export function useSetupSeen(): boolean {
  return useSyncExternalStore(subscribe, getSetupSeen, getSetupSeen);
}

export function markSetupSeen() {
  if (!state.setupSeen) commit({ ...state, setupSeen: true });
}

/** 设置里的「重新显示」：点过「不再显示」的全部再出现。「开始使用」看过的记录不动 */
export function resetHints() {
  commit({ ...state, dismissed: [] });
}

/** 有没有点过「不再显示」的 —— 设置里那一行据此决定按钮能不能按 */
export function useAnyDismissed(): boolean {
  return useSyncExternalStore(subscribe, getAnyDismissed, getAnyDismissed);
}
