import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useResource } from "@/lib/resource";
import { bucketFor, windowStart, type Range } from "@/ui/range";
import type { Dashboard } from "@/types";

const HOUR = 3_600_000;

/**
 * 一个区间的标识。**缓存按它分份，数字的口径也按它换**：换了区间，数字直接落到
 * 新值，不从旧值滚过去 —— 那不是「涨了」，是换了一个东西在看。
 */
export function rangeId(r: Range): string {
  if (r.live) return "live";
  if (r.custom) return `from:${new Date(Date.now() - r.ms).toDateString()}`;
  return `last:${r.ms}`;
}

/** 历史档的格宽；实时档的汇总按一小时一格取（图另有来路） */
export function bucketOf(r: Range): number {
  return r.live ? HOUR : bucketFor(r.ms);
}

/** 画在页面上的那一份：数据，和它属于哪个区间 */
export interface Shown {
  id: string;
  range: Range;
  data: Dashboard;
}

/**
 * 概览的数据。
 *
 * **每个区间各缓存一份**（`useResource`）：回到概览、切回刚看过的区间，立刻画上
 * 一次的数，后台再取。`tick` 一变（库里多了请求、手动刷新）就重取当前这一份。
 *
 * **画出来的数和它的区间绑在一起。**切到一个还没取过的区间时，新数据到之前继续画
 * 旧区间的那一份（`switching`，页面把它压暗）—— 而不是拿旧数据套新区间的格宽和
 * 标签去画，那会先画出一张对不上的图、数字再从旧值滚到新值。新数据到了，区间、
 * 数字、图一起换。
 *
 * 内容没变的重取不换引用：每次 `invoke` 回来都是新对象，直接换的话整页会在什么
 * 都没发生的时候重画一遍。
 */
export function useOverview(range: Range, tick: number) {
  const id = rangeId(range);
  const r = useResource(
    `overview:${id}`,
    () => invoke<Dashboard>("dashboard", { sinceMs: windowStart(range), bucketMs: bucketOf(range) }),
    { deps: [tick] },
  );
  const last = useRef<Shown | null>(null);
  /** 上一份的序列化结果，和 `last` 一起换 */
  const lastJson = useRef("");
  /** 最近一次比过的那个对象：同一个对象不用再序列化一遍 */
  const seen = useRef<Dashboard | undefined>(undefined);
  if (r.data !== undefined && (seen.current !== r.data || last.current?.id !== id)) {
    seen.current = r.data;
    const json = JSON.stringify(r.data);
    if (last.current?.id !== id || lastJson.current !== json) {
      last.current = { id, range, data: r.data };
      lastJson.current = json;
    }
  }
  const shown = last.current;
  const pending = r.data === undefined && shown !== null && r.error === undefined;
  /*
    **失败了就一直是失败的样子，重试时也是**：点「重试」之后错误还在（`useResource`
    在下一次成功之前留着它），这时画的是同一个错误加上转圈的按钮，而不是先闪回骨架
    再闪回错误。
  */
  const failed = r.data === undefined && r.error !== undefined;
  return {
    shown,
    /** 选中的区间还没有数据，画的是上一个区间的 */
    switching: useLagging(pending, 120),
    /** 选中的区间读取失败，而且没有它的数据可画 */
    failed,
    error: r.error,
    /** 失败之后又在取（点了重试，或者库里又多了请求） */
    retrying: failed && r.loading,
    reload: r.reload,
  };
}

/**
 * `on` 持续了 `ms` 才算数。快的切换（缓存里有、或者几十毫秒就回来）不闪一下。
 */
function useLagging(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const h = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(h);
  }, [on, ms]);
  return on && late;
}
