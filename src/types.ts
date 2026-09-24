// 界面这一侧的类型。
//
// **控制面契约的类型不在这里写。**它们由钉着的那版 tw-api 生成，提交在
// `./generated/tw-api.ts`（`src-tauri/tests/ts_bindings.rs` 核对它和钉着的
// core 一致），这里原样转出去。以前这里是手抄的镜像，和 Rust 那边对不对得
// 上全靠人记得改两遍。
//
// 留在这里的只有界面自己的东西：请求列表的行和把事件缝成行的那几个函数、
// 概览那一份（Rust 侧 `dashboard` 命令拼的）、金额的写法，以及几个封闭集合
// 在运行时要用的全部取值。
import type {
  CostBucket,
  CostBucketGroup,
  Event,
  Guard,
  HistoryRow,
  LatencyView,
  Msg,
  SecretItem,
  Status,
  StorageStatus,
  Summary,
  TranslatedView,
} from "./generated/tw-api";

export type * from "./generated/tw-api";

/** core 的事件流上的一条 */
export type CoreEvent = Event;

/** core 的 `/status` */
export type CoreStatus = Status;

// ─── 几个封闭集合的全部取值 ───
//
// 类型本身在协议里（`slug_enum!` 导出的字符串联合），这里只补界面要在运行时
// 遍历的取值，和「有规则表的那几项」这一个子集。

export const GUARDS: readonly Guard[] = ["redact", "inspect_tools", "hidden_text", "content", "output_limit"];

/** 有规则表的那几项。输出长度只有一个上限 */
export type RuleGuard = Exclude<Guard, "output_limit">;
export const isRuleGuard = (g: Guard): g is RuleGuard => g !== "output_limit";

/** 命中了工具调用规则的一个调用 */
export interface FlaggedCall {
  tool: string;
  rule: string;
  custom: boolean;
  /** 命中的那一小段，**已截断** */
  excerpt: string;
  /** 真的切断了吗 */
  blocked: boolean;
}

/** 一行请求，由四类事件缝出来。 */
export interface RequestRow {
  id: number;
  /** 请求带的网关密钥叫什么。**是身份，不是应用** —— 一把密钥可以几个应用共用 */
  client: string;
  /** 按请求头推测是哪个应用发的（`claude-code`、`codex`…）。可以伪造，只用来显示 */
  hint?: string;
  /** 非本机来的请求的来源地址。本机来的没有 */
  peer?: string;
  /** 请求带的那把密钥打码后的样子（`tw-re…wb4e`），请求那一刻的 */
  keyMasked?: string;
  provider: string;
  /** 哪个模型。**决定这次多贵、多慢的就是它** */
  model?: string;
  path: string;
  atMs: number;
  /**
   * 进行中的行也要立刻画出来 —— 流式请求可能要跑几分钟。
   *
   * `cancelled` 是客户端先断开的那些：**不算失败**，用量和金额只到断开
   * 那一刻。
   */
  state: "in_flight" | "done" | "failed" | "cancelled";
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
  /** 失败的原因。**存的是 core 发来的那条消息，不是一句话** —— 语言
   * 是在画的时候才定的，存成句子的话换了语言它不会跟着换 */
  error?: Msg;
  /**
   * 出站脱敏在这次请求里找到的东西（已打码），以及换没换。
   *
   * **不带类别。**翻历史时是从安全日志拼回来的，日志里没有类别；徽标也只用
   * 规则名和次数
   */
  secrets?: { replaced: boolean; items: Omit<SecretItem, "kind">[] };
  /** 做过格式转换的话，转成了什么、丢了什么 */
  translated?: TranslatedView;
  /** 命中了工具调用规则的调用 */
  flagged?: FlaggedCall[];
  /**
   * 它属于哪次会话，和 `SessionView.id` 同一个值。
   *
   * **只有落库之后才有。**会话 id 是存储层给的，事件里那个 `session_fp`
   * 只是指纹，差着起始时刻那一截。所以正在跑的那一条是没有会话的 ——
   * 它确实还没被记下来，归组时独立成行，落库之后自然归位。
   *
   * 认不出会话的（拼不出指纹的，比如 WebSocket）也没有 —— **不能拿一个假的
   * 把它们凑成一组**，它们之间唯一的共同点是我们不知道它属于谁。
   */
  session?: string;
}

export function applyEvent(rows: Map<number, RequestRow>, ev: CoreEvent): void {
  switch (ev.kind) {
    case "request_started":
      rows.set(ev.id, {
        id: ev.id,
        client: ev.client,
        hint: ev.client_hint ?? undefined,
        peer: ev.peer ?? undefined,
        keyMasked: ev.key_masked ?? undefined,
        provider: ev.provider,
        // WebSocket 这类认不出模型的请求发的是空串，当作「不知道」
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
    case "request_cancelled": {
      const r = rows.get(ev.id);
      if (r) {
        r.state = "cancelled";
        // 响应头之前就断开的没有状态码 —— 那就保留原样（也是没有）
        if (ev.status != null) r.status = ev.status;
        r.bytes = ev.bytes;
        r.durationMs = ev.duration_ms;
        // 用量停在断开那一刻。**没有就不填** —— 客户端可能在第一帧之前
        // 就走了，那时填 0 说的是一件没有发生过的事
        if (ev.usage) {
          r.inputTokens = ev.usage.input;
          r.outputTokens = ev.usage.output;
        }
      }
      break;
    }
    case "request_routed": {
      // 开始事件里的是首选的候选。**故障转移之后服务它的是另一家** —— 尝试链的
      // 最后一跳，和落库那一行归的是同一家
      const r = rows.get(ev.id);
      const last = ev.attempts[ev.attempts.length - 1];
      if (r && last) r.provider = last.provider;
      break;
    }
    case "locally_answered":
    case "config_reloaded":
    case "listen_changed":
    case "config_rejected":
    case "scan_alert":
    case "clients_changed":
    case "health_changed":
    case "models_changed":
    case "quota_seen":
    case "quota_exhausted":
    case "proxy_changed":
    case "auth_changed":
    case "credential_expired":
    case "events_dropped":
    case "hidden_text_found":
    case "content_matched":
    case "output_limited":
      // 都不进请求列表。三项请求和输出防护的命中在安全日志和请求详情里；拦下的
      // 请求随后有一条失败事件，那一行照常标成失败。
      //
      // 其余几种也不进。配置事件、扫描告警、熔断、额度、凭据、代理说的都是
      // 「现在什么情况」，而这张表装的是「刚才发生过什么」。App 单独接。
      break;
    case "secrets_found": {
      const r = rows.get(ev.id);
      if (r) r.secrets = { replaced: ev.replaced, items: ev.items };
      break;
    }
    case "tool_call_flagged": {
      const r = rows.get(ev.id);
      if (r)
        (r.flagged ??= []).push({
          tool: ev.tool,
          rule: ev.rule,
          custom: ev.custom === true,
          excerpt: ev.excerpt,
          blocked: ev.blocked,
        });
      break;
    }
    case "translated": {
      const r = rows.get(ev.id);
      if (r) r.translated = { from: ev.from, to: ev.to, dropped: ev.dropped };
      break;
    }
    case "request_priced": {
      const r = rows.get(ev.id);
      if (r && ev.cost_micros != null) {
        r.costMicros = ev.cost_micros;
        r.costEstimated = ev.cost_estimated === true;
      }
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
        if (ev.duration_ms != null) r.durationMs = ev.duration_ms;
        if (ev.bytes != null) r.bytes = ev.bytes;
        // 断在中间的失败，上游已经为这些 token 计了费
        if (ev.usage) {
          r.inputTokens = ev.usage.input;
          r.outputTokens = ev.usage.output;
        }
      }
      break;
    }
  }
}

/**
 * 快照在路上的时候，事件流上见到了什么。
 *
 * core 的快照是某一刻拍下的，到这边时已经晚了一截：这中间开始的它没有，
 * 这中间结束的它还有。从问出去的那一刻起把两样都记下，快照到了才合得对。
 */
export interface SeenSince {
  started: Set<number>;
  ended: Set<number>;
}

/**
 * 把 core 的「此刻还在跑的」快照（`in_flight_requests`）补成「进行中」的行。
 * 返回有没有改动。
 *
 * **只补事件流没给的。**中途结束的不补 —— 补进去就是一行永远等不到结局的
 * 「进行中」；中途开始的、已经在跑的也不补 —— 那一行事件流已经建了，开始
 * 事件再套一遍会把已经到了的响应头冲掉。
 *
 * 同一个 id 已经有一行、但它不在跑：那是上一次 core 留下的（见
 * `interruptInFlight`）。core 重启后接着库里最大的号往下发，而没落库的
 * 那些号会被重新用上 —— 新的请求顶掉旧的那行。
 */
export function applyInFlight(
  rows: Map<number, RequestRow>,
  open: CoreEvent[],
  seen: SeenSince,
): boolean {
  let changed = false;
  for (const ev of open) {
    if (ev.kind !== "request_started") continue;
    if (seen.ended.has(ev.id) || seen.started.has(ev.id)) continue;
    if (rows.get(ev.id)?.state === "in_flight") continue;
    applyEvent(rows, ev);
    changed = true;
  }
  return changed;
}

/** core 停下时还没结束的请求，那一行上写的话。中文见 `core.i18n.ts` */
export const CORE_STOPPED: Msg = {
  code: "lite.core_stopped",
  text: "The core stopped before the request finished, so the request was cut off.",
};

/**
 * core 停了：还在「进行中」的行再也等不到结局。返回有没有改动。
 *
 * **记成失败，写明原因。**core 一停，这些连接就断了，客户端那边收到的也
 * 是一个错误；而它们不会落库 —— 结局没来，存储层那一行永远不写。留着
 * 「进行中」的话，它们会一直转下去。
 */
export function interruptInFlight(rows: Map<number, RequestRow>): boolean {
  let changed = false;
  for (const r of rows.values()) {
    if (r.state !== "in_flight") continue;
    r.state = "failed";
    r.error = CORE_STOPPED;
    changed = true;
  }
  return changed;
}

/** 概览要的全部数据，Rust 侧 `dashboard` 命令一次拼好 */
export interface Dashboard {
  summary: Summary;
  latency: LatencyView[];
  /** 按上游分。**和按模型分是两个问题** */
  latency_by_provider: LatencyView[];
  history: HistoryRow[];
  storage: StorageStatus | null;
  /**
   * 按所选时间范围分格。**稀疏的** —— core 那边只产出有数据的桶，
   * 空桶由 `densify` 在界面补（只有界面知道要画多少格）。
   */
  buckets: CostBucket[];
  /**
   * 同样的格子，再按模型分层。
   *
   * 趋势图靠它把两个问题画成同一张图：**什么时候花的**，以及**花在
   * 哪个模型上**。拆成两张图的话，读的人要在它们之间自己对时间。
   */
  buckets_by_model: CostBucketGroup[];
  /** 上一个等长区间的汇总。**没有就是没有对比，不是零** */
  prev: Summary | null;
  /** 上面几样的时间窗起点，补空桶要用 */
  since_ms: number;
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
