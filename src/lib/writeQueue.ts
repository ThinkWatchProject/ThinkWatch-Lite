import { useEffect, useMemo, useRef } from "react";

/**
 * 同一页上接连几次写配置：排成一队，一次写完再发下一次，下一次带上一次写完的版本号。
 *
 * **写配置要带版本号，而新的版本号要等写完才知道。**连着拨两个开关（两类辅助请求、
 * 两把密钥、两个策略组的优先上游），两次写入带着同一个版本号一起发出去：先到的那次
 * 写成了、版本变了，后到的那次就被 core 当成冲突拒掉 —— 用户看到的是第二个开关弹回去，
 * 外加一条「版本不一致」。排队之后第二次等第一次写完，带着它回的版本号去写。
 *
 * 版本号每次从 `version` 现读：那是这一页最后知道的版本（写完的回执，或者概览读回来的
 * 那一版）。写成了就记下回执；写失败了不记，后面的照常往下走。
 */
export interface VersionRef {
  get(): string;
  set(version: string): void;
}

/** 把一次写入排进队里。`write` 拿到的是轮到它时的版本号，返回 core 的回执 */
export type WriteQueue = <T extends { version: string }>(write: (base: string) => Promise<T>) => Promise<T>;

export function writeQueue(version: VersionRef): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T extends { version: string }>(write: (base: string) => Promise<T>): Promise<T> {
    const run = tail
      .then(() => write(version.get()))
      .then((w) => {
        version.set(w.version);
        return w;
      });
    // 失败的那一次不挡住后面的：错误照样交给调用方，队伍只等它结束
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * 页面用的写入队列。版本号跟着概览走，也跟着这一页自己写完的回执走 —— 刚写完一次、
 * 概览还没读回来的时候，下一次要带的是回执里的那个。
 */
export function useWriteQueue(fromOverview: string): WriteQueue {
  const latest = useRef(fromOverview);
  useEffect(() => {
    latest.current = fromOverview;
  }, [fromOverview]);
  return useMemo(
    () =>
      writeQueue({
        get: () => latest.current,
        set: (v) => {
          latest.current = v;
        },
      }),
    [],
  );
}
