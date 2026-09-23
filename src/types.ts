import type { CostBucket } from "./format";
// 控制面契约的 TS 侧。**类型的真相源是 Rust 的 tw-api**；
// 这里是手工镜像，改一边就要改另一边。
//
// 手工镜像是有代价的，而且这个代价会长大 —— cc-switch 的托盘 i18n 就是
// 一份手抄的镜像，注释里自己承认了。等类型多起来要换成从 Rust 导出
// （ts-rs 之类），现在还不值得。

/**
 * core 发来的一句给人看的话。
 *
 * **core 不翻译，只出英文。**它给的是一个稳定的码、填进句子的参数，以及
 * 英文原句；界面拿 `code` 去自己的词表里找句子（见 `src/i18n/core.i18n.ts`），
 * 找不到就显示 `text` —— 词表里还没有这句时，一句英文总好过一个码。
 *
 * **码是契约，句子不是。**core 改措辞不用动码，界面那边什么都不用做。
 */
export interface Msg {
  code: string;
  /** 填进句子里的参数，按名字取。值已经写成字符串 */
  args?: Record<string, string>;
  /** 英文原句，参数已经填好 */
  text: string;
}

export type CoreEvent =
  /**
   * `session_fp` 是这段对话的**指纹**，不是会话 id。
   *
   * **两者差一截。**会话 id 是存储层拼的 `{指纹}-{首次时刻}` —— 时刻在
   * 里面，所以同一段对话隔天再聊算两次任务。拿指纹去当 id 用，会凭空
   * 长出一批对不上任何会话的影子组。界面因此不读它：归组只认落库之后
   * 的 `session`。
   */
  | { kind: "request_started"; id: number; client: string; client_hint?: string | null; peer?: string | null; key_masked?: string | null; provider: string; billing: string; model: string; method: string; path: string; at_ms: number; session_fp?: string | null }
  | { kind: "request_headers"; id: number; status: number; ttfb_ms: number }
  /**
   * 三种结局（结束、失败、取消）都带着 `model`，和开始事件里的是同一个。
   *
   * **听的人不一定是从开始时就在听的。**实时曲线只在概览打开时挂着，而
   * 用量是在结局里才到的 —— 模型名只在开始事件里的话，打开概览时正在跑
   * 的那条请求，结束时就不知道该记在哪个模型上。WebSocket 那条路是空串。
   */
  | { kind: "request_finished"; id: number; model: string; status: number; bytes: number; duration_ms: number; usage?: UsageView }
  /**
   * 失败了。`source` 和响应头 `x-thinkwatch-error` 是同一个词表。
   *
   * **断在流中间的失败带着用量**（上游断了、被防火墙切断）：那时上游已经
   * 计了费。响应头之前就失败的没有 `bytes` 和 `usage`，但有 `duration_ms`。
   */
  | {
      kind: "request_failed";
      id: number;
      model: string;
      source: string;
      message: Msg;
      bytes?: number;
      duration_ms?: number;
      usage?: UsageView;
    }
  /**
   * 客户端没等到响应结束就断开了（Claude Code 里按 Esc）。
   *
   * **不是失败。**上游那时已经在计费，所以它带着到断开为止的用量，core
   * 照样落库、照样算钱；但输出只计到断开那一刻，金额一律按估算。响应头
   * 到达之前就断开的，没有状态码。
   */
  | {
      kind: "request_cancelled";
      id: number;
      model: string;
      status?: number;
      bytes: number;
      duration_ms: number;
      usage?: UsageView;
    }
  /**
   * 客户端的辅助请求被本地应答了，一个字节都没发给上游。
   *
   * **它不进请求列表。**成本 0、延迟 0 的东西混进请求总数和延迟统计里，
   * 会让那两个数字都变得没意义。它单独计数。
   */
  /** `probe` 和 `ProbeView.id` 是同一个词表 */
  | { kind: "locally_answered"; id: number; client: string; client_hint?: string | null; peer?: string | null; probe: string; at_ms: number }
  /** 配置换了一份新的进去，已经生效。界面靠它知道自己手里那份过期了。 */
  | { kind: "config_reloaded"; id: number; version: string; origin: ConfigOrigin; at_ms: number }
  /**
   * 网关换了监听地址，或者没换成（旧的还在服务）。**和 `config_reloaded` 是两件
   * 事**：配置换进去之后监听器才开始换，只听那一条读到的是换之前的地址。
   */
  | { kind: "listen_changed"; id: number; addr?: string; error?: Msg; at_ms: number }
  /**
   * 新配置没过关，**旧的还在服务**。
   *
   * 这不是崩溃，是一条要展示给人看的信息 —— 桌面工具不能因为一个笔误
   * 就断线。
   */
  | {
      kind: "config_rejected";
      id: number;
      /** `syntax`：YAML 写坏了；`schema`：字段名或取值不对；`semantics`：字段各自正确，合起来不成立 */
      stage: "syntax" | "schema" | "semantics";
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
   * 客户端配置面上的文件动了 —— **不管改了什么**。
   *
   * 和 `scan_alert` 是两件事：那条说的是「出现了可疑内容」，值得打断
   * 用户；这条只说「那几个文件变了」，客户端那一页据此重读一遍接管
   * 状态。用户在编辑器里把地址改回原样一点都不可疑，但界面必须跟上。
   */
  /**
   * 这次请求花了多少 —— **在它跑完之后一小会儿才知道**。
   *
   * 价钱不在数据面的职责里：网关知道用了多少 token，而单价是存储层
   * 落库时查价目表算出来的。所以它是一条独立事件。
   *
   * 三个值都可能是 `null`：上游没报用量、模型不在价目表里、或者那家
   * 是订阅计费 —— **那都不是零**。
   */
  | {
      kind: "request_priced";
      id: number;
      cost_micros?: number | null;
      cost_estimated?: boolean;
      cache_saved_micros?: number | null;
      at_ms: number;
    }
  | { kind: "clients_changed"; id: number; at_ms: number }
  /**
   * 某家上游的熔断器开了或者合上了。
   *
   * **这是少数几个不挂在任何一次请求上的状态变化**，而它在概览和上游
   * 列表上都看得见。没有它，界面只能定时重读整份配置概览才能发现。
   */
  | { kind: "health_changed"; id: number; provider: string; state: "open" | "closed"; at_ms: number }
  /**
   * 某家上游的模型清单开始获取了，或者获取完了。后台获取（启动时、每天、
   * 改了地址或凭据之后）不挂在任何一次调用上，界面靠它知道要重读概览。
   */
  | { kind: "models_changed"; id: number; provider: string; at_ms: number }
  /**
   * 一个请求发出前，出站脱敏找到了东西。
   *
   * **观察档和拦截档报的是同一条**，差别只在 `replaced`：观察档只记录，
   * 请求原样发出；拦截档已经换成了占位符。事件里的值一律打码。
   */
  | {
      kind: "secrets_found";
      id: number;
      provider: string;
      replaced: boolean;
      items: SecretItem[];
      at_ms: number;
    }
  /**
   * 这次请求做了格式转换。
   *
   * **`dropped` 非空时必须让用户看见**：目标格式没有对应物的字段只能丢 ——
   * 悄悄丢掉的话，用户会发现「扩展思考开了却没生效」而完全不知道从哪儿查起。
   */
  | ({ kind: "translated"; id: number; provider: string; at_ms: number } & TranslatedView)
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
      /** 内置规则的 id，或者自定义规则的名字 */
      rule: string;
      custom?: boolean;
      /** 为什么值得看一眼（英文）。自定义规则是空的 */
      why: string;
      excerpt: string;
      /** 这条规则在拦截档下做什么：`cut` / `record` */
      action: string;
      /** 真的切断了流吗。**拦截档 + 规则是切断**两者同时成立才会 */
      blocked: boolean;
      at_ms: number;
    }
  /**
   * 浏览器里的登录有结果了。
   *
   * **界面等的就是这一条**：收到它就能说明结果，不用一直问 core。
   */
  | {
      kind: "login_finished";
      id: number;
      /** 发起登录时拿到的 ID */
      login: string;
      status: LoginStatus;
      provider?: string;
      error?: string;
      at_ms: number;
    }
  /**
   * 路由走完了：命中哪条规则、试过哪几家、最终服务的那家怎么收钱。
   *
   * 流量列表拿它改「上游」那一列：开始事件里的是首选的候选，故障转移之后服务它
   * 的是尝试链的最后一跳。
   */
  | {
      kind: "request_routed";
      id: number;
      rule: string;
      group?: string | null;
      attempts: AttemptView[];
      billing: string;
    }
  /** 上游在响应头里报了订阅额度。**事件里就是完整的数**，不用回查 */
  | { kind: "quota_seen"; id: number; provider: string; windows: QuotaWindow[]; at_ms: number }
  /** 某个额度窗口用完了 */
  | {
      kind: "quota_exhausted";
      id: number;
      provider: string;
      window: string;
      resets_at_ms?: number | null;
      at_ms: number;
    }
  /** 网关发现一个代理不通了，或者又通了。现状在概览的 `ProxyView.unreachable` 里 */
  | {
      kind: "proxy_changed";
      id: number;
      proxy: string;
      state: "reachable" | "unreachable";
      failed?: L1Stage | null;
      detail?: Msg | null;
      at_ms: number;
    }
  /** 上游拒绝了凭据，或者又接受了。现状在概览的 `ProviderView.auth_rejected` 里 */
  | {
      kind: "auth_changed";
      id: number;
      provider: string;
      state: "accepted" | "rejected";
      status?: number | null;
      at_ms: number;
    }
  /** OAuth 凭据失效，要重新登录。现状在概览的 `oauth.needs_login` 里 */
  | { kind: "credential_expired"; id: number; provider: string; detail: string; at_ms: number }
  /**
   * 事件流丢了 `count` 条事件：只靠事件维护的状态要整体对一次账。
   *
   * 两个来源：core 那边这个订阅者跟不上；或者桌面版和 core 之间的连接断过又
   * 接上 —— 那时 `count` 是 0，丢了多少不知道。
   */
  | { kind: "events_dropped"; id: number; count: number; at_ms: number };

/** `done` 之外都不会留下上游 */
export type LoginStatus = "pending" | "done" | "failed" | "expired" | "cancelled";

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
  /**
   * 网关**此刻**在听的地址（配置里写的那个，不含顺带开着的回环）。跟着真实的
   * 监听器走：换了端口之后就是新的，没换成时仍是旧的，原因在 `listen_error`。
   * 安全模式下是 null
   */
  gateway_addr: string | null;
  /** 配置里的地址没能换上的原因。**这时旧地址还在服务** */
  listen_error?: Msg | null;
  config_path: string;
  clients: number;
  providers: number;
  uptime_secs: number;
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
  /** 出站脱敏在这次请求里找到的东西（已打码），以及换没换 */
  secrets?: { replaced: boolean; items: SecretItem[] };
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
      // 都不进请求列表。配置事件、扫描告警、熔断、额度、凭据、代理说的都是
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

/** 模型清单的结果。空列表不足以表达三种不同的情况 —— 见 Rust 侧的注释。 */
export type ModelList =
  | { kind: "listed"; models: string[] }
  /** 上游没有这个接口。不是错误，但按模型路由那类功能对它用不了。 */
  | { kind: "not_implemented"; status: number }
  /** 2xx 但我们没认出形状 —— 这是我们的缺口，要报出来去修。 */
  | { kind: "unrecognized"; sample: string }
  | { kind: "empty" };

/** 检测一个上游的结果（不保存） */
export interface ProviderTestResult {
  /** 地址通、凭据被接受 */
  ok: boolean;
  /** 按哪种协议测的 */
  protocol: string | null;
  latency_ms: number;
  models: ModelList;
  /** 经由哪个代理。直连时没有 */
  via?: string | null;
  error: string | null;
}

/** 建连的哪一步、对着谁 */
export interface L1Stage {
  /** `config`：地址或代理配置不可用，没有开始建连；`handshake`：代理协议的握手，含认证 */
  step: "config" | "dns" | "tcp" | "tls" | "handshake";
  peer: "upstream" | "proxy";
}

/**
 * L1 测速的一段。**分段是个列表而不是固定的 DNS/TCP/TLS 三段** ——
 * 走代理时形状本来就不同：多出代理握手，而 socks5h 下根本没有本地
 * DNS 那一段。
 */
export interface L1Segment {
  stage: L1Stage;
  ms: number;
}

/** 没有出现在分段里的一步。**不说的话，缺一段看起来就像 bug** */
export interface L1Skip {
  stage: L1Stage;
  /** `plain_http`：`http://` 地址没有 TLS；`ip_address`：地址已是 IP；`proxy_resolves`：域名由代理解析 */
  reason: "plain_http" | "ip_address" | "proxy_resolves";
}

export interface L1Result {
  /** 测的是哪个上游或代理的名字。回显出来，别让用户猜点的那一下测了谁 */
  target: string;
  via?: string | null;
  ok: boolean;
  segments: L1Segment[];
  total_ms: number;
  skipped?: L1Skip[];
  /** 失败在哪一步 */
  failed?: L1Stage | null;
  /** 失败的原因，不带步骤前缀 */
  error?: Msg | null;
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
  /**
   * 有多少条请求**价目表里没有它的模型**：用量是有的，缺的是单价。
   * **不是 0，是「不知道」。**配一个价格就能解决。
   */
  unpriced_requests: number;
  /**
   * 有多少条请求**没有拿到用量**，所以同样算不出花费：上游没有报告，或者
   * 连接在报告之前就结束了。配价格解决不了它。
   */
  no_usage_requests: number;
  /**
   * 用了缓存之后净省下多少微分。
   *
   * **净额：命中节省的部分，减去写入产生的溢价。**缓存写入通常按高于
   * 输入的单价计费，所以这个数可以是负的 —— 而负数是一条结论：这份
   * 用法上，缓存反而抬高了总支出。
   *
   * 具体倍率各家不同，由价目表按模型给出；界面上不写死任何一家的数字。
   */
  cache_saved_micros: number;
  /**
   * 本区间两项防护各留下了几条记录。**和安全日志数的是同一批** —— 概览上
   * 点开这个数，落到的日志就是这么多条
   */
  security: SecurityCounts;
  /** 价目表的快照日期 */
  pricing_date: string;
}

export interface LatencyView {
  model: string;
  p50: number;
  p95: number;
  /** 「800ms」是 3 个样本还是 300 个，含义完全不同 */
  samples: number;
}

/** 尝试链里的一跳。**失败的原因要留着** */
export interface AttemptView {
  provider: string;
  /**
   * `served`：这一跳接下了请求（上游回 4xx 也算）；`status`：上游返回 5xx
   * 或 429，换下一个；`error`：没有收到响应。
   */
  outcome: "served" | "status" | "error";
  /** 上游返回的状态码。`error` 时没有 */
  status?: number | null;
  /** `error` 时的说明 */
  error?: string | null;
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
  /** 失败的原因 */
  error: Msg | null;
  local: boolean;
  /** 客户端没等到响应结束就断开了。**不是失败**，`error` 为空 */
  cancelled: boolean;
  /** 路由决策与尝试链。本地应答的、被规则拒绝的、上游应答之前客户端就断开的没有 */
  routing?: RoutingView;
  /** 服务它的那家怎么收钱：`per-token` / `free`。本地应答是 `free` */
  billing: string;
  /** 缓存命中省下了多少微分。没有 = 算不出来 */
  cache_saved_micros?: number;
  /** 按什么价格算的。没算出金额的没有 */
  price_source?: PriceSourceView | null;
  /** 服务它的那一跳做过的格式转换。直通的没有 */
  translated?: TranslatedView | null;
  /** 它属于哪次会话，和 `SessionView.id` 同一个值。认不出的没有 */
  session?: string | null;
  /** 两项防护在这条请求上留下的记录。没命中的没有 */
  security?: SecurityEventView[];
  /** 按请求头推测是哪个应用发的。可以伪造，只用来显示 */
  client_hint?: string | null;
  /** 非本机来的请求的来源地址。本机来的没有 */
  peer?: string | null;
  /** 请求带的那把密钥打码后的样子，请求那一刻的 */
  key_masked?: string | null;
}

/** 一次请求做过的格式转换 */
export interface TranslatedView {
  /** 客户端的格式，和上游协议同一个词表 */
  from: string;
  /** 服务它的上游的格式 */
  to: string;
  /** 转不过去、被丢掉的字段，按它在请求体里的位置写：`thinking`、`messages.content.thinking` */
  dropped: string[];
}


export interface StorageStatus {
  /** 请求记录启动了没有。`false` 时这段时间的请求都不会留下 */
  recording: boolean;
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
  /**
   * 请求还在跑。记录要等结局才落库，这时的 `row` 是到目前为止知道的那些：耗时、
   * 用量、费用、响应体都还没有。这个请求的计价事件到了再取一次，就是完整的
   */
  in_flight: boolean;
}


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

/** 一个时间桶里，某一个模型的那部分。 */
export interface CostBucketGroup {
  at_ms: number;
  name: string;
  requests: number;
  failed: number;
  cost_micros_exact: number;
  cost_micros_estimated: number;
  /**
   * 这一格里这一项用掉的 token。
   *
   * **四类分开给。**它们的单价差十倍以上，加成一个数之后既算不回钱，
   * 也说不清这段时间是在写新上下文还是在吃缓存。
   */
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
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
  /** 输出上限。**没有 = 这家不接受输出上限**（ChatGPT 账号），那时
      `cost_micros` 也没有 —— 回答有多长由模型决定 */
  max_output_tokens?: number | null;
  /** 按量计费算得出来时是那个数，不计费时是 0，无法计价时是 null */
  cost_micros?: number | null;
  /** `per-token` / `free` */
  billing: string;
  /** 服务不了这个模型：`out_of_scope` / `not_offered`。不进合计，也不会被测 */
  skipped?: string | null;
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
  error?: Msg | null;
}

/** 一个出站代理。**用户名和密码都不在这里** —— 服务端只给「有没有认证」 */
export interface ProxyView {
  name: string;
  /** `socks5h` / `socks5` / `http` / `https` */
  kind: string;
  addr: string;
  has_auth: boolean;
  /** 哪些上游在用它。删之前要知道，改名时它们会跟着改 */
  used_by: string[];
  /**
   * 网关发现它不通了：经它转发的请求连不上之后检过一次。之后经它的请求成功了、
   * 或者再检一次通了，就又没有了。**网关不定时探测**，没有它不等于刚测过是通的
   */
  unreachable?: ProxyFault | null;
}

/** 网关发现一个代理不通时，检出来的样子 */
export interface ProxyFault {
  /** 卡在哪一步。说不出来的没有 */
  failed?: L1Stage | null;
  detail: Msg;
  /** 什么时候检的 */
  at_ms: number;
}

/** 一类客户端辅助请求的处置 */
export interface ProbeView {
  /** `health_check` / `warmup` / `titling` / `topic_detect` / `suggestion` */
  id: string;
  /** `intercept` / `route` / `passthrough` */
  mode: string;
}

/** 一条规则。**全文**：编辑对话框靠它回填，交回去的 `RuleInput` 是同一套写法 */
export interface RuleView {
  name: string;
  /** `when` 里写了的条件，按固定顺序。空 = 兜底 */
  conditions: ConditionView[];
  /** 去向：上游名或组名。拒绝的规则和只附加改写的规则没有 */
  to?: string | null;
  /** 命中就拒绝，值是返回给客户端的原因 */
  deny?: string | null;
  set?: RuleRewrite | null;
  /** 没有条件，匹配全部请求 */
  catch_all: boolean;
  /** 在选定上游之后才判断 */
  phase_two: boolean;
  /** 转发或拒绝不会被采用：前面已有一条匹配全部请求的转发或拒绝。附加项照常生效 */
  shadowed: boolean;
}

/** 规则里的参数改写。不写就是不改 */
export interface RuleRewrite {
  model?: string | null;
  max_tokens?: number | null;
  thinking?: boolean | null;
}


/** 新建或修改路由时交过去的一条规则 */
export interface RuleInput {
  name: string;
  /** 空 = 兜底 */
  conditions: ConditionView[];
  to?: string | null;
  deny?: string | null;
  set?: RuleRewrite | null;
}

/** 新建或修改路由时交过去的定义。**规则的顺序就是数组的顺序** */
export interface RouteInput {
  name: string;
  rules: RuleInput[];
}

export interface RouteSave {
  route: RouteInput;
  base_version: string;
  /** 保存之后恰好使用这条路由的密钥。不给就不动 */
  keys?: string[];
  /** 一并设为「交给路由」的辅助请求类别：规则里的辅助请求条件只对它们生效 */
  route_probes?: string[];
}

export interface GroupInput {
  name: string;
  kind: GroupKind;
  providers: string[];
  selected?: string | null;
  session_affinity: boolean;
}

export interface GroupSave {
  group: GroupInput;
  base_version: string;
}

/** 网关知道的一个模型，以及能提供它的上游 */
export interface KnownModel {
  id: string;
  providers: string[];
}

/** 规则里的一个条件 */
export interface ConditionView {
  /** `when` 里的键，见 `conditionText` */
  field: string;
  /** 写的值。`intent` 和 `provider_would_be` 可以有多个；布尔条件是 `true` / `false`；数量条件是比较式（`>200k`） */
  values: string[];
}

/** 这台机器上的一张网卡（`GET /interfaces`），一张一行 */
export interface NicView {
  /** `en0`、`lo0`、`utun3`。配置里按它存 */
  name: string;
  /** 绑这张网卡时真正监听的地址：有 IPv4 就是 IPv4 */
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

/** 一版配置是谁写的 */
export type ConfigOrigin = "ui" | "cli" | "external" | "rollback" | "rotation";

export interface ConfigVersion {
  version: string;
  at_ms: number;
  origin: ConfigOrigin;
  bytes: number;
  /** 历史里包括当前版本，不标出来用户会回滚到自己身上 */
  current: boolean;
}

// —— 配置概览。**密钥只有来源，没有值** —— Rust 侧就没发过来。 ——
export interface ProviderView {
  name: string;
  /** 已脱敏。编辑时不要原样写回 */
  base_url: string;
  /** 地址里有被打码的部分 */
  base_url_masked: boolean;
  /** API 密钥：打过码的值或环境变量名。没有密钥是 null */
  key?: SecretView | null;
  /** 密钥放在哪个请求头里发：`x-api-key` / `authorization` / `x-goog-api-key` */
  auth_header: string;
  /** 其余请求头，按配置里的顺序 */
  headers?: HeaderView[];
  /** OAuth 的 token 端点和 client id。refresh token 和 client secret 不出 core */
  oauth?: OAuthView | null;
  /** 实际生效的协议。推断不出时为 null */
  protocol: string | null;
  /** 协议是配置里写明的，还是按地址推断的 */
  protocol_explicit: boolean;
  /** `direct` / `system` / 代理名 */
  proxy: string;
  /** `fail` / `direct` */
  on_proxy_fail: string;
  /** 服务不提供模型列表时用的手动清单 */
  models: string[];
  /** 启用范围：模型 ID 或 glob。null = 它提供的全部 */
  models_only?: string[] | null;
  /** `discovered` / `manual` / `none` */
  model_source: string;
  /** 最近一次向上游获取清单的结果。停用的上游不去获取，一直是 `pending` */
  model_status: ModelStatus;
  /** 正在获取。上一次的结果照常有效 */
  model_fetching: boolean;
  model_checked_at_ms?: number | null;
  /** `no_list` / `failed` 的原因 */
  model_error?: string | null;
  /** 现在能服务的模型数，已按启用范围过滤。停用时是 0 */
  model_count: number;
  disabled: boolean;
  health: "ok" | "open";
  /** 上游拒绝了凭据：最近一次得到答复的请求回的状态码（401 / 403）。没被拒是空的 */
  auth_rejected?: number | null;
  /** 计费方式：`per-token`（按价目表算，订阅账号也是）/ `free`（记 $0） */
  billing: string;
  /** 谁在引用它 */
  references: ReferenceView[];
  /** 选的价目表。null = 默认价目表 */
  pricing?: string | null;
}

/** 一个可能是密钥的值给界面看的样子 */
export interface SecretView {
  /** 打过码的值。带 `${NAME}` 的值原样给 */
  display: string;
  /** 整个值恰好是一个 `${NAME}` 时的变量名 */
  env?: string | null;
}

/**
 * 日志留多久。**两个期限分开** —— 一条报文几十 KB，一行记录几百字节。
 */
export interface RetentionView {
  body_days: number;
  row_days: number;
  body_max_bytes: number;
  /** 报文现在实际占了多少。**不是配置，是现状** */
  body_bytes_now: number;
}

/** 一行请求头 */
export interface HeaderView {
  name: string;
  /** 可能是密钥的值是打过码的 */
  value: string;
  /** 值打过码。编辑时这一行不回填，留空表示保持原值 */
  masked: boolean;
}

export interface OAuthView {
  endpoint: string;
  client_id?: string | null;
  /** access token 什么时候过期，RFC 3339。不知道时没有 */
  expires_at?: string | null;
  /** 最近一次换 token 失败的原因。恢复之后没有 */
  failure?: string | null;
  /** 凭据已失效，只有重新登录能恢复 */
  needs_login?: boolean;
}

// —— ChatGPT 账号 ——

/** 在哪台设备上授权：这台机器的浏览器，还是把码输到另一台设备上 */
export type ChatgptLoginMode = "browser" | "device";

/** 一次登录。授权地址留在 Rust 侧，界面拿到的是码和输码的地址 */
export interface ChatgptLogin {
  id: string;
  /** 要用户输进去的登录码。设备码登录才有 */
  user_code?: string | null;
  /** 让用户在另一台设备上打开的地址。设备码登录才有 */
  verification_url?: string | null;
  expires_in_secs: number;
}

export interface ChatgptLoginStatus {
  id: string;
  status: LoginStatus;
  /** 登录成功后写进配置的上游名 */
  provider?: string | null;
  /** `plus` / `pro` / `team` … */
  plan?: string | null;
  error?: string | null;
}

/** 登哪一家的账号 */
export type ZaiFamily = "zai" | "bigmodel";

/** 一次 Z.ai 登录。授权地址留在 Rust 侧，界面只拿到 ID */
export interface ZaiLogin {
  id: string;
  expires_in_secs: number;
}

export interface ZaiLoginStatus {
  id: string;
  status: LoginStatus;
  /** 登录成功后写进配置的上游名 */
  provider?: string | null;
  /** 登的是哪个账号，邮箱或者昵称。对方没给就没有 */
  account?: string | null;
  error?: string | null;
}

/** 账号的订阅额度 */
export interface ChatgptUsage {
  /** 登的是哪个账号。core 只给邮箱，用户 ID 和账户 ID 不往外带 */
  email?: string | null;
  plan?: string | null;
  windows: QuotaWindow[];
  /** 可用的额度重置卡张数。账号没有这一项时没有 */
  reset_credits?: number | null;
}

/** 一张额度重置卡 */
export interface ResetCreditView {
  id: string;
  /** 重置哪种额度，上游的原词 */
  reset_type: string;
  /** 上游的原词。`available` 之外的不能用 */
  status: string;
  granted_at: string;
  expires_at?: string | null;
  title?: string | null;
  description?: string | null;
}

export interface ResetCredits {
  available_count: number;
  credits: ResetCreditView[];
}

/**
 * 用掉一张卡的结果。
 *
 * - `reset`：额度已重置
 * - `nothing_to_reset`：额度没用完，不需要重置，没有扣卡
 * - `no_credit`：没有可用的卡
 * - `already_redeemed`：这个幂等键已经用过，额度在那一次已经重置
 */
export interface ResetCreditUsed {
  code: string;
  windows_reset: number;
}

/** 配置里引用了某个上游的一处 */
export type ReferenceView =
  | { kind: "rule_target"; route: string; rule: string }
  | { kind: "rule_condition"; route: string; rule: string }
  | { kind: "group"; group: string };

/** 一张自定义价目表 */
export interface PriceSheetView {
  name: string;
  multiplier: number;
  /** 单独覆盖了几个模型 */
  overrides: number;
  /** 哪些上游选了它 */
  used_by: string[];
}

/** 一条路由 —— 一组规则，加上指定了它的密钥 */
export interface RouteView {
  name: string;
  /** 没指定路由的密钥使用的就是这条 */
  default: boolean;
  /** 网关按配置补出来的默认路由：配置文件里没有它，编辑并保存即写入 */
  builtin: boolean;
  /** 有一条匹配全部请求的转发或拒绝 */
  has_catch_all: boolean;
  /** **显式绑了这条的密钥。**默认路由这里通常是空的 —— 走它的人是「没绑」 */
  clients: string[];
  rules: RuleView[];
}

/** 策略组按什么排候选，配置里 `type` 写的那个词 */
export type GroupKind = "fallback" | "select" | "load-balance" | "url-test" | "cheapest";

export interface GroupView {
  name: string;
  /** 内置的「全部上游」：成员是全部上游，按上游列表的顺序。不能编辑、不能删除 */
  builtin: boolean;
  kind: GroupKind;
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
  /** `list_keys` 给明文（密钥页原样显示）；概览里的是脱敏的 */
  key: string;
  max_concurrent: number | null;
  /** 绑的那条路由。`null` = 走默认路由 */
  route?: string | null;
  /** 能看到哪些模型。三态：不写 / 写非空 / 写 `[]`（一个都不给） */
  allow?: string[] | null;
  /** 为哪个客户端生成的（`claude-code` / `codex` …）。取消接管后仍然记着 */
  client?: string | null;
  /** 停用之后，用这把密钥的请求一律拒绝 */
  disabled?: boolean;
  /** 没有为自己生成密钥的客户端用的就是它。**删不得** */
  default?: boolean;
  /** 最后一次被用在什么时候。按密钥算，从来没用过时没有 */
  last_seen_ms?: number | null;
}

/** 一把密钥上用户能改的东西。**密钥的值不在里面** —— 要换走更换 */
export interface KeyInput {
  name: string;
  max_concurrent?: number | null;
  route?: string | null;
  allow?: string[] | null;
  disabled?: boolean;
}

export interface KeySave {
  key: KeyInput;
  base_version: string;
}

/** 更换之后的结果 */
export interface KeyRotated {
  version: string;
  /** 新的密钥值。**只在这里给一次** */
  key: string;
  /** 跟着改好的客户端 */
  synced: KeySynced[];
  /** 同步不上的。**密钥已经换了**，这些要用户自己去改 */
  failed: KeySyncFailed[];
}

export interface KeySynced {
  client: string;
  name: string;
  takes_effect: TakesEffect;
  backup: string;
}

export interface KeySyncFailed {
  client: string;
  name: string;
  error: string;
}

export interface ListenView {
  bind: string;
  port: number;
  /** 放行网段，就是生效的那一份。空 = 除本机外谁都连不上；本机永远放行，不在名单里 */
  allow_from: string[];
  /** 默认名单（私网段），「恢复默认」用 */
  default_allow_from: string[];
  exposed: boolean;
}

/** 保存监听设置。**三项一起存** —— 换档时网卡和端口常常一起改 */
export interface ListenSave {
  /** `loopback` / `all` / 网卡名 / 地址，和配置文件同一套写法 */
  bind: string;
  port: number;
  allow_from: string[];
  base_version: string;
}

/** 光标落在配置的哪一段上 */
export interface ConfigAt {
  section: string | null;
  /** 那一项的名字。**不给下标** —— 用户重排之后它指向另一个东西 */
  name: string | null;
}

export interface Overview {
  /**
   * 配置文件现在的版本号，改配置时带上它。**跟着概览一起来**：界面上能改
   * 的每一格都画自这份概览，有概览就有版本号。
   */
  config_version: string;
  providers: ProviderView[];
  /** 配置里定义过的代理 —— 换代理要从这里选，手打会打错 */
  proxies: ProxyView[];
  routes: RouteView[];
  groups: GroupView[];
  clients: ClientView[];
  listen: ListenView;
  /** 两项防护各在哪一档。规则在 `security_detail` 里 */
  security: SecurityView;
  /** 没绑路由的密钥走哪条 */
  default_route: string;
  /** 客户端自己发的辅助请求怎么处理 */
  client_probes: ProbeView[];
  /** 自定义价目表。默认价目表的状态看 `pricing_status` */
  price_sheets: PriceSheetView[];
  /** 日志留多久 */
  retention: RetentionView;
}

/**
 * 两项防护各在哪一档：`off` / `observe` / `enforce`。
 *
 * **「拦截」在两项上做的事不一样** —— 脱敏是替换、审查是切断。界面上统一
 * 叫「拦截」的话，用户点下去并不知道会发生什么。
 */
export interface SecurityView {
  redact: string;
  inspect_tools: string;
}

// ---------------------------------------------------------------- 安全

/** 两项防护在配置里的键，也是接口路径里的那一段 */
export type Guard = "redact" | "inspect_tools";

/** 出站脱敏找到的一项。**已打码** */
export interface SecretItem {
  /** 内置规则的 id，或者自定义规则的名字 */
  rule: string;
  custom?: boolean;
  /** 类别：`api-keys` / `private-keys` / `jwt` / `conn-strings` / `internal` / `custom` */
  kind: string;
  masked: string;
  count: number;
}

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

/** 一段时间里两项防护各留下了几条记录 */
export interface SecurityCounts {
  secrets: number;
  secrets_replaced: number;
  tool_calls: number;
  tool_calls_cut: number;
}

/** 安全日志的一条：一次命中 */
export interface SecurityEventView {
  id: number;
  at_ms: number;
  request_id: number;
  guard: Guard;
  rule: string;
  custom?: boolean;
  /** `recorded` / `replaced` / `cut` */
  action: "recorded" | "replaced" | "cut";
  provider: string;
  /** 哪把网关密钥 */
  client: string;
  model?: string;
  tool?: string | null;
  /** 出站脱敏是打码后的值；工具调用审查是命中的那一小段 */
  excerpt: string;
  count: number;
  /** 按请求头推测是哪个应用发的 */
  client_hint?: string | null;
  /** 非本机来的请求的来源地址 */
  peer?: string | null;
  /** 请求带的那把密钥打码后的样子，请求那一刻的 */
  key_masked?: string | null;
}

export interface SecurityEventsPage {
  events: SecurityEventView[];
  more: boolean;
}

/** 一条内置规则按什么认。界面按类型写成自己的话 */
export type Matcher =
  | { kind: "prefix"; prefix: string; min_tail: number }
  | { kind: "openai-legacy"; min_len: number }
  | { kind: "pem" }
  | { kind: "jwt" }
  | { kind: "conn-string" }
  | { kind: "private-ip" }
  | { kind: "domain-suffix"; suffixes: string[] }
  | { kind: "regex"; pattern: string };

export interface SecurityRuleView {
  /** 内置规则的 id，或者自定义规则的名字 */
  id: string;
  custom?: boolean;
  /** 英文名。界面按 id 查自己的名称表，查不到才用它 */
  name: string;
  /** 为什么值得看一眼（英文）。出站脱敏和自定义规则没有 */
  why?: string;
  kind: string;
  matcher: Matcher;
  enabled: boolean;
  on_by_default: boolean;
  /** 工具调用审查：拦截档下做什么 */
  action?: "cut" | "record" | null;
  /** 内置的工具调用规则出厂时拦截档下做什么。和 `action` 不一样就是改过 */
  default_action?: "cut" | "record" | null;
}

export interface GuardDetail {
  mode: string;
  rules: SecurityRuleView[];
}

export interface SecurityDetail {
  redact: GuardDetail;
  inspect_tools: GuardDetail;
}

export interface SecurityTestHit {
  rule: string;
  custom?: boolean;
  /** 在样本里的位置，按 UTF-16 码元（JavaScript 的下标） */
  start: number;
  end: number;
  excerpt: string;
  action?: "cut" | "record" | null;
}

export interface SecurityTestResult {
  hits: SecurityTestHit[];
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
  takes_effect: TakesEffect;
  /** 需要重开终端的客户端不提示「一直没收到请求」—— 那是狼来了 */
  warns_when_silent: boolean;
  /** `measured`：在本机实际运行验证过；`fields_only`：只查证过字段名 */
  verified: "measured" | "fields_only";
  /** 接管之后会失去或改变的功能 */
  costs: Msg[];
  /** 为它生成的那把网关密钥（取消接管之后仍然记着）。还没有就没有 */
  key?: string | null;
  /**
   * 最后一次收到**那把密钥**的请求。**接管有没有生效，只有它能证明** ——
   * 按密钥算，不按请求头里自报的客户端标识（那个可以伪造）
   */
  last_seen_ms?: number | null;
  /** 手动配置的方法：没检测到它时照着做 */
  manual: ManualSetup;
}

/** 改动什么时候生效：`immediately` 下一个请求；`on_restart` 客户端重新启动后 */
export type TakesEffect = "immediately" | "on_restart";

export interface ManualClient {
  /** `cursor` / `continue` / `gemini-cli`。为它生成专用密钥时用 */
  id: string;
  name: string;
  /** 为它生成的那把网关密钥 */
  key?: string | null;
  /** 最后一次收到那把密钥的请求 */
  last_seen_ms?: number | null;
  setup: ManualSetup;
  /** 配完还漏什么 */
  caveat: Msg;
}

/**
 * 手动配置一个客户端的方法。**地址和密钥不在句子里** —— 界面各给一个复制按钮
 */
export interface ManualSetup {
  /** 按顺序做的几步 */
  steps: Msg[];
  /** 要写进配置文件的字段（能接管的客户端才有）。密钥那一项 `secret`、不给值 */
  fields: FieldChange[];
  /** 要填的网关地址，这个客户端要的写法（有的带 `/v1`） */
  endpoint: string;
}

/** 为某个客户端准备的那把网关密钥 */
export interface ClientKey {
  name: string;
  key: string;
  /** 这次新建的 */
  created: boolean;
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
  notes: Msg[];
  shadows: string[];
  noop: boolean;
  carries_secret: boolean;
  /** 这次会改哪些字段。diff 之外再给一份摘要 */
  fields: FieldChange[];
  /** 写进去的是哪把网关密钥（还原时是留下来的那把） */
  key?: string | null;
  /** 那把密钥在接管的那一刻新建 */
  key_created?: boolean;
}

/** 配置文件里的一处改动 */
export interface FieldChange {
  op: "set" | "remove";
  /** 按层级用 `.` 连起来：`env.ANTHROPIC_BASE_URL` */
  path: string;
  /** 要写入的值。写的是网关密钥时没有 */
  value?: string | null;
  /** 这一项是网关密钥：值不回显，界面写成「密钥 xxx」 */
  secret?: boolean;
}

export interface AdoptResponse {
  real: string;
  backup: string;
  created: boolean;
  warnings: Msg[];
  takes_effect: TakesEffect;
}

export interface FindingView {
  level: "blocking" | "suspect" | "clear";
  title: Msg;
  detail: Msg;
  /** 用户可以自己执行的下一步。**我们不替他执行。** */
  fix: Msg | null;
}

// ---------------------------------------------------------------- 静态扫描

export interface ScanFinding {
  level: "high" | "medium" | "low";
  rule: string;
  kind: "hooks" | "mcp" | "skill" | "command" | "agent" | "instructions";
  client: string;
  path: string;
  line: number;
  title: Msg;
  detail: Msg;
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
  /** 其中估算的那部分。**不为 0 时合计要带记号** */
  cost_micros_estimated: number;
  /** 算出了价格的轮数 */
  priced_turns: number;
  /** **模型不在价目表里的轮数。**「$1.23」和「$1.23，另有 4 轮没有价格」不是一个结论 */
  unpriced_turns: number;
  /** 没有拿到用量、算不出花费的轮数 */
  no_usage_turns: number;
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
  /** 客户端没等到这一轮结束就断开了 */
  cancelled: boolean;
  /** 这一轮的金额是估算。**瀑布图上要带记号** */
  cost_estimated: boolean;
  /** 服务它的那家怎么收钱，和 `HistoryRow.billing` 同一套词 */
  billing: string;
}

export interface SessionDetail {
  session: SessionView;
  turns: TurnView[];
}

// ---------------------------------------------------------------- 路由试算

export interface RuleTrace {
  name: string;
  /** `phase_two`：条件要等选定上游之后才能求值，静态试算给不了结论 */
  verdict: "matched" | "skipped" | "phase_two";
  /** 命中时它起了什么作用 */
  effect?: "decide" | "apply" | "none" | null;
  /** 没命中时，第一个没对上的条件 */
  mismatch?: MismatchView | null;
  /** 条件本身写错了、没法求值时的说明 */
  error?: string | null;
}

/** 一个没对上的条件 */
export interface MismatchView {
  /** 和 `ConditionView.field` 同一个词表 */
  field: string;
  /** 规则里写的值 */
  want: string[];
  /** 这个请求实际的值。`intent` 为空表示真实的用户请求 */
  got: string;
}

/** 一项参数改写 */
export interface SetView {
  /** `model`（换模型，整个 prompt cache 作废）/ `max_tokens` / `thinking` / `only_at_session_start` */
  field: string;
  value: string;
}

/** 试算的请求。求值对象三选一：草稿 > 路由 > 密钥使用的路由 */
export interface DryRunRequest {
  model: string;
  /** 发出请求的密钥。规则里的密钥条件也按它判断 */
  client: string;
  route?: string | null;
  draft?: RouteInput | null;
  dialect: string;
  input_tokens: number;
  max_tokens: number | null;
  cache: boolean;
  tools: boolean;
  tool_count: number;
  image: boolean;
  thinking: boolean;
  stream: boolean;
  /** 辅助请求的类别。空 = 用户请求 */
  intent: string;
}

export interface DryRunResult {
  /** 按哪条路由求的值。草稿是草稿的名字 */
  route: string;
  /**
   * `unavailable`：规则选中的上游都服务不了这个请求，原因见 `skipped`。
   *
   * **`intercepted` 和 `passthrough` 说的是这个请求压根没到规则那一层** ——
   * 客户端自己发的辅助请求先过「辅助请求」那一档。两种情况下 `trace`
   * 都是空的，因为确实一条规则都没求值。
   */
  outcome: "route" | "deny" | "no_match" | "unavailable" | "intercepted" | "passthrough";
  /** 经过的策略组按什么排序候选。直指上游时没有 */
  strategy?: GroupKind | null;
  rule: string | null;
  /** `deny` 时规则里写的拒绝理由 */
  reason: string | null;
  candidates: string[];
  via_group: string | null;
  /** 累积起来的参数改写 */
  set: SetView[];
  trace: RuleTrace[];
  /** 这条路会不会伤到 prompt cache。**要直说 —— 它决定账单** */
  hurts_cache: boolean;
  /** 候选链里此刻熔断着的那些 */
  circuit_open: string[];
  /** 规则选中、但服务不了这个请求而被跳过的上游 */
  skipped: SkippedView[];
  /** 候选链里要转换格式的上游 */
  converted: ConvertedView[];
}

/** 一个要转换格式的候选上游 */
export interface ConvertedView {
  provider: string;
  /** 客户端的格式 */
  from: string;
  /** 这个上游的格式 */
  to: string;
}

export interface SkippedView {
  provider: string;
  /** `disabled` / `out_of_scope` / `not_offered` */
  reason: string;
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
  /** 不能写的话，为什么。能写的没有理由可给 */
  why_not: Msg | null;
}

// ---------------------------------------------------------------- 请求重放

export interface ReplayQuote {
  model: string;
  provider: string;
  body_bytes: number;
  input_tokens: number;
  /** `null` = 这个模型无法计价。**不是 0** */
  cost_micros: number | null;
  /** 要重放到的那家的计费方式 */
  billing: string;
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

// ---------------------------------------------------------------- 上游、代理与价目表的增删改

export interface ConfigWritten {
  version: string;
}

/** 一个密钥类的值怎么改。视图里拿不到原值，所以有「保持原样」 */
export type SecretChange =
  | { mode: "keep" }
  | { mode: "none" }
  /** 可以写 `${ENV}` 从环境变量读 */
  | { mode: "set"; value: string };

export interface HeaderInput {
  name: string;
  /** 不给表示沿用同名那一行的原值 */
  value?: string;
}

export type OAuthChange =
  | { mode: "keep" }
  | { mode: "none" }
  | {
      mode: "set";
      refresh: string;
      endpoint: string;
      client_id?: string;
      client_secret?: string;
      /** 检测一份还没保存的 OAuth 凭据只能用现成的 access token */
      access?: string;
    };

/** 新建或修改一个上游时交过去的定义 */
export interface ProviderInput {
  name: string;
  /** 修改时不给就是保持原样 */
  base_url?: string;
  /** 修改时默认保持原样 —— 界面拿不到原值 */
  key: SecretChange;
  /** 整张表就是保存之后的样子：没列出来的行被删掉 */
  headers: HeaderInput[];
  oauth: OAuthChange;
  /** 不给就按地址推断 */
  protocol?: string;
  proxy: string;
  on_proxy_fail: string;
  models: string[];
  /** 不给就是它提供的全部 */
  models_only?: string[];
  /** `per-token` / `free`。不给就是按量计费 */
  billing?: string;
  /** 不给就是默认价目表 */
  pricing?: string;
  disabled: boolean;
}

export interface ProviderSave {
  provider: ProviderInput;
  base_version: string;
}

export interface ProviderTest {
  provider: ProviderInput;
  /** 正在编辑的是哪一家。表单里没改的凭据和地址从它那儿取 */
  current?: string;
}

/** 按接口地址自动识别的结果（不联网） */
export interface ProviderPreview {
  protocol?: string | null;
  /** 按推断出的协议，API 密钥放在哪个请求头里 */
  auth_header: string;
}

/** 一个上游的模型清单 */
/**
 * 获取模型清单的结果：还没获取、上游列出了、上游不提供清单、没问到。
 * **和清单来源不是一回事** —— 没问到时清单可能来自手动清单。
 */
export type ModelStatus = "pending" | "listed" | "no_list" | "failed";

/** 打开上游页时补问：开始获取的是哪几家 */
export interface ModelsRefreshing {
  providers: string[];
}

export interface ProviderModelsView {
  provider: string;
  /** `discovered` / `manual` / `none` */
  source: string;
  status: ModelStatus;
  fetching: boolean;
  checked_at_ms?: number | null;
  error?: string | null;
  models: ModelRow[];
}

export interface ModelRow {
  id: string;
  /** 在启用范围里 */
  enabled: boolean;
  context_window?: number | null;
  /** 按这个上游选的价目表查到的价格。null = 无法计价 */
  price?: PriceFields | null;
  price_source?: PriceSourceView | null;
  /** 价格是从别的平台借来的，按它算出来的钱是估算 */
  estimated: boolean;
}

export interface ProxyInput {
  name: string;
  kind: string;
  /** `host:port` */
  addr: string;
  auth: ProxyAuthInput;
}

/** 视图里拿不到原来的用户名和密码，所以编辑时要能说「保持原样」 */
export type ProxyAuthInput =
  | { mode: "keep" }
  | { mode: "none" }
  | { mode: "set"; user: string; pass: string };

export interface ProxySave {
  proxy: ProxyInput;
  base_version: string;
}

export interface ProxyTest {
  proxy: ProxyInput;
  current?: string;
}

/** 默认价目表现在的状态 */
export interface PricingStatus {
  /** 数据日期 */
  date: string;
  /** `builtin` / `fetched` / `empty` */
  source: string;
  models: number;
  auto_update: boolean;
  /** 最近一次刷新的时间，成功失败都算 */
  checked_at_ms?: number | null;
  /** 最近一次刷新失败的原因 */
  error?: string | null;
  /** 最近 7 天无法计价的请求数 */
  unpriced_recent: number;
  unpriced_models: UnpricedModel[];
}

export interface UnpricedModel {
  provider: string;
  model: string;
  requests: number;
}

export interface PricingRefreshed {
  status: PricingStatus;
  /** 价格变了、新增或者移除了的模型数 */
  changed: number;
}

/** 单价，美元 / 百万 tokens */
export interface PriceFields {
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  /** 单次请求输入超过 200K tokens 之后的单价。成对出现 */
  input_above_200k?: number | null;
  output_above_200k?: number | null;
}

/** 一个价格是从哪儿来的 */
export type PriceSourceView =
  | { kind: "default"; date: string }
  | { kind: "scaled"; sheet: string; multiplier: number; date: string }
  | { kind: "override"; sheet: string };

export interface PriceSheetInput {
  name: string;
  multiplier: number;
  models: Record<string, PriceFields>;
}

export interface PriceSheetSave {
  sheet: PriceSheetInput;
  base_version: string;
  /** 保存之后使用这张价目表的上游。给了就恰好是这几家 */
  used_by?: string[];
}

export type SheetRef =
  | { kind: "default" }
  | { kind: "named"; name: string }
  | { kind: "draft"; sheet: PriceSheetInput };

export interface PriceQuery {
  sheet: SheetRef;
  models?: string[];
  search?: string;
  limit?: number;
}

export interface ResolvedPrice {
  model: string;
  price?: PriceFields | null;
  source?: PriceSourceView | null;
  estimated: boolean;
  max_input_tokens?: number | null;
}

export interface PriceQueryResult {
  items: ResolvedPrice[];
  /** 按名字搜时一共有多少个对得上（items 可能被截断） */
  matched: number;
}

// ---------------------------------------------------------------- 按上游的统计

/** 按模型或上游分组的费用 */
export interface CostGroup {
  name: string;
  requests: number;
  cost_micros: number;
  /** 价目表里没有这个模型的条数（用量是有的） */
  unpriced_requests: number;
  input_tokens: number;
  output_tokens: number;
  /** 没有拿到用量的条数 */
  no_usage_requests: number;
}

/** 一个上游最近一次报的订阅额度 */
export interface ProviderQuota {
  provider: string;
  windows: QuotaWindow[];
}

export interface QuotaWindow {
  /** `5h` / `7d`（Anthropic）/ `weekly`（Codex） */
  window: string;
  used_percent: number;
  /** 什么时候重置，Unix 毫秒。是时刻，不是「还有多少秒」。上游没说就没有 */
  resets_at_ms?: number | null;
  status?: string | null;
}
