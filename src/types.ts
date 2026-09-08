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
  | { kind: "request_failed"; id: number; source: string; message: string };

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
