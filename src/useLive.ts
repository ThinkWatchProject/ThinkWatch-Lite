import { useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { textOf } from "@/i18n";
import type { CoreEvent, HistoryRow } from "./types";
import { liveText } from "./useLive.i18n";

/** 实时曲线一格多宽。一秒 —— 再粗就看不出「刚才那一下」了。 */
export const LIVE_BUCKET_MS = 1_000;

/**
 * 实时曲线的平滑尺度（高斯核的 σ）。
 *
 * **一格只数它自己那一秒的话，画出来是一排针。**两分钟一百二十格，
 * 而请求是一个一个落下来的：落到的那一格冲到几万，左右两格都是 0。
 * 加宽格子救不了它 —— 只要到达是离散的，多宽的桶都是梳子。
 *
 * 换成方形滑窗也不行：一条请求进窗口是一个台阶、出窗口又是一个台阶，
 * 针于是变成城墙。**要平滑，核本身必须是平滑的。**高斯核把一条请求摊
 * 成一个鼓包，叠起来天然连续。
 *
 * 核归一到总权重 1，所以纵轴读作**速率**：一格 = 那一秒的 token/秒。
 * 这也是实时档该问的问题 —— 此刻跑多快，而不是某一秒恰好落了多少。
 */
export const LIVE_SIGMA_MS = 3_000;

/** 核铺多宽。三个 σ 之外的权重不到千分之五，铺了也是白铺。 */
export const LIVE_REACH_MS = 3 * LIVE_SIGMA_MS;

/**
 * 曲线多久往前走一步。
 *
 * **不等于格宽。**按格宽（一秒）重画的话，整条曲线每秒向左跳一格 ——
 * 七百多像素宽的图上是六个像素，那不是在滑，是掉到 1fps 的动画。
 *
 * 能这么做的前提是核是连续的：高斯在任意时刻都求得出值，格子不必卡在
 * 整秒上。所以每一帧把格子按当下的时间重铺一遍，曲线就是平移过去的，
 * 不会因为重新分桶而闪。
 */
export const LIVE_FRAME_MS = 100;

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
 * 那个定时器**不是轮询**：它什么都不查，只是让曲线往左走。不走的话，
 * 一段没有请求的空闲看起来会像界面卡住了。只在这一档挂着。
 *
 * **进这一档先把已经发生过的那两分钟补上。**只挂事件流的话，曲线永远
 * 从切进来的那一刻开始长 —— 刚打完一批请求切过来，看到的是一张空图加
 * 一句「等待请求」，而顶上的数字说有几十次。请求发生过，没人看着不
 * 等于没发生；流量列表早就是这么填的（见 `recent_requests`）。
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
      // 切走就把攒的东西扔掉。**留着的话，切回来画的是一段过期的窗口**
      // —— 重新进来时按当下的时间补，比拿旧样本往左挪准。
      samples.current = [];
      fails.current = [];
      model.current.clear();
      flying.current.clear();
      return;
    }
    let alive = true;
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "request_started") {
        model.current.set(ev.id, ev.model || textOf(liveText).unknownModel);
        flying.current.add(ev.id);
      } else if (ev.kind === "request_finished" || ev.kind === "request_cancelled") {
        // 取消的也画进曲线：**上游已经为它计了费**，那些 token 真实发生过
        flying.current.delete(ev.id);
        if (ev.usage) {
          const u = ev.usage;
          samples.current.push({
            id: ev.id,
            at: Date.now(),
            model: model.current.get(ev.id) ?? textOf(liveText).unknownModel,
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
            model: model.current.get(ev.id) ?? textOf(liveText).unknownModel,
            tokens: u.input + u.output + u.cache_read + u.cache_write,
          });
        }
        model.current.delete(ev.id);
        fails.current.push(Date.now());
      }
    });
    /*
      先挂事件流再补历史：反过来的话，这两者之间结束的请求谁都不记。
      两边都记到的按 id 去重 —— 落库和事件是同一次请求的两条路。
    */
    void (async () => {
      try {
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const rows = await invoke<HistoryRow[]>("recent_requests", {
          limit: 200,
        });
        if (!alive) return;
        const cut = Date.now() - windowMs;
        const seen = new Set(samples.current.map((s) => s.id));
        const seeded: LiveSample[] = [];
        for (const r of rows) {
          if (r.at_ms < cut || seen.has(r.id)) continue;
          const tokens =
            (r.input_tokens ?? 0) +
            (r.output_tokens ?? 0) +
            (r.cache_read_tokens ?? 0) +
            (r.cache_write_tokens ?? 0);
          // 没有用量的那些事件流也不画，补的时候一样跳过
          if (tokens === 0) continue;
          seeded.push({
            id: r.id,
            at: r.at_ms,
            model: r.model || textOf(liveText).unknownModel,
            tokens,
            ...(r.cost_micros != null ? { cost: r.cost_micros } : {}),
          });
        }
        // **按时间排好**：`request_priced` 是从末尾倒着找那一条的
        samples.current = [...seeded, ...samples.current].sort(
          (a, b) => a.at - b.at,
        );
        frame();
      } catch {
        // 读不到就只画事件流那一半，和补这一段之前一样
      }
    })();

    const h = setInterval(() => {
      const cut = Date.now() - windowMs;
      samples.current = samples.current.filter((s) => s.at >= cut);
      fails.current = fails.current.filter((t) => t >= cut);
      frame();
    }, LIVE_FRAME_MS);
    return () => {
      alive = false;
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
