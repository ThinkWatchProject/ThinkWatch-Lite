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
  | { kind: "locally_answered"; id: number; client: string; probe: string; at_ms: number }
  /** 配置换了一份新的进去，已经生效。界面靠它知道自己手里那份过期了。 */
  | { kind: "config_reloaded"; id: number; version: string; origin: string; at_ms: number }
  /**
   * 新配置没过关，**旧的还在服务**。
   *
   * 这不是崩溃，是一条要展示给人看的信息 —— 桌面工具不能因为一个笔误
   * 就断线（§3.8）。
   */
  | {
      kind: "config_rejected";
      id: number;
      stage: string;
      message: string;
      line: number | null;
      excerpt: string | null;
      at_ms: number;
    };

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
    case "config_reloaded":
    case "config_rejected":
      // 都不进请求列表。配置事件是另一回事，App 单独接。
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

// —— 观测（§8）——

/**
 * 一段时间的汇总。
 *
 * **实测、估算、没有价格是三个数，不是一个。**「今日 $12.40 实测 +
 * ~$0.80 估算，另有 3 条没有价格」比一个混在一起的 $13.20 诚实得多 ——
 * 后者看起来是个确定的数字（§4.3）。
 */
export interface Summary {
  requests: number;
  failed: number;
  /** 本地应答的次数。**是个正向数字**（§4.8） */
  locally_answered: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  /** 微分：百万分之一美元 */
  cost_micros_exact: number;
  cost_micros_estimated: number;
  /** 有多少条请求根本没有价格。**不是 0，是「不知道」** */
  unpriced_requests: number;
  /** 价目表的快照日期。**成本旁边要标它**（§4.3.0） */
  pricing_date: string;
}

export interface LatencyView {
  model: string;
  p50: number;
  p95: number;
  /** 「800ms」是 3 个样本还是 300 个，含义完全不同（§4.6） */
  samples: number;
}

/** 尝试链里的一跳。 */
export interface AttemptView {
  provider: string;
  /** 「成功」「429」「连不上上游」这类人话。**失败的原因要留着**（§4.2） */
  outcome: string;
  ms: number;
}

/** 一次请求的路由决策。**详情抽屉的路由那一页吃它。** */
export interface RoutingView {
  rule: string;
  group: string | null;
  attempts: AttemptView[];
}

export interface HistoryRow {
  id: number;
  at_ms: number;
  client: string;
  provider: string;
  model: string;
  path: string;
  status: number | null;
  ttfb_ms: number | null;
  duration_ms: number | null;
  bytes: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_micros: number | null;
  cost_estimated: boolean;
  error: string | null;
  local: boolean;
  /** 路由决策与尝试链。老记录没有它 */
  routing: RoutingView | null;
}

export interface StorageStatus {
  level: string;
  rows: number;
  blob_bytes: number;
  /** **永远是 false** —— 观测挂了，代理照跑（§4.7） */
  forwarding_affected: boolean;
}

/** 一份存下来的 body。**已脱敏**（§9.7）。 */
export interface BodyView {
  text: string;
  /** 原本多长。**截断了要说出来** —— 不说的话用户会以为请求本身就长这样 */
  original_len: number;
  truncated: boolean;
}

export interface RequestDetail {
  row: HistoryRow;
  request_body: BodyView | null;
  response_body: BodyView | null;
}

/**
 * 「过去 7 天，有 3 个请求把你的 API key 发给了 relay-cn」（§5.0）。
 *
 * **这比任何功能介绍都有说服力**，因为它说的是已经发生在你身上的事。
 */
export interface LeakGroup {
  provider: string;
  kind: string;
  requests: number;
  last_at_ms: number;
  /** 涉及哪几把，**都已打码** */
  masked: string[];
}

export interface Dashboard {
  summary: Summary;
  latency: LatencyView[];
  history: HistoryRow[];
  storage: StorageStatus | null;
  leaks: LeakGroup[];
}

/**
 * 微分变成给人看的金额。
 *
 * **小额不能显示成 $0.00。**一次便宜的调用是 $0.0003，显示成 $0.00 会让
 * 用户以为它是免费的 —— 而「看起来免费」正是这类工具最容易造成的误解。
 */
export function usd(micros: number): string {
  const v = micros / 1e6;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * L3 测速要花多少（§4.6）。
 *
 * **这是「你确认要花钱吗」那个对话框的全部内容。**触发前必须显示它，
 * 而不是点了才知道。
 */
export interface SpeedEstimate {
  provider: string;
  model: string;
  /** 输入 token。**精确值** —— 请求是固定的 */
  input_tokens: number;
  max_output_tokens: number;
  cost_micros: number | null;
  note: string;
}

export interface SpeedQuote {
  items: SpeedEstimate[];
  /** 总计。**有一项算不出来就是 null** —— 给一个看起来完整的数字，用户
      会以为那就是全部代价 */
  total_micros: number | null;
  pricing_date: string;
}

export interface SpeedResult {
  provider: string;
  model: string;
  ok: boolean;
  connect_ms: number;
  /** **首 token。**这一层唯一值得测的东西 */
  ttft_ms: number | null;
  total_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
}

// —— 配置（§3.8 的双向同步）——
export interface ConfigText {
  path: string;
  text: string;
  /** `blake3:xxxxxxxxxxxx`。**改配置时必须带上它** —— 那是乐观并发的凭据 */
  version: string;
}

export type PatchValue = string | number | boolean | null;

export interface PatchOp {
  op: "replace";
  /** 按名字定位：`/providers/官方/base_url`。下标会在重排之后指向另一个东西 */
  path: string;
  value: PatchValue;
}

export interface ConfigVersion {
  version: string;
  at_ms: number;
  origin: string;
  bytes: number;
  /** 历史里包括当前版本，不标出来用户会回滚到自己身上 */
  current: boolean;
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
