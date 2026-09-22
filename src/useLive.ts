import { useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { textOf } from "@/i18n";
import type { CoreEvent, HistoryRow } from "./types";
import { liveText } from "./useLive.i18n";

/**
 * 实时曲线一格多宽。五秒：十分钟铺一百二十格。
 *
 * **格宽跟着窗口走，不跟着「想看多细」走。**图就那么宽，一百二十格时
 * 一格六七个像素；再细下去，多出来的格子在屏幕上分不出来，只是多算。
 * 历史档把格数压在 120 上下也是这个道理（见 `bucketFor`）。
 */
export const LIVE_BUCKET_MS = 5_000;

/**
 * 实时曲线的平滑尺度（高斯核的 σ）：三格。
 *
 * **一格只数它自己那几秒的话，画出来是一排针。**请求是一个一个落下来
 * 的：落到的那一格冲到几万，左右两格都是 0。加宽格子救不了它 —— 只要
 * 到达是离散的，多宽的桶都是梳子。
 *
 * 换成方形滑窗也不行：一条请求进窗口是一个台阶、出窗口又是一个台阶，
 * 针于是变成城墙。**要平滑，核本身必须是平滑的。**高斯核把一条请求摊
 * 成一个鼓包，叠起来天然连续。
 *
 * **σ 按格数定，不按秒数定。**要抹平的是屏幕上的针，针有多细取决于一格
 * 占几个像素。窗口拉长、格子放宽，σ 跟着放宽，一条请求在图上还是差不多
 * 宽的一个鼓包。
 *
 * 核归一到总权重 1，所以纵轴读作**速率**（见 `liveRate`）。这也是实时档
 * 该问的问题 —— 此刻跑多快，而不是某几秒恰好落了多少。
 */
export const LIVE_SIGMA_MS = 3 * LIVE_BUCKET_MS;

/** 核铺多宽。三个 σ 之外的权重不到千分之五，铺了也是白铺。 */
export const LIVE_REACH_MS = 3 * LIVE_SIGMA_MS;

/**
 * 曲线多久往前走一步：十分之一格。
 *
 * **不等于格宽。**按格宽重画的话，整条曲线每五秒向左跳一格 —— 八百像素
 * 宽的图上是六七个像素，那不是在滑，是在跳。
 *
 * 也**不必更密**：一步十分之一格，屏幕上不到一个像素，看起来已经是连续
 * 的了；再密只是把同一张图更频繁地重画一遍。
 *
 * 能这么做的前提是核是连续的：高斯在任意时刻都求得出值，格子不必卡在
 * 格宽的整数倍上。所以每一步把格子按当下的时间重铺一遍，曲线就是平移
 * 过去的，不会因为重新分桶而闪。
 *
 * 这个节拍**只管往左走**。请求开始、落地、价钱补到，都当场重画 —— 不然
 * 一条请求要等到下一步才冒出来。
 */
export const LIVE_FRAME_MS = LIVE_BUCKET_MS / 10;

/** 事件流丢过事件之后，等这么久再从库里补：丢掉的那些结局落库要一点时间 */
const REFILL_MS = 2_500;

/** 连续高斯的积分是 σ√2π。除掉它、再换算到秒，核就读作「每秒多少」 */
const PER_SECOND = 1_000 / (LIVE_SIGMA_MS * Math.sqrt(2 * Math.PI));
const TWO_SIGMA_SQ = 2 * LIVE_SIGMA_MS * LIVE_SIGMA_MS;

/**
 * 量为 `amount` 的一条请求，在离它 `d` 毫秒的时刻贡献多少速率（每秒）。
 *
 * **归一到秒，不归一到格。**沿时间积分回来正好是 `amount`，和格子多宽、
 * 落在哪儿都无关。按格归一的话，一格一秒时碰巧读作「每秒」，格子一放宽，
 * 纵轴就悄悄变成了「每五秒」，而刻度上写的还是 token/秒。
 */
export function liveRate(amount: number, d: number): number {
  return amount * PER_SECOND * Math.exp(-(d * d) / TWO_SIGMA_SQ);
}

export interface LiveSample {
  id: number;
  /** 用量落地的时刻：请求**结束**的时候。事件流只在那时才知道用量 */
  at: number;
  model: string;
  tokens: number;
  /** 价钱比用量晚一拍到（`request_priced`）。没到之前是 `undefined` */
  cost?: number;
}

/** 一次失败。**带着 id**：事件流和补回来的历史会说到同一次，要能去重 */
export interface LiveFail {
  id: number;
  at: number;
}

/**
 * 最近这十分钟，直接从事件流上攒出来。
 *
 * **不查库、不轮询。**概览别的部分问的是 SQLite，而那条路的最小延迟是
 * 「落库 + 下一次刷新」；实时档要的是请求到达的那一刻曲线就动，那只有
 * 事件流给得了。每条请求要画的东西都在它的结局里：模型和用量一起到
 * （`request_finished`、`request_failed`、`request_cancelled`）。
 *
 * **模型名从结局里拿，不从开始事件里记。**这个钩子只在概览开着时才挂
 * 上，打开的那一刻正在跑的请求，它的开始事件早就过去了；以前按 id 去
 * 找开始时记下的模型，这些请求就全落进了「未知模型」那一层。
 * `request_started` 现在只用来数「进行中」（怎么数见 `resync`）。
 *
 * 金额比用量晚一拍：它是存储层落库时按价目表算的，core 算完会补一条
 * `request_priced`。所以实时档也画得出花费，只是那一格会在请求结束之后
 * 的几十毫秒里先长出 token、再长出钱。
 *
 * 那个定时器**不是轮询**：它什么都不查，只是让曲线往左走。不走的话，
 * 一段没有请求的空闲看起来会像界面卡住了。只在这一档挂着。
 *
 * **进这一档先把已经发生过的那十分钟补上。**只挂事件流的话，曲线永远
 * 从切进来的那一刻开始长 —— 刚打完一批请求切过来，看到的是一张空图加
 * 一句「等待请求」，而顶上的数字说有几十次。请求发生过，没人看着不
 * 等于没发生；流量列表早就是这么填的（见 `recent_requests`）。
 */
export function useLive(active: boolean, windowMs: number) {
  const samples = useRef<LiveSample[]>([]);
  const fails = useRef<LiveFail[]>([]);
  const flying = useRef(new Set<number>());
  const [, frame] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!active) {
      // 切走就把攒的东西扔掉。**留着的话，切回来画的是一段过期的窗口**
      // —— 重新进来时按当下的时间补，比拿旧样本往左挪准。
      samples.current = [];
      fails.current = [];
      flying.current.clear();
      return;
    }
    let alive = true;
    /*
      事件当场重画，**按帧合并**：一阵并发的请求一起落地时，一帧里只画
      一次。
    */
    let raf: number | null = null;
    const soon = () => {
      if (raf === null)
        raf = requestAnimationFrame(() => {
          raf = null;
          frame();
        });
    };
    /*
      事件流和补回来的历史会说到同一次请求，而且**谁先到都有可能**：落库
      和事件是两条路。所以两边落样本之前都要看一眼对方记过没有。
    */
    const counted = (id: number) => samples.current.some((s) => s.id === id);
    const failedAlready = (id: number) => fails.current.some((f) => f.id === id);
    /*
      **「进行中」从 core 的快照起步，之后跟着事件流加减。**

      只靠事件流数有两处数不对：挂上之前就开始了的请求，开始事件早就过去
      了，一直少数到它结束；core 重启时正在跑的请求再也不会有结局，一直挂在
      「进行中」里。所以挂上时问一次「此刻还在跑的」，core 重启回来再问一次
      （`resync`），平时照旧按事件加减。

      **快照在路上的时候事件照样在来。**它是 core 在某一刻拍下的，到这边时
      已经晚了一截：这中间开始的它没有，这中间结束的它还有。所以从问出去的
      那一刻起，把事件流上见到的开始和结局都记下来（`since`），快照到了再
      合在一起：快照里的，加上中途开始的，减去中途结束的。
    */
    let since: { started: Set<number>; ended: Set<number> } | null = null;
    const start = (id: number) => {
      flying.current.add(id);
      since?.started.add(id);
    };
    const end = (id: number) => {
      flying.current.delete(id);
      since?.ended.add(id);
    };
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "request_started") {
        start(ev.id);
      } else if (ev.kind === "request_finished" || ev.kind === "request_cancelled") {
        // 取消的也画进曲线：**上游已经为它计了费**，那些 token 真实发生过
        end(ev.id);
        if (ev.usage && !counted(ev.id)) {
          const u = ev.usage;
          samples.current.push({
            id: ev.id,
            at: Date.now(),
            model: ev.model || textOf(liveText).unknownModel,
            tokens: u.input + u.output + u.cache_read + u.cache_write,
          });
        }
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
        end(ev.id);
        // 断在中间的失败也带着用量：**上游已经为它计了费**，曲线上要有它
        if (ev.usage && !counted(ev.id)) {
          const u = ev.usage;
          samples.current.push({
            id: ev.id,
            at: Date.now(),
            model: ev.model || textOf(liveText).unknownModel,
            tokens: u.input + u.output + u.cache_read + u.cache_write,
          });
        }
        if (!failedAlready(ev.id)) fails.current.push({ id: ev.id, at: Date.now() });
      } else if (ev.kind === "events_dropped") {
        /*
          **丢过事件：进行中的重新对账，丢掉的结局从库里补进曲线。**落库要一点
          时间，等一会儿再补；补的时候按 id 去重，事件流上已经画了的不会画两遍。
        */
        void resync();
        setTimeout(() => void seed(), REFILL_MS);
        return;
      } else {
        return;
      }
      soon();
    });
    const resync = async () => {
      const mark = { started: new Set<number>(), ended: new Set<number>() };
      since = mark;
      try {
        // **等订阅真的挂上再问。**`listen` 是异步注册的：先问的话，快照和
        // 订阅之间结束的请求，它的结局谁都没收到，就一直挂在「进行中」
        await un;
        const open = await invoke<CoreEvent[]>("in_flight_requests");
        // 等的这会儿 core 停了、或者又开始了一次对账：这份作废
        if (!alive || since !== mark) return;
        const next = new Set(mark.started);
        for (const ev of open) if (ev.kind === "request_started") next.add(ev.id);
        for (const id of mark.ended) next.delete(id);
        flying.current = next;
        soon();
      } catch {
        // 问不到就接着按事件流数，和有这份快照之前一样
      } finally {
        if (since === mark) since = null;
      }
    };
    void resync();
    /*
      **core 不在跑的时候，谁都不在「进行中」。**它一停，正在跑的请求就断
      了，而它们再也不会有结局；回来的时候（`running:<pid>`）重新对一遍。
    */
    const unState = listen<string>("core-state", (e) => {
      if (e.payload.startsWith("running")) {
        void resync();
      } else {
        since = null;
        flying.current.clear();
        soon();
      }
    });
    /*
      先挂事件流再补历史：反过来的话，这两者之间结束的请求谁都不记。
    */
    const seed = async () => {
      try {
        // 挂上了再补 —— `listen` 是异步注册的，理由同上
        await un;
        /*
          **按时间取，不按条数取。**十分钟里有多少条请求说不准：取固定的
          条数，忙的时候补不满一个窗口，闲的时候又白拿一堆窗口外的。

          起点再往前让一个窗口。库里记的是请求**开始**的时刻，曲线上画的
          是**结束**的时刻；带长思考的请求跑上一两分钟是常事，它开始于
          窗口之外、结束在窗口之内，也该补上。
        */
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const rows = await invoke<HistoryRow[]>("recent_requests", {
          limit: 2000,
          fromMs: Date.now() - 2 * windowMs,
        });
        if (!alive) return;
        const cut = Date.now() - windowMs;
        const seeded: LiveSample[] = [];
        const seededFails: LiveFail[] = [];
        for (const r of rows) {
          // 和事件流同一个口径：落在结束的那一刻
          const at = r.at_ms + (r.duration_ms ?? 0);
          if (at < cut) continue;
          if (r.error && !failedAlready(r.id)) seededFails.push({ id: r.id, at });
          if (counted(r.id)) continue;
          const tokens =
            (r.input_tokens ?? 0) +
            (r.output_tokens ?? 0) +
            (r.cache_read_tokens ?? 0) +
            (r.cache_write_tokens ?? 0);
          // 没有用量的那些事件流也不画，补的时候一样跳过
          if (tokens === 0) continue;
          seeded.push({
            id: r.id,
            at,
            model: r.model || textOf(liveText).unknownModel,
            tokens,
            ...(r.cost_micros != null ? { cost: r.cost_micros } : {}),
          });
        }
        // **按时间排好**：`request_priced` 是从末尾倒着找那一条的
        samples.current = [...seeded, ...samples.current].sort(
          (a, b) => a.at - b.at,
        );
        fails.current = [...seededFails, ...fails.current];
        frame();
      } catch {
        // 读不到就只画事件流那一半，和补这一段之前一样
      }
    };
    void seed();

    const h = setInterval(() => {
      const cut = Date.now() - windowMs;
      samples.current = samples.current.filter((s) => s.at >= cut);
      fails.current = fails.current.filter((f) => f.at >= cut);
      frame();
    }, LIVE_FRAME_MS);
    return () => {
      alive = false;
      void un.then((f) => f());
      void unState.then((f) => f());
      clearInterval(h);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [active, windowMs]);

  return {
    samples: samples.current,
    fails: fails.current,
    inFlight: flying.current.size,
  };
}
