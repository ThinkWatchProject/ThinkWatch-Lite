import { useSyncExternalStore } from "react";

/**
 * 「忽略」：一条黄色提醒点过忽略之后不再出现，**直到它说的事有了新情况**。
 *
 * 每条提醒带一个「印记」（`Mark`，可以写成 JSON 的值）描述它此刻说的是什么：失败那条
 * 是最近一次失败落在哪个格子、那格有几次；上游那条是哪几家、为什么。点忽略记下当时的
 * 印记；之后印记没有超出记下的那一份（`covered`）就不出现，超出了（又有新的失败、又一家
 * 上游不可用）再出现。「重新显示」把记下的全清掉。
 *
 * **记在这台电脑上（localStorage），不进 config.yaml**：这是「这个人看过没有」，连到
 * 远程 core 时也不该跟着服务器走。`session` 的只记在这一次运行里：断线、请求记录没
 * 起来这些，下次启动还在就该再说一遍。读写失败（隐私模式、存储被清）就当没忽略过。
 */
export type Mark = string | number | boolean | null | Mark[] | { [k: string]: Mark };

const KEY = "tw-ignored";

type Stored = Record<string, Mark>;

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Stored;
    }
  } catch {
    // 读不出来就当没忽略过
  }
  return {};
}

let stored: Stored = read();
/** 只记这一次运行的 */
let session: Stored = {};
const listeners = new Set<() => void>();

function commit(next: Stored, persist: boolean) {
  if (persist) {
    stored = next;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // 存不进去：这一次运行里照样不出现，下次启动再提醒一遍
    }
  } else {
    session = next;
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getStored = () => stored;
const getSession = () => session;
const getAny = () => Object.keys(stored).length > 0;

/**
 * 一条提醒此刻该不该出现：没忽略过，或者忽略之后有了新情况。
 *
 * `covered(seen, current)`：记下的印记 `seen` 盖得住此刻的 `current` 没有 —— 盖得住
 * 就不出现。数字类的是「没变多」，集合类的是「没有新成员」。
 */
export function useIgnored<M extends Mark>(
  key: string,
  current: M,
  covered: (seen: M, current: M) => boolean,
  opts: { session?: boolean } = {},
): { ignored: boolean; ignore: () => void } {
  const persist = !opts.session;
  const all = useSyncExternalStore(subscribe, persist ? getStored : getSession, persist ? getStored : getSession);
  const seen = all[key];
  return {
    ignored: seen !== undefined && covered(seen as M, current),
    ignore: () => commit({ ...(persist ? stored : session), [key]: current }, persist),
  };
}

/** 数字类的印记：没变多就算盖住了 */
export const noMore = (seen: number, current: number) => current <= seen;

/** 集合类的印记：没有新成员就算盖住了 */
export const noNew = (seen: string[], current: string[]) => current.every((x) => seen.includes(x));

/** 设置里的「重新显示」：忽略过的全部再出现 */
export function resetIgnored() {
  commit({}, true);
  commit({}, false);
}

/** 有没有忽略过的（记在这台电脑上的）—— 设置里那一行据此决定按钮能不能按 */
export function useAnyIgnored(): boolean {
  return useSyncExternalStore(subscribe, getAny, getAny);
}
