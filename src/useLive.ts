import { useEffect, useReducer, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { CoreEvent } from "./types";

/** 实时曲线一格多宽。一秒 —— 再粗就看不出「刚才那一下」了。 */
export const LIVE_BUCKET_MS = 1_000;

export interface LiveSample {
  id: number;
  at: number;
  model: string;
  tokens: number;
  /** 价钱比用量晚一拍到（`request_priced`）。没到之前是 `undefined` */
  cost?: number;
}

/**
 * 最近这两分钟，直接从事件流上攒出来。
 *
 * **不查库、不轮询。**概览别的部分问的是 SQLite，而那条路的最小延迟是
 * 「落库 + 下一次刷新」；实时档要的是请求到达的那一刻曲线就动，那只有
 * 事件流给得了。每条请求需要的三样东西事件里都有：`request_started`
 * 带模型，`request_finished` 带用量，两者靠 id 对上。
 *
 * 金额比用量晚一拍：它是存储层落库时按价目表算的，core 算完会补一条
 * `request_priced`。所以实时档也画得出花费，只是那一格会在请求结束之后
 * 的几十毫秒里先长出 token、再长出钱。
 *
 * 那个每秒一次的定时器**不是轮询**：它什么都不查，只是让曲线往左走。
 * 不走的话，一段没有请求的空闲看起来会像界面卡住了。只在这一档挂着。
 */
export function useLive(active: boolean, windowMs: number) {
  const samples = useRef<LiveSample[]>([]);
  const fails = useRef<number[]>([]);
  /** id → 模型。`request_started` 知道，`request_finished` 不知道 */
  const model = useRef(new Map<number, string>());
  const flying = useRef(new Set<number>());
  const [, frame] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!active) {
      // 切走就把攒的东西扔掉。**留着的话，切回来会看到一段假的历史**
      // —— 那两分钟里其实没人在看，而曲线会画得像一直在跑。
      samples.current = [];
      fails.current = [];
      model.current.clear();
      flying.current.clear();
      return;
    }
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "request_started") {
        model.current.set(ev.id, ev.model || "未知模型");
        flying.current.add(ev.id);
      } else if (ev.kind === "request_finished" || ev.kind === "request_cancelled") {
        // 取消的也画进曲线：**上游已经为它计了费**，那些 token 真实发生过
        flying.current.delete(ev.id);
        if (ev.usage) {
          const u = ev.usage;
          samples.current.push({
            id: ev.id,
            at: Date.now(),
            model: model.current.get(ev.id) ?? "未知模型",
            tokens: u.input + u.output + u.cache_read + u.cache_write,
          });
        }
        model.current.delete(ev.id);
      } else if (ev.kind === "request_priced") {
        // 价钱补在那一格原来的位置上，**不是补在「现在」** —— 它说的
        // 是那次请求花了多少，而那次请求发生在几十毫秒之前。
        // 倒着找：刚落地的那条几乎总在末尾。
        for (let i = samples.current.length - 1; i >= 0; i--) {
          const x = samples.current[i];
          if (x && x.id === ev.id) {
            if (ev.cost_micros != null) x.cost = ev.cost_micros;
            break;
          }
        }
      } else if (ev.kind === "request_failed") {
        flying.current.delete(ev.id);
        // 断在中间的失败也带着用量：**上游已经为它计了费**，曲线上要有它
        if (ev.usage) {
          const u = ev.usage;
          samples.current.push({
            id: ev.id,
            at: Date.now(),
            model: model.current.get(ev.id) ?? "未知模型",
            tokens: u.input + u.output + u.cache_read + u.cache_write,
          });
        }
        model.current.delete(ev.id);
        fails.current.push(Date.now());
      }
    });
    const h = setInterval(() => {
      const cut = Date.now() - windowMs;
      samples.current = samples.current.filter((s) => s.at >= cut);
      fails.current = fails.current.filter((t) => t >= cut);
      frame();
    }, LIVE_BUCKET_MS);
    return () => {
      void un.then((f) => f());
      clearInterval(h);
    };
  }, [active, windowMs]);

  return {
    samples: samples.current,
    fails: fails.current,
    inFlight: flying.current.size,
  };
}
