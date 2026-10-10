import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribe } from "@/lib/tauriEvent";
import type { HeadView, LiveBatch, LiveEnd, WireDir, WireSide } from "@/types";

/**
 * 一个在跑的请求的实时内容（`GET /request/{id}/live`，Rust 那一侧见 `src-tauri/src/live.rs`）：
 * 订阅、收下、攒成一段一段的报文。
 *
 * 一段报文由「哪一边、哪个方向、第几跳」定下：客户端的请求和回答是第 0 跳，发给上游的请求
 * 和上游的回答从第 1 跳数起（尝试链上的第 `attempt - 1` 个）。每段一个报文头、一份正文。
 */

/** 一段报文的键 */
export const segKey = (side: WireSide, dir: WireDir, attempt: number) => `${side}:${dir}:${attempt}`;

/** 一段报文，到此刻为止 */
export interface Segment {
  side: WireSide;
  dir: WireDir;
  attempt: number;
  /** 请求行或状态行和头。正文先到、头还没到的不会有：core 先发头 */
  head: HeadView | null;
  /**
   * 正文，按到的先后一段一段（流的回答一段是一个或几个完整的事件）。**同一段又来了一个头**（这一跳
   * 又发了一遍：换了 token、去掉上游拒绝的部分）时从头算，之前那一遍的不留。
   *
   * **不拼成一整个字符串**：每来一段就拼一次，读的时候每一帧都要把几 MB 的串摊平一遍
   */
  chunks: string[];
  /** 正文有多少字节（UTF-8） */
  bytes: number;
  /** 收到过它的正文。core 只发要另存的：发给上游的请求和客户端那一边一样时不发 */
  hasBody: boolean;
  /** 到了上限（4 MiB），之后的不再有 */
  truncated: boolean;
  /** 发了第几遍，从 1 数。变了的话，读过的正文要从头读 */
  sends: number;
}

/** 一段字符串的 UTF-8 字节数 */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      // 代理对：一个四字节的字
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * 收到的全部。**会变的对象**：每来一批就地改，`version` 加一 —— 一个几 MB 的回答，每一批都
 * 拷一份新的就是平方级的。界面按 `version` 判断要不要重画，读的时候只读新的那一截。
 */
export class LiveContent {
  readonly segments = new Map<string, Segment>();
  /** 按第一次出现的先后 */
  readonly order: string[] = [];
  /** core 发的 `end`：请求结束了 */
  end: LiveEnd | null = null;
  /** 订阅结束了：收到了 `end`，或者断了、没订上（`error`） */
  closed = false;
  error: unknown = undefined;
  version = 0;

  apply(b: LiveBatch) {
    for (const it of b.items) {
      if (it.event === "end") {
        this.end = it.data;
        continue;
      }
      const { side, dir, attempt } = it.data;
      const k = segKey(side, dir, attempt);
      let s = this.segments.get(k);
      if (!s) {
        s = { side, dir, attempt, head: null, chunks: [], bytes: 0, hasBody: false, truncated: false, sends: 0 };
        this.segments.set(k, s);
        this.order.push(k);
      }
      if (it.event === "head") {
        s.head = it.data;
        s.sends += 1;
        if (s.sends > 1) {
          // 换一个新的数组：画着的那一份按数组认是不是同一份
          s.chunks = [];
          s.bytes = 0;
          s.hasBody = false;
          s.truncated = false;
        }
      } else {
        if (it.data.text !== "") s.chunks.push(it.data.text);
        s.bytes += utf8Bytes(it.data.text);
        s.hasBody = true;
        if (it.data.truncated) s.truncated = true;
      }
    }
    if (b.closed) {
      this.closed = true;
      if (b.closed.error) this.error = b.closed.error;
    }
    this.version += 1;
  }

  /** 没订上：请求已经结束了，或者连不上 */
  fail(e: unknown) {
    this.closed = true;
    this.error = e;
    this.version += 1;
  }

  get(side: WireSide, dir: WireDir, attempt: number): Segment | undefined {
    return this.segments.get(segKey(side, dir, attempt));
  }

  /** 上游那一边有哪几跳（有报文头的），从小到大 */
  attempts(): number[] {
    const out = new Set<number>();
    for (const s of this.segments.values()) if (s.side === "upstream" && s.head) out.add(s.attempt);
    return [...out].sort((a, b) => a - b);
  }
}

/** 订阅号：同一个网页里不重，重新载入过也不重 */
let seq = 0;
const subId = (id: number) => `${id}.${Date.now().toString(36)}.${(seq += 1)}`;

/**
 * 请求 `id` 在跑时订阅它的实时内容（`on`）。返回收到的全部，还没订过是 null。
 *
 * - **每一帧最多重画一次**：内容一批一批来（Rust 那边攒了 30 毫秒），重画跟着显示器的节拍走
 * - **订阅结束时**（收到 `end`、断了、没订上）调一次 `onClosed`：该去取存下的详情了
 * - **请求结束、浮层关了、换了一条请求时退订**；`on` 变成 false 之后收到的那一份留着，画到
 *   存下的那一份取回来为止
 * - 先听、再订阅：补发的那一批可能比订阅的应答先到
 */
export function useLiveContent(id: number, on: boolean, onClosed: () => void): LiveContent | null {
  const [live, setLive] = useState<LiveContent | null>(null);
  const [, setVersion] = useState(0);
  const closedCb = useRef(onClosed);
  closedCb.current = onClosed;

  useEffect(() => {
    if (!on) return;
    const store = new LiveContent();
    setLive(store);
    const sub = subId(id);
    let frame = 0;
    let gone = false;
    const paint = () => {
      frame = 0;
      if (!gone) setVersion(store.version);
    };
    const soon = () => {
      if (frame === 0) frame = requestAnimationFrame(paint);
    };
    const closed = () => {
      if (!gone) closedCb.current();
    };
    const un = subscribe<LiveBatch>("request-live", (e) => {
      if (e.payload.sub !== sub || store.closed) return;
      store.apply(e.payload);
      soon();
      if (store.closed) closed();
    });
    const unsubscribe = () => void invoke("live_unsubscribe", { sub }).catch(() => {});
    un.ready
      .then(() => {
        if (gone) return;
        return invoke("live_subscribe", { id, sub }).then(() => {
          // 订阅的应答回来之前就退订过的：那一下退订时 Rust 那边还没登记，再退一次
          if (gone) unsubscribe();
        });
      })
      .catch((e: unknown) => {
        if (gone || store.closed) return;
        store.fail(e);
        soon();
        closed();
      });
    return () => {
      gone = true;
      un();
      if (frame !== 0) cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [id, on]);

  return live;
}
