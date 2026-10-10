import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { subscribe } from "@/lib/tauriEvent";
import { call } from "@/control";
import { isRunning, parseCoreState } from "@/coreState";
import {
  applyEvent,
  applyInFlight,
  CORE_STOPPED,
  interruptInFlight,
  nonEmpty,
  type CoreEvent,
  type HistoryRow,
  type ListQuery,
  type LocalEvent,
  type RequestRow,
  type ScanFinding,
  type SeenSince,
  type SessionView,
} from "./types";
import { marksFromEvents } from "./security/marks";
import { noteCoreTime, resetCoreClock, syncCoreClock } from "./traffic/clock";

/**
 * 库里读回来的记录并进当前列表。
 *
 * **只补，不覆盖。**实时那一行更全 —— 脱敏、可疑工具调用和删除只在事件里有，库里没有。
 * 合并的方向是「历史只添信息」，两个例外：还在「进行中」的行按库里记上结局，上游
 * 以库里的为准（理由写在循环里）。
 *
 * **有变化的行换一个新对象，没变的原样留着。**表格按行对象是不是同一个来决定要不要
 * 重画那一行（见 `RequestTable` 的 `Row`）：每次对账都把两千行换成新对象的话，一条
 * 请求落地就要整表重画一遍。
 *
 * **本地应答的那几行没有上游**：`provider` 是空的，`local` 标着。「上游」那一格写的
 * 那句说明是画的时候才按语言取的（`upstreamText`）。原来这里把「本地应答」当成上游名
 * 写进行里：换了语言它还是原来那种，上游下拉框里多出一个叫「本地应答」的上游。
 *
 * 返回有没有哪一行变了（换了对象、或者多了一行）。**没变就不用交给界面**（见 `publish`）：
 * 每批请求落地都要对一次账，而大多数时候两千行里只有刚落地的那几行不一样。
 */
export function mergeHistory(rows: Map<number, RequestRow>, history: readonly HistoryRow[]): boolean {
  let dirty = false;
  for (const h of history) {
    const cur = rows.get(h.id);
    /*
      **被记成「core 停了」的那一行，库里却有它。**两种可能：连着远程时断的只是这边
      的连接，那边照常跑完、落了库 —— 结局按库里的改回来，和还在跑的那种一样；或者
      这个号被重新用上了（core 崩过之后，没落库的号接着发，见 `applyInFlight`）——
      那是另一个请求，开始的时刻不一样，整行换成库里这一条，不往旧行上补
    */
    const cut = cur?.state === "failed" && cur.error?.code === CORE_STOPPED.code;
    if (cur && !(cut && cur.atMs !== h.at_ms)) {
      const patch = patchFromHistory(cur, h, cut);
      if (patch) {
        rows.set(h.id, { ...cur, ...patch });
        dirty = true;
      }
      continue;
    }
    dirty = true;
    rows.set(h.id, rowFromHistory(h));
  }
  return dirty;
}

/**
 * 库里这一条要往现有的那一行上补什么。**只收和现在不一样的那几项**，一项都没有就是 null。
 *
 * 原来先把整行抄一份、逐项改完再和原来的比：两千行的对账，每一次都要抄两千个对象、
 * 每个再建一个键的集合，而绝大多数行一项都没变。
 *
 * **没有这一项和这一项是 `undefined` 算一样**（`Object.is(undefined, undefined)`）：
 * 库里也没有的时候不算「变了」，不然每次对账整张表都跟着重画。
 */
function patchFromHistory(cur: RequestRow, h: HistoryRow, cut: boolean): Partial<RequestRow> | null {
  let patch: Partial<RequestRow> | null = null;
  const put = <K extends keyof RequestRow>(k: K, v: RequestRow[K]) => {
    if (!Object.is(cur[k], v)) (patch ??= {})[k] = v;
  };
  /** 原来没有才补（`??=`）：实时那一行更全，有的不拿库里的覆盖 */
  const fill = <K extends keyof RequestRow>(k: K, v: RequestRow[K]) => {
    if (cur[k] == null) put(k, v);
  };
  /*
    **还在「进行中」的行，库里已经有了它**：记录只在结局到了才落库，所以它
    确实结束了，只是结局事件没送到（事件流丢过事件、或者在重连的间隙里）。
    按库里的补上结局，不然这一行永远在跑。
  */
  if (cur.state === "in_flight" || cut) {
    put("state", h.error ? "failed" : h.cancelled ? "cancelled" : "done");
    if (h.status != null) put("status", h.status);
    put("durationMs", h.duration_ms ?? undefined);
    put("tokensPerSec", h.tokens_per_sec ?? undefined);
    put("sentBytes", h.sent_bytes ?? undefined);
    put("receivedBytes", h.received_bytes ?? undefined);
    put("error", h.error ?? undefined);
  }
  // 上游以库里的为准：故障转移之后服务它的是尝试链的最后一跳
  if (!h.local) put("provider", h.provider);
  // 出口跟着服务它的那一跳走，同样以库里的为准
  put("egress", h.egress ?? undefined);
  fill("model", h.model || undefined);
  // 路由也以库里的为准：服务它的那一跳和它发出的模型名是一对，跟着上游走。改写的规则
  // 名单一样就留着原来那个数组，不然每次对账这一行都「变了」
  if (h.routing) {
    put("route", h.routing.route);
    put("rule", h.routing.rule);
    put("sentModel", lastSent(h));
    if ((cur.rewrittenBy ?? []).join("\n") !== h.routing.rewritten_by.join("\n"))
      put("rewrittenBy", nonEmpty(h.routing.rewritten_by));
  }
  fill("ttftMs", h.ttft_ms ?? undefined);
  if (h.input_tokens != null) put("inputTokens", h.input_tokens);
  if (h.output_tokens != null) put("outputTokens", h.output_tokens);
  if (h.cache_read_tokens != null) put("cacheReadTokens", h.cache_read_tokens);
  if (h.cache_write_tokens != null) put("cacheWriteTokens", h.cache_write_tokens);
  if (h.cost_micros != null) {
    put("costMicros", h.cost_micros);
    put("costEstimated", h.cost_estimated);
  }
  fill("translated", h.translated ?? undefined);
  // 插件改没改过只在库里有：事件流不说
  if (h.plugin_changed) put("pluginChanged", true);
  fill("session", h.session ?? undefined);
  if (!cur.secrets || !cur.flagged || !cur.stripped) {
    const marks = marksFromEvents(h.security);
    fill("secrets", marks.secrets);
    fill("flagged", marks.flagged);
    fill("stripped", marks.stripped);
  }
  fill("hint", h.client_hint ?? undefined);
  fill("peer", h.peer ?? undefined);
  fill("keyMasked", h.key_masked ?? undefined);
  return patch;
}

/** 服务它的那一跳发出的模型名（和客户端要的不同才有） */
function lastSent(h: HistoryRow): string | undefined {
  const hops = h.routing?.attempts ?? [];
  return hops[hops.length - 1]?.model ?? undefined;
}

/**
 * 库里的一条记录变成表格的一行。读历史、在整份记录里搜索都走它。
 *
 * 本地应答的那几行没有上游（`provider` 是空的，`local` 标着），见 `mergeHistory`。
 */
export function rowFromHistory(h: HistoryRow): RequestRow {
  return {
    id: h.id,
    client: h.client,
    provider: h.local ? "" : h.provider,
    local: h.local || undefined,
    model: h.model || undefined,
    path: h.path,
    atMs: h.at_ms,
    state: h.error ? "failed" : h.cancelled ? "cancelled" : "done",
    status: h.status ?? undefined,
    ttfbMs: h.ttfb_ms ?? undefined,
    ttftMs: h.ttft_ms ?? undefined,
    durationMs: h.duration_ms ?? undefined,
    tokensPerSec: h.tokens_per_sec ?? undefined,
    sentBytes: h.sent_bytes ?? undefined,
    receivedBytes: h.received_bytes ?? undefined,
    egress: h.egress ?? undefined,
    inputTokens: h.input_tokens ?? undefined,
    outputTokens: h.output_tokens ?? undefined,
    cacheReadTokens: h.cache_read_tokens ?? undefined,
    cacheWriteTokens: h.cache_write_tokens ?? undefined,
    costMicros: h.cost_micros ?? undefined,
    costEstimated: h.cost_estimated,
    error: h.error ?? undefined,
    translated: h.translated ?? undefined,
    pluginChanged: h.plugin_changed || undefined,
    session: h.session ?? undefined,
    route: h.routing?.route,
    rule: h.routing?.rule,
    rewrittenBy: nonEmpty(h.routing?.rewritten_by),
    sentModel: lastSent(h),
    hint: h.client_hint ?? undefined,
    peer: h.peer ?? undefined,
    keyMasked: h.key_masked ?? undefined,
    ...marksFromEvents(h.security),
  };
}

/**
 * 这条事件会改哪一行。**改之前先把那一行换成一个新对象**（`flush` 里），理由同
 * `mergeHistory`：没被事件碰过的行保持原来的对象，表格就不重画它们。
 */
function touches(ev: CoreEvent): number | null {
  switch (ev.kind) {
    case "request_headers":
    case "request_first_token":
    case "request_finished":
    case "request_cancelled":
    case "request_failed":
    case "request_routed":
    case "request_priced":
    case "secrets_found":
    case "tool_call_flagged":
    case "translated":
      return ev.id;
    // 内容过滤只有删过文字的那一条会改这一行（「已删除」徽标）
    case "content_matched":
      return ev.outcome === "stripped" ? ev.id : null;
    default:
      return null;
  }
}

/**
 * 把一批事件落进列表。返回有没有哪一行变了：多了一行，或者哪一行换了新对象。
 *
 * 改一行之前先把它换成新对象（见 `touches`），同一行一批里只换一次。
 *
 * **一行都没动的批次返回 false**：只有熔断、模型清单、配置这类「现在什么情况」的
 * 事件，或者说的是一条已经不在列表里的请求。原来每一批都把两千行重排一遍交给界面，
 * 外壳和流量页跟着整个重算 —— 而那一批什么都没改。导出给测试用。
 */
export function applyBatch(rows: Map<number, RequestRow>, batch: readonly CoreEvent[]): boolean {
  let dirty = false;
  /** 这一批里已经换成新对象的行 */
  const fresh = new Set<number>();
  for (const ev of batch) {
    const id = touches(ev);
    if (id !== null && !fresh.has(id)) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r });
      fresh.add(id);
    }
    if (ev.kind === "request_started" || (id !== null && rows.has(id))) dirty = true;
    applyEvent(rows, ev);
  }
  return dirty;
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
 * 落地的一行连着几次对账都没在库里对上，就不再等它。
 *
 * 库没在记（存储层起不来），或者那一行早被挤出了最近的两千条：一直等下去的话，每次对账
 * 都要从它开始的那一刻读起。
 */
const MAX_MISSES = 3;

/** 事件流上落地了、还没在库里对上的一行 */
export interface Awaiting {
  /** 开始的时刻（core 的钟，和库里的 `at_ms` 同一个） */
  at: number;
  /** 连着几次对账没对上 */
  misses: number;
}

/**
 * 这一次对账问库要什么。`full`：读整份（最近的两千条）；否则从等着对上的那几行里最早
 * 开始的那一刻读起 —— 库里按开始的时刻记，落地晚的长请求也在里面。**没什么要对的是
 * null**，这一次不问。导出给测试用。
 */
export function historyQuery(full: boolean, awaiting: Iterable<Awaiting>): ListQuery | null {
  if (full) return { limit: LIST_LIMIT };
  let from = Infinity;
  for (const w of awaiting) from = Math.min(from, w.at);
  return from === Infinity ? null : { limit: LIST_LIMIT, from_ms: from };
}

/**
 * 对完一次账：问的时候在等的那几行，库里有了的不再等，连着 `MAX_MISSES` 次没对上的也
 * 不等了。问的这会儿才落地的（同一个号又落地了一次也算）不动。导出给测试用。
 */
export function settleAwaiting(
  awaiting: Map<number, Awaiting>,
  asked: readonly (readonly [number, Awaiting])[],
  found: ReadonlySet<number>,
): void {
  for (const [id, w] of asked) {
    if (awaiting.get(id) !== w) continue;
    w.misses += 1;
    if (found.has(id) || w.misses >= MAX_MISSES) awaiting.delete(id);
  }
}

/**
 * 实时请求列表交给界面的那一份。
 *
 * **外壳不订阅它。**原来这些都是 App 的 state：流式请求每一帧都在改列表，外壳和眼前那一页
 * 跟着整个重画 —— 概览页根本不画这张表，2 请求/秒下脚本时间却从 340 ms/10 s 涨到
 * 1,160 ms/10 s。现在放在 React 外面（`useSyncExternalStore`），只有真用到的地方订阅：
 * 流量页、命令面板、密钥页和客户端页上的「请求中」、概览和安全页的重取节拍。
 */
export interface RequestsView {
  /** 新的在前。**交出去的这一份只读**：要改的话改 `useRequests` 里的那张表，再交一份新的 */
  rows: RequestRow[];
  /** 历史读过了吗。**读之前是骨架屏，读完没有才是空状态** */
  seeded: boolean;
  /**
   * 开窗时那一次读历史失败的原因。**下一次读成了才清掉。**
   *
   * 原来读失败就当成「没有记录」：流量页说「暂无请求记录」，而库里明明有两千条。
   * 现在流量页据此说「读取失败」并给「重试」；事件流照常，这之后收到的请求照样
   * 进列表。
   */
  seedError: unknown;
  /**
   * 对过几次账了。
   *
   * **概览页靠它决定什么时候重新拉数。**那一页问的是库，而库只在请求
   * 落地之后才变 —— 定时轮询等于在什么都没发生的时候反复重画一张一样
   * 的图。这个计数每涨一次，就意味着「库里确实多了点东西」。
   */
  settled: number;
  /**
   * 本地应答单独计数。**这是个正向数字** —— 它既证明客户端确实
   * 连上了，又说明那些探测一分钱都没花。
   */
  locallyAnswered: number;
  /**
   * 会话汇总，归组表的组头要用它。**不定时轮询**：会话是把落库的请求聚起来算的，只在
   * 有请求落地之后才会变，所以和对账同一个节拍（`settled`）重读。读不到就留着上一份。
   */
  sessions: SessionView[];
}

export interface RequestsStore {
  /** 现在这一份。**没变就是同一个对象**：`useSyncExternalStore` 按引用判断要不要重画 */
  get: () => RequestsView;
  subscribe: (listener: () => void) => () => void;
  /** 「重试」：再读一遍历史 */
  reseed: () => Promise<void>;
}

const EMPTY: RequestsView = {
  rows: [],
  seeded: false,
  seedError: undefined,
  settled: 0,
  locallyAnswered: 0,
  sessions: [],
};

function createStore(reseed: () => Promise<void>) {
  let view = EMPTY;
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    reseed,
    /** 改几项。**一项都没变就不惊动谁** */
    set: (patch: Partial<RequestsView>) => {
      if ((Object.keys(patch) as (keyof RequestsView)[]).every((k) => Object.is(view[k], patch[k]))) return;
      view = { ...view, ...patch };
      for (const l of listeners) l();
    },
  };
}

const RequestsContext = createContext<RequestsStore | null>(null);

/** 外壳把 `useRequests` 的那一份放进来，各页用下面几个钩子取 */
export const RequestsProvider = RequestsContext.Provider;

function useStore(): RequestsStore {
  const store = useContext(RequestsContext);
  if (!store) throw new Error("useRequestsView must be used inside the app shell");
  return store;
}

/**
 * 取实时请求列表里的一样。**只在取出来的那一样变了时重画。**
 *
 * `pick` 返回的要么是原样的一项（`(v) => v.rows`），要么是按值比较的字符串、数字：每次新建
 * 一个对象或数组的话，每一次改动都算「变了」，订阅了等于没拆。
 */
export function useRequestsView<T>(pick: (v: RequestsView) => T): T {
  const store = useStore();
  const get = () => pick(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}

/** 流量页的「重试」：再读一遍历史 */
export function useReseed(): () => Promise<void> {
  return useStore().reseed;
}

/**
 * 实时请求列表。
 *
 * **每条事件都 setState 会把 React 打死**：一个流式
 * 请求每秒几十条事件，十个并发就是每秒几百次重渲染。所以事件先进
 * `useRef` 的缓冲区，按帧 flush 一次 —— 60fps 下用户根本看不出区别，
 * 而重渲染次数降了一到两个数量级。列表本身交给 `RequestsStore`，谁用谁订阅（见 `RequestsView`）。
 *
 * **窗口藏着的时候不按帧攒。**最小化、被整个盖住、应用被隐藏时 rAF 不来，缓冲区原来就
 * 一直涨，对账也停着。现在藏着的时候事件当场落进列表（照样按上限丢最老的），只是不交给
 * 界面；露面的那一刻一次交出去，再对一次账。
 *
 * `ready`：连上控制面了（`useCoreLink` 的 `linked`）。**历史等它再读** —— 开窗那一刻 core
 * 多半还在起，读回来的只有一句「连不上」，而这一份只读一次。
 */
export function useRequests(ready: boolean) {
  /** 「重试」走的那一下。store 在第一次渲染时就建好了，读历史的函数在下面，所以隔一层 */
  const seedNow = useRef<() => Promise<void>>(() => Promise.resolve());
  const [store] = useState(() => createStore(() => seedNow.current()));
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
   * **只留写回失败的**：重启之前不处理，那家上游就废了。写回成功是网关的分内事，
   * 不拿来打扰人。同一个上游只留最新那条 —— 失败每次都会报，攒着只是同一句话的副本。
   */
  const [rotated, setRotated] = useState<Extract<CoreEvent, { kind: "credential_rotated" }>[]>([]);
  /**
   * 配置换入过几次。**App 据此重读概览** —— 版本号跟着概览来（见
   * `Overview.config_version`），这里只报「换了」。
   */
  const [reloads, setReloads] = useState(0);
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
   * 上游的现状变了几次：凭据被拒或者恢复、代理不通或者恢复、要重新登录、读到了新的
   * 余额。**这些都在概览里**，App 据此重读。事件流丢过事件时也算一次：丢掉的里面
   * 可能就有它们。
   */
  const [upstreamState, setUpstreamState] = useState(0);
  const rows = useRef(new Map<number, RequestRow>());
  const pending = useRef<CoreEvent[]>([]);
  const frame = useRef<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 事件流上落地了、还没在库里对上的行：id → 开始的时刻（core 的钟，和库里的 `at_ms` 同一个）。
   * 下一次对账从其中最早的那一刻读起，见 `pull`
   */
  const awaiting = useRef(new Map<number, Awaiting>());
  /**
   * 下一次对账读整份（最近的两千条），不只读落地的那一段。开窗时是；事件流说不全的时候
   * 也是：丢过事件、core 停过、落地的那一行列表里没有
   */
  const whole = useRef(true);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  /** 超出上限时按 id 顺序丢最老的 */
  const prune = useCallback(() => {
    const m = rows.current;
    if (m.size <= LIST_LIMIT) return;
    const ids = [...m.keys()].sort((a, b) => a - b);
    for (const id of ids.slice(0, m.size - LIST_LIMIT)) m.delete(id);
  }, []);

  /** 把存着的行按新的在前交给界面 */
  const publish = useCallback(() => {
    prune();
    store.set({ rows: [...rows.current.values()].sort((a, b) => b.id - a.id) });
  }, [prune, store]);

  /**
   * 从库里读一遍最近的记录，并进当前列表。
   *
   * 开窗时读一次；之后每批请求落地再读一次（`settled`），补上事件流没见全的行。**落地
   * 之后只读落地的那一段**：从等着对上的那几行里最早开始的那一刻起（`from_ms`）。原来每次
   * 都读整整两千条，连续有请求时每 2.5 秒一遍、两千行逐一比过，而要对的只是刚落地的几行。
   * 事件流说不全的时候（见 `whole`）照旧读整份。
   *
   * 怎么并见 `mergeHistory`：历史只添信息，结局没送到的行按库里补上。
   */
  const pull = useCallback(async () => {
    const asked = [...awaiting.current];
    const full = whole.current;
    /*
      **整份日志，不分段。**日志留多久是设置里的事（保留期），而这一页
      要回答的是「翻一翻最近发生过什么」—— 让人先选一个时间范围才能
      开始搜，等于在一个本来就不大的集合上加一道门。落地之后只读落地的那一段，
      是对账的事，不是给这一页分段。
    */
    const query = historyQuery(full, awaiting.current.values());
    if (!query) return;
    whole.current = false;
    let history: HistoryRow[];
    try {
      history = await call("History", query);
    } catch (e) {
      if (full) whole.current = true;
      throw e;
    }
    if (mergeHistory(rows.current, history)) publish();
    settleAwaiting(awaiting.current, asked, new Set(history.map((h) => h.id)));
    store.set({ seedError: undefined });
  }, [publish, store]);

  /**
   * 读一遍历史，记下成没成。**成没成都算读过了**：这个标记决定「画骨架屏还是画
   * 别的」，读失败时该画的是失败和重试，骨架屏会一直转下去。
   */
  const seed = useCallback(
    async (alive: () => boolean = () => true) => {
      whole.current = true;
      try {
        await pull();
      } catch (e) {
        if (alive()) store.set({ seedError: e });
      }
      if (alive()) store.set({ seeded: true });
    },
    [pull, store],
  );
  seedNow.current = () => seed();

  /** 重读会话汇总。读不到就留着上一份：下一批请求落地还会再读 */
  const loadSessions = useCallback(async () => {
    try {
      store.set({ sessions: await call("Sessions", { limit: 200 }) });
    } catch {
      // 留着上一份
    }
  }, [store]);

  // **连上就先把最近的历史填进来。**关窗时窗口是被销毁的（那省下
  // 128 MB 的 WebKit，见 lib.rs 里那段实测），所以重开时这个 hook 是
  // 全新的 —— 不填的话，用户看到的是一片空白，而请求明明一直在跑。
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void seed(() => alive);
    void loadSessions();
    return () => {
      alive = false;
    };
  }, [seed, loadSessions, ready]);

  useEffect(() => {
    /** 窗口藏着：最小化、被整个盖住、应用被隐藏。**这时候 rAF 不来** */
    const hidden = () => document.visibilityState === "hidden";
    /** 藏着的时候落进列表、还没交给界面的 */
    let stale = false;
    /** 藏着的时候该发的「库里可以重算了」，露面时再发 */
    let held = false;

    /** 列表变了：交给界面。藏着的时候只落进列表（照样按上限丢最老的），露面时一次交出去 */
    const commit = () => {
      if (hidden()) {
        prune();
        stale = true;
      } else publish();
    };

    /** 事件流上落地了一行：记下来，下一次对账去库里对上它（价钱、插件、路由以库里的为准） */
    const landedRow = (id: number) => {
      const r = rows.current.get(id);
      if (!r) {
        // 列表里没有这一行：开窗之前就开始、又在快照路上结束的。只有整份读才补得回来
        whole.current = true;
        return;
      }
      awaiting.current.set(id, { at: r.atMs, misses: 0 });
      // 攒了一大堆（藏了很久）：不如读整份
      if (awaiting.current.size > LIST_LIMIT) {
        awaiting.current.clear();
        whole.current = true;
      }
    };

    const flush = () => {
      frame.current = null;
      if (pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      let local = 0;
      const ended: number[] = [];
      for (const ev of batch) {
        if (
          ev.kind === "request_finished" ||
          ev.kind === "request_failed" ||
          ev.kind === "request_cancelled"
        ) {
          ended.push(ev.id);
        }
        if (ev.kind === "health_changed") setHealth((n) => n + 1);
        if (ev.kind === "models_changed") setModels((n) => n + 1);
        if (ev.kind === "listen_changed") setListening((n) => n + 1);
        if (
          ev.kind === "auth_changed" ||
          ev.kind === "proxy_changed" ||
          ev.kind === "credential_expired" ||
          ev.kind === "balance_updated" ||
          ev.kind === "events_dropped"
        ) {
          setUpstreamState((n) => n + 1);
        }
        if (ev.kind === "locally_answered") local += 1;
        if (ev.kind === "config_rejected") setRejected(ev);
        if (ev.kind === "credential_rotated" && !ev.persisted) {
          setRotated((prev) => [...prev.filter((x) => x.provider !== ev.provider), ev]);
        }
        if (ev.kind === "config_reloaded") {
          // 换成功了就把上一条错误撤掉 —— 留着它会让用户以为还没修好
          setRejected(null);
          setReloads((n) => n + 1);
        }
      }
      if (local > 0) store.set({ locallyAnswered: store.get().locallyAnswered + local });
      // 一行都没动的批次不交给界面，见 `applyBatch`
      if (applyBatch(rows.current, batch)) commit();
      // 落地的行这时才都在列表里：开始和结局在同一批里的也算
      for (const id of ended) landedRow(id);
      // 落地一批就发一次「可以重算聚合了」
      if (ended.length > 0) settleSoon();
    };

    /** 「库里可以重算了」：计数加一，顺带对账、重读会话。藏着的时候不发，露面时再发 */
    const settleNow = () => {
      if (hidden()) {
        held = true;
        return;
      }
      store.set({ settled: store.get().settled + 1 });
      if (!readyRef.current) return;
      void pull().catch(() => {
        // 对不上就保持原样。下一批落地还会再试
      });
      void loadSessions();
    };

    /** 过一会儿发一次「库里可以重算了」。**已经排上的不再往后推** */
    const settleSoon = () => {
      if (settle.current) return;
      settle.current = setTimeout(() => {
        settle.current = null;
        settleNow();
      }, SETTLE_MS);
    };

    const schedule = () => {
      // 藏着的时候 rAF 不来：当场落进列表，不往缓冲区里攒（见 `commit`）
      if (hidden()) flush();
      else if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    /*
      **露面的那一刻补上藏着时落下的。**藏着的时候列表照样在更新，只是没交给界面；对账
      也停着（读回来也没人看），这时补一次 —— 库里早就有了，不用再等。
    */
    const onVisibility = () => {
      if (hidden()) return;
      if (stale) {
        stale = false;
        publish();
      }
      if (held) {
        held = false;
        settleNow();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

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
    /*
      **core 的钟从这里对**：在跑的那几行「已跑多久」拿 core 的现在减开始时刻，而连的
      可能是另一台机器上的 core（见 `traffic/clock`）。这个 hook 跟着连接走，挂上时
      之前那个 core 的钟作废；快照到了按它定，开始事件到了按它往上校 —— 按**到达**的
      那一刻记，不等下一帧落地。
    */
    resetCoreClock();
    const un = subscribe<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "request_started") noteCoreTime(ev.at_ms, Date.now());
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
        「进行中」的行会按库里的记上结局（见 `pull`）。丢掉的是哪几行不知道，所以
        读整份。
      */
      if (ev.kind === "events_dropped") {
        whole.current = true;
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
        await un.ready;
        const sentAt = Date.now();
        const open = await call("InFlight", null);
        const gotAt = Date.now();
        // 等的这会儿 core 停了、或者又开始了一次对账：这份作废
        if (!alive || since !== mark) return;
        syncCoreClock(open.now_ms, sentAt, gotAt);
        if (applyInFlight(rows.current, open.requests, mark)) commit();
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
    const unState = subscribe<string>("core-state", (e) => {
      if (isRunning(parseCoreState(e.payload))) {
        void resync();
        return;
      }
      since = null;
      // 先把缓冲里的事件落下去：结局已经到了的，别被记成中断
      flush();
      // 要改的行先换成新对象，见 `touches`
      for (const [id, r] of rows.current) if (r.state === "in_flight") rows.current.set(id, { ...r });
      if (interruptInFlight(rows.current)) {
        // 连着远程时断的只是这边：那边照常跑完、落了库。下一次对账读整份，按库里的改回来
        whole.current = true;
        commit();
      }
    });

    /*
      客户端配置里新出现的可疑内容。**这台机器上的文件监视说的，不是 core**：
      连着哪个 core 都一样。MCP 页有新发现时直接落在「发现」上要用它。
    */
    const unLocal = subscribe<LocalEvent>("local-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "scan_alert") setAlerts((prev) => [...ev.alerts, ...prev].slice(0, 50));
    });

    return () => {
      alive = false;
      un();
      unState();
      unLocal();
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [publish, prune, pull, loadSessions, store]);

  const clearAlerts = useCallback(() => setAlerts([]), []);
  /** 关掉一家的那一条。**不是全部**：关一条告知，不该顺手把另一家「重启前必须处理」的那条也关了 */
  const clearRotated = useCallback(
    (provider: string) => setRotated((p) => p.filter((x) => x.provider !== provider)),
    [],
  );

  // 引用不变：只在这几样变了的时候换，外壳据此决定要不要重画
  return useMemo(
    () => ({
      store: store as RequestsStore,
      health,
      models,
      listening,
      upstreamState,
      rejected,
      reloads,
      alerts,
      rotated,
      clearAlerts,
      clearRotated,
    }),
    [store, health, models, listening, upstreamState, rejected, reloads, alerts, rotated, clearAlerts, clearRotated],
  );
}

const pickRows = (v: RequestsView) => v.rows;
const pickSessions = (v: RequestsView) => v.sessions;
const pickSettled = (v: RequestsView) => v.settled;

/** 实时请求列表，新的在前。**每一帧都可能变**：只在真要画它的地方订阅 */
export function useRequestRows(): RequestRow[] {
  return useRequestsView(pickRows);
}

/** 会话汇总（归组表的组头）。和请求列表同一份、同一个节拍，见 `RequestsView.sessions` */
export function useSessionViews(): SessionView[] {
  return useRequestsView(pickSessions);
}

/** 对过几次账了：概览、安全页据此重取（见 `RequestsView.settled`） */
export function useSettled(): number {
  return useRequestsView(pickSettled);
}
