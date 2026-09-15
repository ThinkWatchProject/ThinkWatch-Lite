import type { CostBucket } from "./format";
// 控制面契约的 TS 侧。**类型的真相源是 Rust 的 tw-api**；
// 这里是手工镜像，改一边就要改另一边。
//
// 手工镜像是有代价的，而且这个代价会长大 —— cc-switch 的托盘 i18n 就是
// 一份手抄的镜像，注释里自己承认了。等类型多起来要换成从 Rust 导出
// （ts-rs 之类），现在还不值得。

export type CoreEvent =
  | { kind: "request_started"; id: number; client: string; provider: string; model: string; method: string; path: string; at_ms: number }
  | { kind: "request_headers"; id: number; status: number; ttfb_ms: number }
  | { kind: "request_finished"; id: number; status: number; bytes: number; duration_ms: number; usage?: UsageView }
  | { kind: "request_failed"; id: number; source: string; message: string }
  /**
   * 客户端的辅助请求被本地应答了，一个字节都没发给上游。
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
   * 就断线。
   */
  | {
      kind: "config_rejected";
      id: number;
      stage: string;
      message: string;
      line: number | null;
      excerpt: string | null;
      at_ms: number;
    }
  /**
   * 客户端配置面上**新出现**了可疑的东西。
   *
   * **只有新出现的才会进来。**「一个用了半年的 skill 突然多了一段零宽
   * 字符」这个信号，比「这个文件里有可疑内容」强得多 —— 而后者在用户
   * 打开安全页的时候已经全部看过了。
   */
  | { kind: "scan_alert"; id: number; alerts: ScanFinding[]; at_ms: number }
  /**
   * 出站脱敏动手了。
   *
   * **界面上必须能看到脱敏发生了什么** —— 看不见的安全功能会被用户关掉，
   * 因为他们会怀疑是脱敏搞坏了功能。事件里只有类别和计数，没有原值。
   */
  | {
      kind: "redacted";
      id: number;
      provider: string;
      items: { kind: string; what: string; count: number }[];
      at_ms: number;
    }
  /**
   * 这次请求做了方言互转。
   *
   * **`dropped` 非空时必须让用户看见**：`thinking` 在 OpenAI chat 方言里
   * 没有对应物，我们只能丢 —— 但悄悄丢掉的话，用户会发现「扩展思考开了
   * 却没生效」而完全不知道从哪儿查起。
   */
  | {
      kind: "translated";
      id: number;
      provider: string;
      from: string;
      to: string;
      dropped: string[];
      at_ms: number;
    }
  /**
   * token 端点换发了新的 refresh token。
   *
   * **服务器换发新的那一刻，旧的已经在服务端作废了** —— 所以「不写回
   * config.yaml」不是保守选项，它保证了配置文件从那一秒起就是坏的，
   * 只是症状延迟到下次重启（那家上游突然全是 401）。所以默认写回。
   *
   * `persisted` 说的是那一步成没成：成了只是告知（用户的编辑器会弹
   * 「文件已更改」，他该知道是谁改的），没成要一直挂着。
   */
  | {
      kind: "credential_rotated";
      id: number;
      provider: string;
      persisted: boolean;
      /** 人话。成功说写到哪儿了，失败说卡在哪一步。**不含 token** */
      detail: string;
      at_ms: number;
    }
  /**
   * 上游返回了一个可疑的工具调用。
   *
   * **只有我们同时知道「这个调用长什么样」和「它来自哪个上游」** ——
   * 客户端弹批准提示的同一瞬间，我们弹一条通知。
   */
  | {
      kind: "tool_call_flagged";
      id: number;
      provider: string;
      tool: string;
      rule: string;
      why: string;
      excerpt: string;
      high: boolean;
      /** 真的切断了流吗。**高危 + 不受信任 + 拦截态**三者同时成立才会 */
      blocked: boolean;
      at_ms: number;
    };

/**
 * 上游报回来的 token 用量。
 *
 * **上游不给就是没有**，不是零 —— 记一笔 0 是在撒谎，而它会一路混进
 * 「这次花了多少」里。所以整个字段是可选的。
 */
export interface UsageView {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_1h?: boolean;
}

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
  /** 哪个模型。**决定这次多贵、多慢的就是它** */
  model?: string;
  path: string;
  atMs: number;
  /** 进行中的行也要立刻画出来 —— 流式请求可能要跑几分钟 */
  state: "in_flight" | "done" | "failed";
  status?: number;
  ttfbMs?: number;
  durationMs?: number;
  bytes?: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * 这次花了多少微分。
   *
   * **事件流里没有它。**价钱是存储层落库时按价目表算出来的，算在
   * 事件之后 —— 所以刚跑完的那一行先是空的，几秒后由历史补上
   * （见 useRequests 的对账）。空着显示「—」，不显示 0。
   */
  costMicros?: number;
  /** 上游没给用量、只能按输入长度估的。显示时要带 `~` */
  costEstimated?: boolean;
  error?: string;
  /** 这次发出去之前换掉了什么。只有类别和计数，没有原值 */
  redacted?: { kind: string; what: string; count: number }[];
  /** 做过方言互转的话，转成了什么、丢了什么 */
  translated?: { from: string; to: string; dropped: string[] };
  /** 上游返回的可疑工具调用 */
  flagged?: Extract<CoreEvent, { kind: "tool_call_flagged" }>[];
}

export function applyEvent(rows: Map<number, RequestRow>, ev: CoreEvent): void {
  switch (ev.kind) {
    case "request_started":
      rows.set(ev.id, {
        id: ev.id,
        client: ev.client,
        provider: ev.provider,
        // 老记录里没有这个字段，空串当作「不知道」
        model: ev.model || undefined,
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
        if (ev.usage) {
          r.inputTokens = ev.usage.input;
          r.outputTokens = ev.usage.output;
        }
      }
      break;
    }
    case "locally_answered":
    case "config_reloaded":
    case "config_rejected":
    case "scan_alert":
      // 都不进请求列表。配置事件和扫描告警是另一回事，App 单独接 ——
      // 后者说的是磁盘上的文件，和请求没有关系。
      break;
    case "redacted": {
      const r = rows.get(ev.id);
      if (r) r.redacted = ev.items;
      break;
    }
    case "tool_call_flagged": {
      const r = rows.get(ev.id);
      if (r) (r.flagged ??= []).push(ev);
      break;
    }
    case "translated": {
      const r = rows.get(ev.id);
      if (r) r.translated = { from: ev.from, to: ev.to, dropped: ev.dropped };
      break;
    }
    case "credential_rotated":
      // 不进请求列表：它说的是配置文件该改了，跟哪一次请求无关。
      // App 单独接，挂一条一直在的提示。
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

// —— 观测 ——

/**
 * 一段时间的汇总。
 *
 * **实测、估算、没有价格是三个数，不是一个。**「今日 $12.40 实测 +
 * ~$0.80 估算，另有 3 条没有价格」比一个混在一起的 $13.20 诚实得多 ——
 * 后者看起来是个确定的数字。
 */
export interface Summary {
  requests: number;
  failed: number;
  /** 本地应答的次数。**是个正向数字** */
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
  /** 走订阅型上游的请求数。**不参与金额合计** */
  subscription_requests: number;
  /** 那些请求用掉的 token。**它才是订阅用户该看的量** */
  subscription_tokens: number;
  /** 缓存命中一共省下了多少微分。**算的是差额** */
  cache_saved_micros: number;
  /** 价目表的快照日期。**成本旁边要标它** */
  pricing_date: string;
}

export interface LatencyView {
  model: string;
  p50: number;
  p95: number;
  /** 「800ms」是 3 个样本还是 300 个，含义完全不同 */
  samples: number;
}

/** 尝试链里的一跳。 */
export interface AttemptView {
  provider: string;
  /** 「成功」「429」「连不上上游」这类人话。**失败的原因要留着** */
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
  /** 服务它的那家怎么收钱：`per-token` / `subscription` / `unknown` */
  billing: string;
  /** 缓存命中省下了多少微分。null = 算不出来 */
  cache_saved_micros: number | null;
}

export interface StorageStatus {
  level: string;
  rows: number;
  blob_bytes: number;
  /** **永远是 false** —— 观测挂了，代理照跑 */
  forwarding_affected: boolean;
}

/** 一份存下来的 body。**已脱敏**。 */
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
 * 「过去 7 天，有 3 个请求把你的 API key 发给了 relay」。
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
  /** 按上游分。**和按模型分是两个问题** */
  latency_by_provider: LatencyView[];
  history: HistoryRow[];
  storage: StorageStatus | null;
  leaks: LeakGroup[];
  /**
   * 按所选时间范围分格。**稀疏的** —— core 那边只产出有数据的桶，
   * 空桶由 `densify` 在界面补（只有界面知道要画多少格）。
   */
  buckets?: CostBucket[];
  by_model?: CostGroup[];
  by_provider?: CostGroup[];
  /** 上面三样的时间窗起点，补空桶要用 */
  since_ms?: number;
}

/** 按模型或上游分组的花费。 */
export interface CostGroup {
  name: string;
  requests: number;
  cost_micros: number;
  /** **算不出价钱的条数要单独给** —— 当成 0 加进去，那根条就是偏短的 */
  unpriced_requests: number;
  input_tokens: number;
  output_tokens: number;
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
 * L3 测速要花多少。
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

/** 一个出站代理。**密码不在这里** —— 服务端只给「有没有认证」 */
export interface ProxyView {
  name: string;
  /** `socks5` / `socks5h` / `http` / `https` */
  kind: string;
  addr: string;
  has_auth: boolean;
  /** 有几家上游在用它。删之前要知道 */
  used_by: number;
}

/** 一类客户端辅助请求的处置 */
export interface ProbeView {
  id: string;
  label: string;
  what: string;
  /** `intercept` / `route` / `passthrough` */
  mode: string;
}

export interface LimitsView {
  max_concurrent: number;
  per_provider: number;
  queue_depth: number;
  queue_timeout_secs: number;
}

/** 一条规则 */
export interface RuleView {
  name: string;
  to: string;
  /** `when` 的人话摘要。空 = 兜底 */
  conditions: string[];
}

/** 这台机器上的一张网卡（`GET /interfaces`）。同一张网卡可以有多个地址 */
export interface NicView {
  /** `en0`、`lo0`、`utun3` */
  name: string;
  addr: string;
  loopback: boolean;
}

// —— 配置（双向同步） ——
export interface ConfigText {
  path: string;
  text: string;
  /** `blake3:xxxxxxxxxxxx`。**改配置时必须带上它** —— 那是乐观并发的凭据 */
  version: string;
}

export type PatchValue = string | number | boolean | null;

/**
 * 一次配置改动。
 *
 * 路径一律**按名字**定位：`/providers/官方/base_url`、`/clients/codex`。
 * 下标会在用户重排之后指向另一个东西，而那种错误完全静默。
 */
export type PatchOp =
  | { op: "replace"; path: string; value: PatchValue }
  /** 往块式列表末尾加一项。`item` 是那一项的 YAML 片段，不带前导的 `- ` */
  | { op: "append"; path: string; item: string }
  /** 删掉列表里的一项。`path` 指向**那一项** */
  | { op: "remove"; path: string }
  /**
   * 把一个列表清成空的（`[]`）。
   *
   * **和「把这个键删掉」不是一回事**：`allow` 不写 = 跟客户端方言走，
   * `allow: []` = 一个都不给。界面上那是两个不同的选项。
   */
  | { op: "clear"; path: string };

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
  /** 这家怎么收钱。`cheapest` 策略和成本栏都看它 */
  billing?: string | null;
  /** 判完的结果（没写时按 base_url 判） */
  trust?: string;
  /**
   * 用户显式写过 `trust` 吗。
   *
   * **要能区分「自动判成不受信任」和「用户写了不受信任」** —— 前者改
   * base_url 就会变，后者不会，显示成一样会让用户以为自己改不动它。
   */
  trust_explicit?: boolean;
  /**
   * 这家实际会脱哪几类。给的是判完的结果 —— 不写的话官方端点
   * 是空的、其余是那四类默认。
   */
  redact?: string[];
  /** 用户显式写过 `redact` 吗。「没写」和「写了空」要能分开 */
  redact_explicit?: boolean;
}

/** 一条路由 —— 一组规则，加上绑了它的密钥 */
export interface RouteView {
  name: string;
  /** 没绑路由的密钥走的就是这条 */
  default: boolean;
  /** **显式绑了这条的密钥。**默认路由这里通常是空的 —— 走它的人是「没绑」 */
  clients: string[];
  rules: RuleView[];
}

export interface GroupView {
  name: string;
  kind: string;
  /** 同一次会话固定走同一家。**这一项直接决定账单** */
  session_affinity?: boolean;
  /** `select` 组当前选中谁。界面要能切它 —— 那是这个策略的全部意义 */
  selected?: string | null;
  providers: string[];
  /** 这个策略会不会让 prompt cache 不稳定。**要直说** —— 它决定账单。 */
  hurts_cache: boolean;
}

export interface ClientView {
  name: string;
  key: string;
  max_concurrent: number | null;
  /** 绑的那条路由。`null` = 走默认路由 */
  route?: string | null;
  /** 能看到哪些模型。三态：不写 / 写非空 / 写 `[]`（一个都不给） */
  allow?: string[] | null;
}

export interface ListenView {
  bind: string;
  port: number;
  allow_from: string[];
  exposed: boolean;
}

/** 「检查价格更新」第一步：**先说要访问什么、多大** */
export interface UpdateOffer {
  url: string;
  /** `null` = 对面没给 Content-Length */
  bytes: number | null;
  current_date: string;
}

/** 第二步：下载解析完，**给 diff，还没写** */
export interface UpdatePreview {
  models: number;
  changes: PriceChangeView[];
  /** 第三步要带回来 —— 否则「确认写入」写的可能是另一次下载的结果 */
  token: string;
}

export interface PriceChangeView {
  model: string;
  /** `null` = 新增的 */
  old_input: number | null;
  new_input: number;
  old_output: number | null;
  new_output: number;
}

/** 一条用户自己写的价格（第三层）。**单位是每百万 token 的美元** */
export interface PriceRow {
  /** `null` = 对所有上游生效 */
  provider: string | null;
  model: string;
  input: number;
  output: number;
  /** 内置快照里本来就有这个模型 —— 界面要说清「这条是在覆盖」 */
  overrides_builtin: boolean;
}

export interface PricingView {
  rows: PriceRow[];
  snapshot_date: string;
  /** 最近 7 天算不出价钱的请求数。**这是这一页存在的理由** */
  unpriced_recent: number;
  unpriced_models: string[];
}

/** 光标落在配置的哪一段上 */
export interface ConfigAt {
  section: string | null;
  /** 那一项的名字。**不给下标** —— 用户重排之后它指向另一个东西 */
  name: string | null;
}

export interface Overview {
  providers: ProviderView[];
  /** 配置里定义过的代理 —— 换代理要从这里选，手打会打错 */
  proxies?: ProxyView[];
  routes: RouteView[];
  groups: GroupView[];
  clients: ClientView[];
  listen: ListenView;
  /** 三条防线各自的状态。界面要能配，不只是显示 */
  security?: SecurityView;
  /** 没绑路由的密钥走哪条 */
  default_route?: string;
  /** 客户端自己发的辅助请求怎么处理 */
  client_probes?: ProbeView[];
  limits?: LimitsView;
}

/**
 * 三条防线。
 *
 * **「拦截」在每条上做的事不一样** —— 脱敏是替换、审查是切断、扫描只
 * 告警。界面上统一叫「拦截」的话，用户点下去并不知道会发生什么。
 */
export interface SecurityView {
  redact: string;
  inspect_tools: string;
  scan_configs: string;
  scan_rules_added: number;
  scan_rules_disabled: number;
}

// ---------------------------------------------------------- 客户端接管
//
// **`DetectedClient` 和上面的 `ClientView` 是两个东西**：那个是
// config.yaml 里的一把网关密钥，这个是本机上装着的一个 AI 客户端 App。
// 中文都叫「客户端」，混起来的话，「有几个客户端」这句话就有两个答案。

export interface DetectedClient {
  id: string;
  name: string;
  path: string;
  /** 跟完符号链接的真身。和 path 不同时要显示出来 */
  real: string;
  installed: boolean;
  has_config: boolean;
  adopted_at_ms: number | null;
  /** 配置里此刻的端点，**读出来的** */
  endpoint: string | null;
  shadows: string[];
  takes_effect: "immediately" | "on_restart";
  takes_effect_note: string;
  /** 需要重开终端的客户端不提示「一直没收到请求」—— 那是狼来了 */
  warns_when_silent: boolean;
  verified: "measured" | "fields_only";
  verified_note: string;
  costs: string[];
  /** 最后一次收到它的请求。**接管有没有生效，只有它能证明** */
  last_seen_ms: number | null;
}

export interface ManualClient {
  name: string;
  how: string;
  caveat: string;
}

export interface ClientsResponse {
  clients: DetectedClient[];
  manual: ManualClient[];
  gateway_base: string;
  keys: string[];
}

export interface PlanView {
  client: string;
  path: string;
  before: string | null;
  after: string;
  notes: string[];
  shadows: string[];
  noop: boolean;
  carries_secret: boolean;
  fields: string[];
}

export interface AdoptResponse {
  real: string;
  backup: string;
  created: boolean;
  warnings: string[];
  takes_effect_note: string;
}

export interface FindingView {
  level: "blocking" | "suspect" | "clear";
  title: string;
  detail: string;
  /** 用户可以自己执行的下一步。**我们不替他执行。** */
  fix: string | null;
}

// ---------------------------------------------------------------- 静态扫描

export interface ScanFinding {
  level: "high" | "medium" | "low";
  rule: string;
  kind: "hooks" | "mcp" | "skill" | "command" | "agent" | "instructions";
  kind_label: string;
  client: string;
  path: string;
  line: number;
  title: string;
  detail: string;
  /** 命中的那一行，**不可见字符已经换成可见记号** */
  excerpt: string;
}

export interface McpView {
  name: string;
  client: string;
  command: string;
  args: string[];
  url: string | null;
  /** **只有名字，没有值** */
  env_keys: string[];
  enabled: boolean;
  source: string;
  third_party: boolean;
}

export interface SkillView {
  name: string;
  client: string;
  path: string;
  allowed_tools: string[];
}

export interface HookView {
  client: string;
  event: string;
  command: string;
  source: string;
}

export interface ScanResponse {
  findings: ScanFinding[];
  mcp: McpView[];
  skills: SkillView[];
  hooks: HookView[];
  /** 同名但配置不同的 MCP server */
  conflicting: string[];
  unreadable: string[];
  scanned: number;
  rules_origin: string;
  rules_warning: string | null;
  projects: string[];
}

// ---------------------------------------------------------------- 会话

export interface SessionView {
  id: string;
  client: string;
  started_ms: number;
  ended_ms: number;
  turns: number;
  /** 有价格的那些轮次加起来，单位是**微分** */
  cost_micros: number;
  /** **没有价格的轮数。**「$1.23」和「$1.23，另有 4 轮没有价格」不是一个结论 */
  unpriced_turns: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cache_saved_micros: number;
  /** 上下文峰值。**一眼看出哪次任务的上下文失控了** */
  peak_input_tokens: number;
  models: string[];
  errors: number;
}

export interface TurnView {
  id: number;
  at_ms: number;
  model: string;
  provider: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  /** **没有价格就是 null，不是 0** */
  cost_micros: number | null;
  duration_ms: number | null;
  error: string | null;
}

export interface SessionDetail {
  session: SessionView;
  turns: TurnView[];
}

// ---------------------------------------------------------------- 路由试算

export interface RuleTrace {
  name: string;
  verdict: "matched" | "skipped" | "phase_two";
  /** 没命中时，是哪个条件没对上 */
  why: string | null;
}

export interface DryRunResult {
  outcome: "route" | "deny" | "no_match";
  rule: string | null;
  reason: string | null;
  candidates: string[];
  via_group: string | null;
  set: string[];
  trace: RuleTrace[];
  /** 这条路会不会伤到 prompt cache。**要直说 —— 它决定账单** */
  hurts_cache: boolean;
  /** 候选链里此刻熔断着的那些 */
  circuit_open: string[];
}

export interface McpOpRequest {
  op: "copy" | "remove";
  name: string;
  /** copy 时从哪个客户端取 */
  from?: string;
  to: string;
}

export interface McpTargetView {
  client: string;
  name: string;
  path: string;
  /** 能不能往里写。**不能写的照样在清单里** —— 看得见是第一目标 */
  copyable: boolean;
  why_not: string;
}

// ---------------------------------------------------------- 上游行为基线

export interface DriftView {
  metric: "tool_calls" | "flagged" | "errors";
  label: string;
  /** 比率，0..1 */
  recent: number;
  baseline: number;
  /** 两边各自的样本量。**必须一起显示** —— 没有它，比率是个没法判断可信度的数字 */
  recent_n: number;
  baseline_n: number;
  notable: boolean;
}

export interface ProviderBaseline {
  provider: string;
  recent_total: number;
  baseline_total: number;
  /** 数过形状的有多少条。和总数不同时要说清楚 */
  recent_inspected: number;
  baseline_inspected: number;
  drifts: DriftView[];
}

export interface BaselineResponse {
  recent_hours: number;
  baseline_days: number;
  providers: ProviderBaseline[];
  /** 观测层没起来。**不是没发现，是没看** */
  unavailable: boolean;
}

// ---------------------------------------------------------------- 请求重放

export interface ReplayQuote {
  model: string;
  provider: string;
  body_bytes: number;
  input_tokens: number;
  /** `null` = 订阅型，或者这个模型不在价目表里。**不是 0** */
  cost_micros: number | null;
  note: string;
  /** 发出去之前会不会脱敏 */
  will_redact: boolean;
  pricing_date: string;
}

export interface ReplayResult {
  provider: string;
  status: number;
  ttfb_ms: number;
  duration_ms: number;
  bytes: number;
  /** 已还原占位符、已脱敏、已截断 */
  body: string;
  original: {
    provider: string;
    status: number | null;
    ttfb_ms: number | null;
    duration_ms: number | null;
    bytes: number | null;
  };
}
