import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "@/control";
import { textOf } from "@/i18n";
import {
  applyEvent,
  applyInFlight,
  interruptInFlight,
  type CoreEvent,
  type HistoryRow,
  type LocalEvent,
  type RequestRow,
  type ScanFinding,
  type SeenSince,
} from "./types";
import { marksFromEvents } from "./security/marks";
import { requestsText } from "./useRequests.i18n";

/**
 * 库里读回来的记录并进当前列表。
 *
 * **只补，不覆盖。**实时那一行更全 —— 脱敏和可疑工具调用只在事件里有，库里没有。
 * 合并的方向是「历史只添信息」，两个例外：还在「进行中」的行按库里记上结局，上游
 * 以库里的为准（理由写在循环里）。
 *
 * **有变化的行换一个新对象，没变的原样留着。**表格按行对象是不是同一个来决定要不要
 * 重画那一行（见 `RequestTable` 的 `Row`）：每次对账都把两千行换成新对象的话，一条
 * 请求落地就要整表重画一遍。
 *
 * `localLabel`：本地应答那几行的「上游」一栏写什么。
 */
export function mergeHistory(
  rows: Map<number, RequestRow>,
  history: HistoryRow[],
  localLabel: string,
): void {
  for (const h of history) {
    const cur = rows.get(h.id);
    if (cur) {
      const next = { ...cur };
      /*
        **还在「进行中」的行，库里已经有了它**：记录只在结局到了才落库，所以它
        确实结束了，只是结局事件没送到（事件流丢过事件、或者在重连的间隙里）。
        按库里的补上结局，不然这一行永远在跑。
      */
      if (next.state === "in_flight") {
        next.state = h.error ? "failed" : h.cancelled ? "cancelled" : "done";
        if (h.status != null) next.status = h.status;
        next.durationMs = h.duration_ms ?? undefined;
        next.bytes = h.bytes ?? undefined;
        next.error = h.error ?? undefined;
      }
      // 上游以库里的为准：故障转移之后服务它的是尝试链的最后一跳
      if (!h.local) next.provider = h.provider;
      next.model ??= h.model || undefined;
      if (h.input_tokens != null) next.inputTokens = h.input_tokens;
      if (h.output_tokens != null) next.outputTokens = h.output_tokens;
      if (h.cache_read_tokens != null) next.cacheReadTokens = h.cache_read_tokens;
      if (h.cache_write_tokens != null) next.cacheWriteTokens = h.cache_write_tokens;
      if (h.cost_micros != null) {
        next.costMicros = h.cost_micros;
        next.costEstimated = h.cost_estimated;
      }
      next.translated ??= h.translated ?? undefined;
      // **会话 id 只有库里有。**事件里那个是指纹，差着起始时刻
      next.session = h.session ?? next.session;
      if (!next.secrets || !next.flagged) {
        const marks = marksFromEvents(h.security);
        next.secrets ??= marks.secrets;
        next.flagged ??= marks.flagged;
      }
      next.hint ??= h.client_hint ?? undefined;
      next.peer ??= h.peer ?? undefined;
      next.keyMasked ??= h.key_masked ?? undefined;
      if (changed(cur, next)) rows.set(h.id, next);
      continue;
    }
    rows.set(h.id, {
      id: h.id,
      client: h.client,
      provider: h.local ? localLabel : h.provider,
      local: h.local || undefined,
      model: h.model || undefined,
      path: h.path,
      atMs: h.at_ms,
      state: h.error ? "failed" : h.cancelled ? "cancelled" : "done",
      status: h.status ?? undefined,
      ttfbMs: h.ttfb_ms ?? undefined,
      durationMs: h.duration_ms ?? undefined,
      bytes: h.bytes ?? undefined,
      inputTokens: h.input_tokens ?? undefined,
      outputTokens: h.output_tokens ?? undefined,
      cacheReadTokens: h.cache_read_tokens ?? undefined,
      cacheWriteTokens: h.cache_write_tokens ?? undefined,
      costMicros: h.cost_micros ?? undefined,
      costEstimated: h.cost_estimated,
      error: h.error ?? undefined,
      translated: h.translated ?? undefined,
      session: h.session ?? undefined,
      hint: h.client_hint ?? undefined,
      peer: h.peer ?? undefined,
      keyMasked: h.key_masked ?? undefined,
      ...marksFromEvents(h.security),
    });
  }
}

/**
 * 两个行对象上有没有哪一项不一样（只比一层：嵌套的那几样只在原来没有时才换）。
 *
 * **没有这一项和这一项是 `undefined` 算一样。**上面的 `??=` 在库里也没有的时候
 * 会写上一个 `undefined`，按键数比的话每次对账都「变了」，整张表跟着重画。
 */
function changed(a: RequestRow, b: RequestRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RequestRow>;
  for (const k of keys) if (!Object.is(a[k], b[k])) return true;
  return false;
}

/**
 * 这条事件会改哪一行。**改之前先把那一行换成一个新对象**（`flush` 里），理由同
 * `mergeHistory`：没被事件碰过的行保持原来的对象，表格就不重画它们。
 */
function touches(ev: CoreEvent): number | null {
  switch (ev.kind) {
    case "request_headers":
    case "request_finished":
    case "request_cancelled":
    case "request_failed":
    case "request_routed":
    case "request_priced":
    case "secrets_found":
    case "tool_call_flagged":
    case "translated":
      return ev.id;
    default:
      return null;
  }
}

/**
 * 列表里最多留多少条。超过就丢最老的。
 *
 * **和开窗时读历史的条数是同一个数**（控制面的上限）。原来这里是 500 而历史读
 * 2000：开窗时列表有两千条，第一条新请求一进来就被砍到五百 —— 表格、计数、
 * 筛选的结果一下子少了四分之三，而什么都没发生。
 */
export const LIST_LIMIT = 2000;

/**
 * 一批请求落地之后，隔多久告诉别人「库里可以重算了」。
 *
 * **这不是回库取数，只是一个信号。**概览那一页算的是聚合（按模型分层、
 * 分位延迟、缓存命中率），那些只有 SQL 算得出来，而它们的输入是刚写
 * 进去的那几行 —— 写入是异步的，请求结束的那一刻还查不到。
 *
 * **节流不是防抖**：排上之后到期就发，这中间落地多少条都只发这一次。
 * 往后推的话，一串不断的请求会让信号永远排不上号，而那正是最该重算的
 * 时候。
 */
const SETTLE_MS = 2_500;

/**
 * 实时请求列表。
 *
 * **每条事件都 setState 会把 React 打死**：一个流式
 * 请求每秒几十条事件，十个并发就是每秒几百次重渲染。所以事件先进
 * `useRef` 的缓冲区，按帧 flush 一次 —— 60fps 下用户根本看不出区别，
 * 而重渲染次数降了一到两个数量级。
 *
 * `ready`：连上控制面了（App 的 `linked`）。**历史等它再读** —— 开窗那一刻 core
 * 多半还在起，读回来的只有一句「连不上」，而这一份只读一次。
 */
export function useRequests(ready: boolean) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  // 本地应答单独计数。**这是个正向数字** —— 它既证明客户端确实
  // 连上了，又说明那些探测一分钱都没花。
  const [locallyAnswered, setLocallyAnswered] = useState(0);
  /**
   * 配置面上新出现的可疑内容。
   *
   * **只攒新出现的那些**，而且不清空 —— 用户可能正在别的页上，这条
   * 提示要一直挂着直到他去看过。
   */
  const [alerts, setAlerts] = useState<ScanFinding[]>([]);
  /**
   * 最后一次配置被拒的样子。**留着直到下一次成功换入** ——
   * 一闪而过的提示等于没提示：用户在编辑器里保存完，眼睛还在编辑器上。
   */
  const [rejected, setRejected] = useState<Extract<CoreEvent, { kind: "config_rejected" }> | null>(
    null,
  );
  /**
   * token 端点换发了 refresh token。
   *
   * 写回成功的只报一次，是**告知**：用户的配置文件被我们改了，哪怕改得
   * 完全正确，他的编辑器弹「文件已更改」时也该知道是谁干的。
   *
   * 写回失败的**不自动消失**：重启之前不处理，那家上游就废了。同一个
   * 上游只留最新那条 —— 失败每次都会报，攒着只是同一句话的副本。
   */
  const [rotated, setRotated] = useState<Extract<CoreEvent, { kind: "credential_rotated" }>[]>([]);
  /**
   * 配置换入过几次。**App 据此重读概览** —— 版本号跟着概览来（见
   * `Overview.config_version`），这里只报「换了」。
   */
  const [reloads, setReloads] = useState(0);
  const store = useRef(new Map<number, RequestRow>());
  const pending = useRef<CoreEvent[]>([]);
  const frame = useRef<number | null>(null);
  /** 历史读过了吗。**读之前是骨架屏，读完没有才是空状态** */
  const [seeded, setSeeded] = useState(false);
  /**
   * 开窗时那一次读历史失败的原因。**下一次读成了才清掉。**
   *
   * 原来读失败就当成「没有记录」：流量页说「暂无请求记录」，而库里明明有两千条。
   * 现在流量页据此说「读取失败」并给「重试」；事件流照常，这之后收到的请求照样
   * 进列表。
   */
  const [seedError, setSeedError] = useState<unknown>(undefined);
  /**
   * 对过几次账了。
   *
   * **概览页靠它决定什么时候重新拉数。**那一页问的是库，而库只在请求
   * 落地之后才变 —— 定时轮询等于在什么都没发生的时候反复重画一张一样
   * 的图。这个计数每涨一次，就意味着「库里确实多了点东西」。
   */
  const [settled, setSettled] = useState(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 「现在什么情况」变了几次。
   *
   * **某家上游被熔断、或者恢复了** —— 那是概览和上游列表上看得见的状态，
   * 而它不属于任何一次请求。core 现在会报这条事件，界面据此重读一遍，
   * 不再每两秒问一次同样的问题。
   */
  const [health, setHealth] = useState(0);
  /**
   * 模型清单变了几次：某家开始获取了、获取完了。**同样不属于任何一次请求** ——
   * 启动时、每天、改了地址或凭据之后，core 自己在后台问。
   */
  const [models, setModels] = useState(0);
  /**
   * 网关换了几次监听地址（或者没换成）。**不是配置换了几次** —— 配置换进去之后
   * 监听器才开始换，只跟着配置版本重读状态，读到的是换之前的地址。
   */
  const [listening, setListening] = useState(0);
  /**
   * 上游的现状变了几次：凭据被拒或者恢复、代理不通或者恢复、要重新登录。**这些
   * 都在概览里**，App 据此重读。事件流丢过事件时也算一次：丢掉的里面可能就有
   * 它们。
   */
  const [upstreamState, setUpstreamState] = useState(0);

  /** 超出上限时按 id 顺序丢最老的 */
  const prune = useCallback(() => {
    const m = store.current;
    if (m.size <= LIST_LIMIT) return;
    const ids = [...m.keys()].sort((a, b) => a - b);
    for (const id of ids.slice(0, m.size - LIST_LIMIT)) m.delete(id);
  }, []);

  /** 把存着的行按新的在前交给界面 */
  const publish = useCallback(() => {
    prune();
    setRows([...store.current.values()].sort((a, b) => b.id - a.id));
  }, [prune]);

  /**
   * 从库里读一遍最近的记录，并进当前列表。
   *
   * 开窗时读一次；之后每批请求落地再读一次（`settled`），给新落地的行补上会话。
   * 怎么并见 `mergeHistory`：历史只添信息，结局没送到的行按库里补上。
   */
  const pull = useCallback(async () => {
    /*
      **整份日志，不分段。**日志留多久是设置里的事（保留期），而这一页
      要回答的是「翻一翻最近发生过什么」—— 让人先选一个时间范围才能
      开始搜，等于在一个本来就不大的集合上加一道门。
    */
    const history = await call("History", { limit: LIST_LIMIT });
    mergeHistory(store.current, history, textOf(requestsText).answeredLocally);
    publish();
    setSeedError(undefined);
  }, [publish]);

  /**
   * 读一遍历史，记下成没成。**成没成都算读过了**：这个标记决定「画骨架屏还是画
   * 别的」，读失败时该画的是失败和重试，骨架屏会一直转下去。
   */
  const seed = useCallback(
    async (alive: () => boolean = () => true) => {
      try {
        await pull();
      } catch (e) {
        if (alive()) setSeedError(e);
      }
      if (alive()) setSeeded(true);
    },
    [pull],
  );

  /** 「重试」：再读一遍历史 */
  const reseed = useCallback(() => seed(), [seed]);

  // **连上就先把最近的历史填进来。**关窗时窗口是被销毁的（那省下
  // 128 MB 的 WebKit，见 lib.rs 里那段实测），所以重开时这个 hook 是
  // 全新的 —— 不填的话，用户看到的是一片空白，而请求明明一直在跑。
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void seed(() => alive);
    return () => {
      alive = false;
    };
  }, [seed, ready]);

  /*
    **落库之后再对一次账。**会话 id 是存储层给的，而事件里只有指纹 ——
    所以一条请求要等它写进库、再被读回来，才知道自己属于哪次任务。

    `settled` 正是「刚落地的那几行已经在库里了」这个信号，本来就有，
    只是一直只用来重算概览的聚合。不挂上它的话，这一程里跑出来的请求
    永远归不了组，得等重开窗口。
  */
  useEffect(() => {
    if (settled === 0) return;
    void pull().catch(() => {
      // 对不上就保持原样。下一批落地还会再试
    });
  }, [settled, pull]);

  useEffect(() => {
    const flush = () => {
      frame.current = null;
      if (pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      let local = 0;
      let landed = false;
      /** 这一批里已经换成新对象的行：同一行一批里只换一次 */
      const fresh = new Set<number>();
      for (const ev of batch) {
        if (
          ev.kind === "request_finished" ||
          ev.kind === "request_failed" ||
          ev.kind === "request_cancelled"
        ) {
          landed = true;
        }
        if (ev.kind === "health_changed") setHealth((n) => n + 1);
        if (ev.kind === "models_changed") setModels((n) => n + 1);
        if (ev.kind === "listen_changed") setListening((n) => n + 1);
        if (
          ev.kind === "auth_changed" ||
          ev.kind === "proxy_changed" ||
          ev.kind === "credential_expired" ||
          ev.kind === "events_dropped"
        ) {
          setUpstreamState((n) => n + 1);
        }
        if (ev.kind === "locally_answered") local += 1;
        if (ev.kind === "config_rejected") setRejected(ev);
        if (ev.kind === "credential_rotated") {
          setRotated((prev) => [...prev.filter((x) => x.provider !== ev.provider), ev]);
        }
        if (ev.kind === "config_reloaded") {
          // 换成功了就把上一条错误撤掉 —— 留着它会让用户以为还没修好
          setRejected(null);
          setReloads((n) => n + 1);
        }
        // 先换成新对象再改，见 `touches`
        const id = touches(ev);
        if (id !== null && !fresh.has(id)) {
          const r = store.current.get(id);
          if (r) store.current.set(id, { ...r });
          fresh.add(id);
        }
        applyEvent(store.current, ev);
      }
      if (local > 0) setLocallyAnswered((n) => n + local);
      publish();
      // 落地一批就发一次「可以重算聚合了」
      if (landed) settleSoon();
    };

    /** 过一会儿发一次「库里可以重算了」。**已经排上的不再往后推** */
    const settleSoon = () => {
      if (settle.current) return;
      settle.current = setTimeout(() => {
        settle.current = null;
        setSettled((n) => n + 1);
      }, SETTLE_MS);
    };

    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    /*
      **开窗之前就开始了的请求，事件流不会再说一遍。**关窗时窗口是被销毁的，
      重开时这个 hook 是全新的：那时正在跑的请求既不在库里（还没结束），也
      没有开始事件可听，要等它结束、落库、对账之后才以「已完成」出现 ——
      跑着的那段时间，列表上没有它。

      所以挂上之后问 core 要一份「此刻还在跑的」（`resync`），补成「进行中」
      的行；core 重启回来再问一次。快照在路上时事件流上见到的开始和结局记
      在 `since` 里，快照到了再合（见 `applyInFlight`）。**按到达的顺序记**，
      不等下一帧落地：排在缓冲里的那条结局也算「已经见到了」。
    */
    let alive = true;
    let since: SeenSince | null = null;
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (since) {
        if (ev.kind === "request_started") since.started.add(ev.id);
        else if (
          ev.kind === "request_finished" ||
          ev.kind === "request_failed" ||
          ev.kind === "request_cancelled"
        )
          since.ended.add(ev.id);
      }
      pending.current.push(ev);
      schedule();
      /*
        **丢过事件，就整体对一次账。**进行中的问 core 要快照；丢掉的那些结局落库
        要一点时间，到时候照「落地之后对账」的那条路从库里补 —— 补的时候还在
        「进行中」的行会按库里的记上结局（见 `pull`）。
      */
      if (ev.kind === "events_dropped") {
        void resync();
        settleSoon();
      }
    });
    const resync = async () => {
      const mark: SeenSince = { started: new Set(), ended: new Set() };
      since = mark;
      try {
        // **等订阅真的挂上再问**：`listen` 是异步注册的，先问的话，快照和
        // 订阅之间结束的请求，结局谁都没收到
        await un;
        const open = await call("InFlight", null);
        // 等的这会儿 core 停了、或者又开始了一次对账：这份作废
        if (!alive || since !== mark) return;
        if (applyInFlight(store.current, open, mark)) publish();
      } catch {
        // 问不到就和以前一样：等它们结束、落库之后对账时出现
      } finally {
        if (since === mark) since = null;
      }
    };
    void resync();
    /*
      **core 不在跑，就没有请求在跑。**它一停，正在跑的那些就断了，而且
      再也等不到结局（见 `interruptInFlight`）。回来的时候（`running:<pid>`）
      再对一次账，补上重连之前就开始了的。
    */
    const unState = listen<string>("core-state", (e) => {
      if (e.payload.startsWith("running")) {
        void resync();
        return;
      }
      since = null;
      // 先把缓冲里的事件落下去：结局已经到了的，别被记成中断
      flush();
      // 要改的行先换成新对象，见 `touches`
      for (const [id, r] of store.current) if (r.state === "in_flight") store.current.set(id, { ...r });
      if (interruptInFlight(store.current)) publish();
    });

    /*
      客户端配置里新出现的可疑内容。**这台机器上的文件监视说的，不是 core**：
      连着哪个 core 都一样。MCP 页有新发现时直接落在「发现」上要用它。
    */
    const unLocal = listen<LocalEvent>("local-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "scan_alert") setAlerts((prev) => [...ev.alerts, ...prev].slice(0, 50));
    });

    // 窗口不可见时不必再排帧 —— 后台标签页的 rAF 本来就会被节流，
    // 但显式断掉能省下事件堆积。
    return () => {
      alive = false;
      un.then((f) => f());
      void unState.then((f) => f());
      void unLocal.then((f) => f());
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [publish]);

  return {
    rows,
    seeded,
    seedError,
    reseed,
    settled,
    health,
    models,
    listening,
    upstreamState,
    locallyAnswered,
    rejected,
    reloads,
    alerts,
    rotated,
    clearAlerts: () => setAlerts([]),
    clearRotated: () => setRotated([]),
  };
}
