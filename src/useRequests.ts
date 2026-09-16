import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  applyEvent,
  type CoreEvent,
  type HistoryRow,
  type RequestRow,
  type ScanFinding,
} from "./types";

/** 列表上限。超过就丢最老的 —— 实时视图不是历史，历史在 SQLite 里。 */
const MAX_ROWS = 500;

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
 */
export function useRequests() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  // 本地应答单独计数。**这是个正向数字** —— 它既证明客户端确实
  // 连上了，又说明那些探测一分钱都没花。
  const [locallyAnswered, setLocallyAnswered] = useState(0);
  /**
   * 最后一次配置被拒的样子。**留着直到下一次成功换入** ——
   * 一闪而过的提示等于没提示：用户在编辑器里保存完，眼睛还在编辑器上。
   */
  /**
   * 配置面上新出现的可疑内容。
   *
   * **只攒新出现的那些**，而且不清空 —— 用户可能正在别的页上，这条
   * 提示要一直挂着直到他去看过。
   */
  const [alerts, setAlerts] = useState<ScanFinding[]>([]);
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
   * 当前配置的版本号。改配置时必须带上它（乐观并发的凭据），App 也用它
   * 决定要不要重新拉概览。
   *
   * **不能只从事件流里拿。**`config_reloaded` 报的是「变化」，而这里要
   * 的是「现在是什么」—— 全新启动、谁也没改过配置时那个事件永远不来，
   * 于是它一直是 `null`，而所有写配置的入口都卡在「还没读到配置版本」
   * 上：防护页的三态、监听方式、上游字段、策略组，一个都写不进去。
   * 表现是应用看起来是只读的，而错误提示说「稍等一下再试」—— 等多久都
   * 不会好。
   *
   * 所以挂载时主动读一次当前值，之后再由事件流跟进。
   */
  const [configVersion, setConfigVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const c = await invoke<{ version: string }>("get_config");
        // 事件先到就听事件的 —— 它比这次读取更新
        if (alive) setConfigVersion((v) => v ?? c.version);
      } catch {
        // core 还没起来。事件流起来之后第一次配置变更会补上，而在那
        // 之前写配置本来也做不了。
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const store = useRef(new Map<number, RequestRow>());
  const pending = useRef<CoreEvent[]>([]);
  const frame = useRef<number | null>(null);
  /** 历史读过了吗。**读之前是骨架屏，读完没有才是空状态** */
  const [seeded, setSeeded] = useState(false);
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
   * 「库里可以重算了」发生过几次。
   *
   * 概览那一页的聚合（按模型分层、分位延迟、命中率）只有 SQL 算得出
   * 来，而写入是异步的 —— 请求结束那一刻还查不到。这个计数每涨一次，
   * 就意味着「刚落地的那几行已经在库里了」。
   */
  /**
   * 「现在什么情况」变了几次。
   *
   * **某家上游被熔断、或者恢复了** —— 那是概览和上游列表上看得见的状态，
   * 而它不属于任何一次请求。core 现在会报这条事件，界面据此重读一遍，
   * 不再每两秒问一次同样的问题。
   */
  const [health, setHealth] = useState(0);


  /**
   * 从库里读一遍最近的记录，并进当前列表。
   *
   * **只在开窗时用一次。**在此之前它还兼着「回库把价钱取回来」——
   * 因为价钱不在事件流里。core 现在会报 `request_priced`，那条路没了。
   *
   * **只补，不覆盖。**实时那一行更全 —— 脱敏、方言互转、可疑工具调用
   * 都只在事件里有，库里没有。合并的方向必须是「历史只添信息」。
   */
  const pull = useCallback(async () => {
    // Tauri 的 invoke 用字符串 reject，不是 Error
    const history = await invoke<HistoryRow[]>("recent_requests", { limit: 200 });
    for (const h of history) {
      const cur = store.current.get(h.id);
      if (cur) {
        cur.model ??= h.model || undefined;
        if (h.input_tokens != null) cur.inputTokens = h.input_tokens;
        if (h.output_tokens != null) cur.outputTokens = h.output_tokens;
        if (h.cost_micros != null) {
          cur.costMicros = h.cost_micros;
          cur.costEstimated = h.cost_estimated;
        }
        continue;
      }
      store.current.set(h.id, {
        id: h.id,
        client: h.client,
        provider: h.local ? "本地应答" : h.provider,
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
        costMicros: h.cost_micros ?? undefined,
        costEstimated: h.cost_estimated,
        error: h.error ?? undefined,
      });
    }
    setRows([...store.current.values()].sort((a, b) => b.id - a.id));
  }, []);

  // **开窗就先把最近的历史填进来。**关窗时窗口是被销毁的（那省下
  // 128 MB 的 WebKit，见 lib.rs 里那段实测），所以重开时这个 hook 是
  // 全新的 —— 不填的话，用户看到的是一片空白，而请求明明一直在跑。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await pull();
      } catch {
        /* 历史拿不到就从空白开始 —— 事件流照常，几秒后就有内容了 */
      }
      // **成没成都算读过了。**这个标记只用来决定「画骨架屏还是画空
      // 状态」，而读失败时该画的是空状态：骨架屏会一直转下去。
      if (alive) setSeeded(true);
    })();
    return () => {
      alive = false;
    };
  }, [pull]);

  useEffect(() => {
    const flush = () => {
      frame.current = null;
      if (pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      let local = 0;
      let landed = false;
      for (const ev of batch) {
        if (
          ev.kind === "request_finished" ||
          ev.kind === "request_failed" ||
          ev.kind === "request_cancelled"
        ) {
          landed = true;
        }
        if (ev.kind === "health_changed") setHealth((n) => n + 1);
        if (ev.kind === "locally_answered") local += 1;
        if (ev.kind === "config_rejected") setRejected(ev);
        if (ev.kind === "scan_alert") setAlerts((prev) => [...ev.alerts, ...prev].slice(0, 50));
        if (ev.kind === "credential_rotated") {
          setRotated((prev) => [...prev.filter((x) => x.provider !== ev.provider), ev]);
        }
        if (ev.kind === "config_reloaded") {
          // 换成功了就把上一条错误撤掉 —— 留着它会让用户以为还没修好
          setRejected(null);
          setConfigVersion(ev.version);
        }
        applyEvent(store.current, ev);
      }
      if (local > 0) setLocallyAnswered((n) => n + local);
      // 超出上限时按 id 顺序丢最老的
      if (store.current.size > MAX_ROWS) {
        const ids = [...store.current.keys()].sort((a, b) => a - b);
        for (const id of ids.slice(0, store.current.size - MAX_ROWS)) {
          store.current.delete(id);
        }
      }
      setRows([...store.current.values()].sort((a, b) => b.id - a.id));
      // 落地一批就发一次「可以重算聚合了」。**已经排上的不再往后推**
      if (landed && !settle.current) {
        settle.current = setTimeout(() => {
          settle.current = null;
          setSettled((n) => n + 1);
        }, SETTLE_MS);
      }
    };

    const schedule = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    };

    const un = listen<CoreEvent>("core-event", (e) => {
      pending.current.push(e.payload);
      schedule();
    });

    // 窗口不可见时不必再排帧 —— 后台标签页的 rAF 本来就会被节流，
    // 但显式断掉能省下事件堆积。
    return () => {
      un.then((f) => f());
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, [pull]);

  return {
    rows,
    seeded,
    settled,
    health,
    locallyAnswered,
    rejected,
    configVersion,
    alerts,
    rotated,
    clearAlerts: () => setAlerts([]),
    clearRotated: () => setRotated([]),
  };
}
