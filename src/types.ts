// 控制面契约的 TS 侧。**类型的真相源是 Rust 的 tw-api**（DESIGN.md §9.5）；
// 这里是手工镜像，改一边就要改另一边。
//
// 手工镜像是有代价的，而且这个代价会长大 —— cc-switch 的托盘 i18n 就是
// 一份手抄的镜像，注释里自己承认了。等类型多起来要换成从 Rust 导出
// （ts-rs 之类），现在还不值得。

export type CoreEvent =
  | { kind: "request_started"; id: number; client: string; provider: string; method: string; path: string; at_ms: number }
  | { kind: "request_headers"; id: number; status: number; ttfb_ms: number }
  | { kind: "request_finished"; id: number; status: number; bytes: number; duration_ms: number }
  | { kind: "request_failed"; id: number; source: string; message: string }
  /**
   * 客户端的辅助请求被本地应答了，一个字节都没发给上游（§4.8）。
   *
   * **它不进请求列表。**成本 0、延迟 0 的东西混进请求总数和延迟统计里，
   * 会让那两个数字都变得没意义。它单独计数。
   */
  | { kind: "locally_answered"; id: number; client: string; probe: string; at_ms: number };

export interface CoreStatus {
  api_version: number;
  version: string;
  pid: number;
  gateway_addr: string | null;
  config_path: string;
  clients: number;
  providers: number;
  uptime_secs: number;
}

/** 一行请求，由四类事件缝出来。 */
export interface RequestRow {
  id: number;
  client: string;
  provider: string;
  path: string;
  atMs: number;
  /** 进行中的行也要立刻画出来 —— 流式请求可能要跑几分钟 */
  state: "in_flight" | "done" | "failed";
  status?: number;
  ttfbMs?: number;
  durationMs?: number;
  bytes?: number;
  error?: string;
}

export function applyEvent(rows: Map<number, RequestRow>, ev: CoreEvent): void {
  switch (ev.kind) {
    case "request_started":
      rows.set(ev.id, {
        id: ev.id,
        client: ev.client,
        provider: ev.provider,
        path: ev.path,
        atMs: ev.at_ms,
        state: "in_flight",
      });
      break;
    case "request_headers": {
      const r = rows.get(ev.id);
      if (r) {
        r.status = ev.status;
        r.ttfbMs = ev.ttfb_ms;
      }
      break;
    }
    case "request_finished": {
      const r = rows.get(ev.id);
      if (r) {
        r.state = "done";
        r.status = ev.status;
        r.bytes = ev.bytes;
        r.durationMs = ev.duration_ms;
      }
      break;
    }
    case "locally_answered":
      // 故意不建行。计数在 useRequests 里单独做。
      break;
    case "request_failed": {
      const r = rows.get(ev.id);
      if (r) {
        r.state = "failed";
        r.error = ev.message;
      }
      break;
    }
  }
}

/** 模型清单的结果。空列表不足以表达三种不同的情况 —— 见 Rust 侧的注释。 */
export type ModelList =
  | { kind: "listed"; models: string[] }
  /** 上游没有这个接口。不是错误，但按模型路由那类功能对它用不了。 */
  | { kind: "not_implemented"; status: number }
  /** 2xx 但我们没认出形状 —— 这是我们的缺口，要报出来去修。 */
  | { kind: "unrecognized"; sample: string }
  | { kind: "empty" };

export interface ProbeResponse {
  ok: boolean;
  protocol: string | null;
  latency_ms: number;
  models: ModelList;
  error: string | null;
}

/**
 * L1 测速的一段。**分段是个列表而不是固定的 DNS/TCP/TLS 三段** ——
 * 走代理时形状本来就不同：多出「代理握手」，而 socks5h 下根本没有本地
 * DNS 那一段。
 */
export interface L1Segment {
  name: string;
  ms: number;
}

export interface L1Result {
  /** 实际测的是什么。回显出来，别让用户猜点的那一下测了谁 */
  target: string;
  via?: string | null;
  ok: boolean;
  segments: L1Segment[];
  total_ms: number;
  /** 解释为什么某一段不在上面。**没有这句话，缺一段看起来就像 bug** */
  notes?: string[];
  error?: string | null;
}

export interface SetupResponse {
  gateway_key: string;
  gateway_addr: string;
  config_path: string;
}

// —— 配置概览。**密钥只有来源，没有值** —— Rust 侧就没发过来。 ——
export interface ProviderView {
  name: string;
  base_url: string;
  key_source: string;
  protocol: string | null;
  proxy: string;
  health: "ok" | "open";
}

export interface RouteView {
  name: string;
  to: string;
  /** 空 = 兜底 */
  conditions: string[];
}

export interface GroupView {
  name: string;
  kind: string;
  providers: string[];
  /** 这个策略会不会让 prompt cache 不稳定。**要直说** —— 它决定账单。 */
  hurts_cache: boolean;
}

export interface ClientView {
  name: string;
  key: string;
  max_concurrent: number | null;
}

export interface ListenView {
  bind: string;
  port: number;
  allow_from: string[];
  exposed: boolean;
}

export interface Overview {
  providers: ProviderView[];
  routes: RouteView[];
  groups: GroupView[];
  clients: ClientView[];
  listen: ListenView;
}
