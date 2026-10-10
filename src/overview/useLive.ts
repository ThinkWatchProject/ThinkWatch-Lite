import { useEffect, useReducer, useRef } from "react";
import { call } from "@/control";
import { subscribe } from "@/lib/tauriEvent";
import { isRunning, parseCoreState } from "@/coreState";
import { textOf } from "@/i18n";
import type { CoreEvent, HistoryRow } from "@/types";
import { liveText } from "./useLive.i18n";

/**
 * 实时档一格多宽。十秒：十分钟铺六十格。
 *
 * **格宽跟着图的宽度走，不跟着「想看多细」走。**指标卡上的小图两百多像素宽，六十格时
 * 一格四个像素，请求柱还是柱子；再细下去，多出来的格子在屏幕上分不出来，只是多算。
 * 历史档把一张图压在三四十格上下也是这个道理（见 `bucketFor`）。
 */
export const LIVE_BUCKET_MS = 10_000;

/**
 * 实时曲线的平滑尺度（高斯核的 σ）：十五秒，一格半。
 *
 * **一格只数它自己那几秒的话，画出来是一排针。**请求是一个一个落下来
 * 的：落到的那一格冲到几万，左右两格都是 0。加宽格子救不了它 —— 只要
 * 到达是离散的，多宽的桶都是梳子。
 *
 * 换成方形滑窗也不行：一条请求进窗口是一个台阶、出窗口又是一个台阶，
 * 针于是变成城墙。**要平滑，核本身必须是平滑的。**高斯核把一条请求摊
 * 成一个鼓包，叠起来天然连续。
 *
 * **σ 按屏幕上的宽度定，不按秒数定。**要抹平的是屏幕上的针：一格四个像素，一格半
 * 的 σ 是六个像素，一条请求在小图上是一个看得出、又不糊成一片的鼓包。
 *
 * 核归一到总权重 1，所以纵轴读作**速率**（见 `liveRate`）。这也是实时档
 * 该问的问题 —— 此刻跑多快，而不是某几秒恰好落了多少。
 */
export const LIVE_SIGMA_MS = 15_000;

/** 核铺多宽。三个 σ 之外的权重不到千分之五，铺了也是白铺。 */
export const LIVE_REACH_MS = 3 * LIVE_SIGMA_MS;

/**
 * 曲线多久往前走一步：半秒，二十分之一格。
 *
 * **不等于格宽。**按格宽重画的话，整条曲线每十秒向左跳一格 —— 那不是在滑，是在跳。
 *
 * 也**不必更密**：一步二十分之一格，屏幕上不到一个像素，看起来已经是连续
 * 的了；再密只是把同一张图更频繁地重画一遍。
 *
 * 能这么做的前提是核是连续的：高斯在任意时刻都求得出值，格子不必卡在
 * 格宽的整数倍上。所以每一步把格子按当下的时间重铺一遍，曲线就是平移
 * 过去的，不会因为重新分桶而闪。
 *
 * 这个节拍**只管往左走**。请求开始、落地、价钱补到，都当场重画 —— 不然
 * 一条请求要等到下一步才冒出来。
 */
export const LIVE_FRAME_MS = 500;

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
  /** 四类 token 的合计 */
  tokens: number;
  /** 其中输出的那部分。**其余是输入**（含命中缓存、写入缓存的），和汇总的「输入」同一个口径 */
  output: number;
  /**
   * 微分。价钱比用量晚一拍到（`request_priced`）：没到之前是 `undefined`；到了却是
   * 空的是 `null` —— 用量是有的，模型不在价目表里（不计费的上游记的是 0）
   */
  cost?: number | null;
  /** 这笔费用是估算的（请求在响应结束前断开，输出只算到断开时） */
  estimated?: boolean;
}

/**
 * 一次请求的结局：结束、失败、客户端取消都算，本地应答不算（core 另发一个事件）——
 * 和汇总的请求数同一个口径。**带着 id**：事件流和补回来的历史会说到同一次，要能去重
 */
export interface LiveEnd {
  id: number;
  at: number;
  failed: boolean;
}

/**
 * 从库里补回来的那一段，并进事件流攒下的样本。
 *
 * 事件流和库会说到同一次请求，**谁先到都有可能**（落库和事件是两条路），所以按 id
 * 去重：事件流上已经画了的不画第二遍。**去重按表查，不逐条比**：补一次是两千行对
 * 两千个样本，逐条比就是四百万次。
 *
 * **事件流上画了、价钱却没等到的，按库里的补上。**这条路走的正是事件流丢过事件之后
 * （`events_dropped`），丢掉的那一段里可能就有它的 `request_priced`：不补的话，它在
 * 窗口里一直算「价钱还没到」，那个模型的金额一直是下限。落了库的都已经算过价。
 *
 * `skew`：core 的时钟减这边的时钟。`cut`：窗口的左边（这边的时钟）。导出给测试用。
 */
export function refill(
  samples: readonly LiveSample[],
  ends: readonly LiveEnd[],
  rows: readonly HistoryRow[],
  { skew, cut, unknownModel }: { skew: number; cut: number; unknownModel: string },
): { samples: LiveSample[]; ends: LiveEnd[] } {
  const drawn = new Map(samples.map((s) => [s.id, s]));
  const ended = new Set(ends.map((f) => f.id));
  const seeded: LiveSample[] = [];
  const seededEnds: LiveEnd[] = [];
  for (const r of rows) {
    // 本地应答没到上游，和别处的汇总一样不算
    if (r.local) continue;
    // 和事件流同一个口径：落在结束的那一刻，换到这边的时钟上
    const at = r.at_ms + (r.duration_ms ?? 0) - skew;
    if (at < cut) continue;
    if (!ended.has(r.id)) seededEnds.push({ id: r.id, at, failed: r.error != null });
    const x = drawn.get(r.id);
    if (x) {
      // 和 `request_priced` 一样补在那一格原来的位置上
      if (x.cost === undefined) {
        x.cost = r.cost_micros;
        x.estimated = r.cost_estimated;
      }
      continue;
    }
    const tokens =
      (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
    // 没有用量的那些事件流也不画，补的时候一样跳过
    if (tokens === 0) continue;
    seeded.push({
      id: r.id,
      at,
      model: r.model || unknownModel,
      tokens,
      output: r.output_tokens ?? 0,
      // 落了库的都已经算过价：有用量却是空的，就是未定价
      cost: r.cost_micros,
      estimated: r.cost_estimated,
    });
  }
  return {
    // **按时间排好**：`request_priced` 是从末尾倒着找那一条的
    samples: [...seeded, ...samples].sort((a, b) => a.at - b.at),
    ends: [...seededEnds, ...ends].sort((a, b) => a.at - b.at),
  };
}

/**
 * 按帧合并的重画。一阵并发的请求一起落地时，一帧里只画一次。
 */
function useFrame(): [() => void, () => void] {
  const [, frame] = useReducer((n: number) => n + 1, 0);
  const raf = useRef<number | null>(null);
  const soon = useRef(() => {
    if (raf.current === null)
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        frame();
      });
  });
  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );
  return [frame, soon.current];
}

/**
 * 此刻有几个请求在跑。概览的页头一直显示它，不只在实时档。
 *
 * **从 core 的快照起步，之后跟着事件流加减。**只靠事件流数有两处数不对：挂上
 * 之前就开始了的请求，开始事件早就过去了，一直少数到它结束；core 重启时正在跑
 * 的请求再也不会有结局，一直挂在「进行中」里。所以挂上时问一次「此刻还在跑
 * 的」，core 重启回来再问一次（`resync`），平时照旧按事件加减。
 *
 * **快照在路上的时候事件照样在来。**它是 core 在某一刻拍下的，到这边时已经晚了
 * 一截：这中间开始的它没有，这中间结束的它还有。所以从问出去的那一刻起，把事件
 * 流上见到的开始和结局都记下来（`since`），快照到了再合在一起：快照里的，加上
 * 中途开始的，减去中途结束的。
 *
 * **别拿 `Status::in_flight`**：那个从连接进数据面就算，鉴权失败、排队的都在
 * 里面。
 */
export function useInFlight(): number {
  const flying = useRef(new Set<number>());
  const [, soon] = useFrame();

  useEffect(() => {
    let alive = true;
    let since: { started: Set<number>; ended: Set<number> } | null = null;
    const start = (id: number) => {
      flying.current.add(id);
      since?.started.add(id);
    };
    const end = (id: number) => {
      flying.current.delete(id);
      since?.ended.add(id);
    };
    const un = subscribe<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "request_started") start(ev.id);
      else if (
        ev.kind === "request_finished" ||
        ev.kind === "request_cancelled" ||
        ev.kind === "request_failed"
      )
        end(ev.id);
      else if (ev.kind === "events_dropped") {
        // 丢过事件：重新对账
        void resync();
        return;
      } else return;
      soon();
    });
    const resync = async () => {
      const mark = { started: new Set<number>(), ended: new Set<number>() };
      since = mark;
      try {
        // **等订阅真的挂上再问。**`listen` 是异步注册的：先问的话，快照和
        // 订阅之间结束的请求，它的结局谁都没收到，就一直挂在「进行中」
        await un.ready;
        const open = await call("InFlight", null);
        // 等的这会儿 core 停了、或者又开始了一次对账：这份作废
        if (!alive || since !== mark) return;
        const next = new Set(mark.started);
        for (const r of open.requests) next.add(r.id);
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
    const unState = subscribe<string>("core-state", (e) => {
      if (isRunning(parseCoreState(e.payload))) {
        void resync();
      } else {
        since = null;
        flying.current.clear();
        soon();
      }
    });
    return () => {
      alive = false;
      un();
      unState();
    };
  }, [soon]);

  return flying.current.size;
}

/**
 * 最近这一段（实时档的十分钟），直接从事件流上攒出来。
 *
 * **不查库、不轮询。**概览别的部分问的是 SQLite，而那条路的最小延迟是
 * 「落库 + 下一次刷新」；实时档要的是请求到达的那一刻曲线就动，那只有
 * 事件流给得了。每条请求要画的东西都在它的结局里：模型和用量一起到
 * （`request_finished`、`request_failed`、`request_cancelled`）。
 *
 * **模型名从结局里拿，不从开始事件里记。**这个钩子只在实时档挂上，打开的
 * 那一刻正在跑的请求，它的开始事件早就过去了。
 *
 * 金额比用量晚一拍：它是存储层落库时按价目表算的，core 算完会补一条
 * `request_priced`。所以实时档也画得出费用，只是那一格会在请求结束之后
 * 的几十毫秒里先长出 token、再长出费用。
 *
 * 那个定时器**不是轮询**：它什么都不查，只是让曲线往左走。不走的话，
 * 一段没有请求的空闲看起来会像界面卡住了。只在这一档挂着。
 *
 * **窗口藏着的时候它停下。**看不见的图每半秒重画一遍是白画（实时档是概览的默认档，
 * 最小化一夜就是七万多次）。事件照样记、窗口外的照样丢，露面的那一刻按当下的时间
 * 重铺一次，再接着走。
 *
 * **进这一档先把已经发生过的那一段补上。**只挂事件流的话，曲线永远从切进来
 * 的那一刻开始长 —— 刚打完一批请求切过来，看到的是一张空图，而这几分钟
 * 明明有几十次。请求发生过，没人看着不等于没发生。
 *
 * 交出来两样：`samples` 是带用量的请求（token、费用两张图），`ends` 是每一次结局
 * （请求数、失败数）。
 */
export function useLiveWindow(active: boolean, windowMs: number) {
  const samples = useRef<LiveSample[]>([]);
  const ends = useRef<LiveEnd[]>([]);
  const [frame, soon] = useFrame();

  useEffect(() => {
    if (!active) {
      // 切走就把攒的东西扔掉。**留着的话，切回来画的是一段过期的窗口**
      // —— 重新进来时按当下的时间补，比拿旧样本往左挪准。
      samples.current = [];
      ends.current = [];
      return;
    }
    let alive = true;
    /*
      事件流和补回来的历史会说到同一次请求，而且**谁先到都有可能**：落库
      和事件是两条路。所以两边落样本之前都要看一眼对方记过没有。
    */
    const counted = (id: number) => samples.current.some((s) => s.id === id);
    const endedAlready = (id: number) => ends.current.some((f) => f.id === id);
    const hidden = () => document.visibilityState === "hidden";
    /** 丢掉窗口外的 */
    const trim = () => {
      const cut = Date.now() - windowMs;
      samples.current = samples.current.filter((s) => s.at >= cut);
      ends.current = ends.current.filter((f) => f.at >= cut);
    };
    const land = (id: number, model: string | null | undefined, u: { input: number; output: number; cache_read: number; cache_write: number }) => {
      if (counted(id)) return;
      samples.current.push({
        id,
        at: Date.now(),
        model: model || textOf(liveText).unknownModel,
        tokens: u.input + u.output + u.cache_read + u.cache_write,
        output: u.output,
      });
    };
    /** 请求的结局：结束、失败、取消。请求数和失败数从这里数 */
    const end = (id: number, failed: boolean) => {
      if (!endedAlready(id)) ends.current.push({ id, at: Date.now(), failed });
    };
    const un = subscribe<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "request_finished" || ev.kind === "request_cancelled") {
        // 取消的也画进曲线：**上游已经为它计了费**，那些 token 真实发生过
        if (ev.usage) land(ev.id, ev.model, ev.usage);
        end(ev.id, false);
      } else if (ev.kind === "request_priced") {
        // 费用补在那一格原来的位置上，**不是补在「现在」** —— 它说的
        // 是那次请求的费用，而那次请求发生在几十毫秒之前。
        // 倒着找：刚落地的那条几乎总在末尾。
        for (let i = samples.current.length - 1; i >= 0; i--) {
          const x = samples.current[i];
          if (x && x.id === ev.id) {
            x.cost = ev.cost_micros ?? null;
            x.estimated = ev.cost_estimated === true;
            break;
          }
        }
      } else if (ev.kind === "request_failed") {
        // 断在中间的失败也带着用量：**上游已经为它计了费**，曲线上要有它
        if (ev.usage) land(ev.id, ev.model, ev.usage);
        end(ev.id, true);
      } else if (ev.kind === "events_dropped") {
        // 丢过事件：丢掉的结局从库里补进曲线。落库要一点时间，等一会儿再补；
        // 补的时候按 id 去重，事件流上已经画了的不会画两遍，它们没等到的价钱
        // 按库里的补上（见 `refill`）
        setTimeout(() => void seed(), REFILL_MS);
        return;
      } else {
        return;
      }
      // 藏着的时候走的那个定时器停着，窗口外的没人丢：在这里丢，不攒
      if (hidden()) trim();
      soon();
    });
    /*
      先挂事件流再补历史：反过来的话，这两者之间结束的请求谁都不记。
    */
    const seed = async () => {
      try {
        // 挂上了再补 —— `listen` 是异步注册的
        await un.ready;
        /*
          **库里的时刻是 core 的时钟，图的横轴是这边的时钟。**连的是另一台机器上
          的 core 时，两边不一定对得上：差出一分钟，补回来的这一段就整段错开一分钟，
          和事件流上画的接不上。所以先问 core 此刻几点（`/in-flight` 带着它），
          起点按它算，每一条再按两边的差挪回这边的时钟上。
        */
        const { now_ms: coreNow } = await call("InFlight", null);
        const skew = coreNow - Date.now();
        /*
          **按时间取，不按条数取。**十分钟里有多少条请求说不准：取固定的
          条数，忙的时候补不满一个窗口，闲的时候又白拿一堆窗口外的。

          起点再往前让一个窗口。库里记的是请求**开始**的时刻，曲线上画的
          是**结束**的时刻；带长思考的请求跑上一两分钟是常事，它开始于
          窗口之外、结束在窗口之内，也该补上。
        */
        const rows = await call("History", {
          limit: 2000,
          from_ms: coreNow - 2 * windowMs,
        });
        if (!alive) return;
        // 并进来、去重、补上没等到的价钱，见 `refill`
        const next = refill(samples.current, ends.current, rows, {
          skew,
          cut: Date.now() - windowMs,
          unknownModel: textOf(liveText).unknownModel,
        });
        samples.current = next.samples;
        ends.current = next.ends;
        frame();
      } catch {
        // 读不到就只画事件流那一半，和补这一段之前一样
      }
    };
    void seed();

    const step = () => {
      trim();
      frame();
    };
    let h: ReturnType<typeof setInterval> | null = null;
    const walk = () => {
      if (h === null) h = setInterval(step, LIVE_FRAME_MS);
    };
    const halt = () => {
      if (h !== null) clearInterval(h);
      h = null;
    };
    // 藏起来就停；露面时先按当下的时间重铺一次（这一下就把藏着的那段补齐了），再接着走
    const onVisibility = () => {
      if (hidden()) halt();
      else if (h === null) {
        step();
        walk();
      }
    };
    if (!hidden()) walk();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      un();
      halt();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, windowMs, frame, soon]);

  return {
    samples: samples.current,
    ends: ends.current,
  };
}
