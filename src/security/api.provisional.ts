/**
 * 安全防护统一（guard-unify）之后的控制面协议。**临时的**：core 发版、`tw-api.ts`
 * 重新生成之前先照约定写在这里，之后整个删掉。
 *
 * 和现在钉着的那版相比：
 *
 * - 防护只剩三项：出站脱敏、工具调用审查、内容过滤。隐藏字符并进内容过滤（成了它的
 *   一组内置规则），输出长度删掉；
 * - 内容规则的处置多了「删除」（`strip`），写法多了「码位」（`codepoints`）；
 * - 脱敏规则有占位符名称（`label`），内置目录多了邮箱、手机号两条（各是一种新的 `Matcher`）；
 * - 「测试」可以带上处置（`action`），多给发出去的样子（`output`）和会不会被拒（`refused`）；
 * - 日志多了「已删除」，内容过滤的命中带「几处 / 几个字符」和解出来的隐藏内容；
 * - `content_matched` 事件按结局（`outcome`）说，不再是 `blocked: boolean`。
 *
 * **界面其余的代码不知道这一层**：`src/types.ts` 用这里的同名类型盖住生成的那几个
 * （显式转出优先于 `export type *`），`src/control.ts` 的 `Endpoints` 也从这里取，各页
 * 照常从 `@/types` 取类型。换成生成的类型时：
 *
 * 1. 接上新 tag，重新生成 `src/generated/tw-api.ts`；
 * 2. 删掉 `src/types.ts` 里标着「临时」的那一段转出，顶上那一行 import 改回从
 *    `./generated/tw-api` 取；
 * 3. `src/control.ts` 的 `Endpoints` 改回从 `./generated/tw-api` 取；
 * 4. 删掉这个文件，`pnpm typecheck`：名字或形状和这里不一样的地方会在用到它的那一处报错。
 *
 * 约定里没写、这里先补上的只有一样：概览计数里内容过滤删除过几次（`content_stripped`）。
 */
import type * as G from "@/generated/tw-api";

// ─── 防护、档位、处置 ───

/** 哪一项防护。配置里 `security` 下的那个键，也是接口路径里的那一段 */
export type Guard = "redact" | "inspect_tools" | "content";

/**
 * 一条规则在第三档下做什么。工具调用审查：`cut` / `record`；内容过滤：`block` / `strip` /
 * `record`。出站脱敏的规则没有自己的处置（命中就替换）
 */
export type RuleAction = "cut" | "block" | "strip" | "record";

/** 内容规则怎么认：不分大小写的子串、正则、码位 */
export type ContentMatch = "contains" | "regex" | "codepoints";

/** 内置规则的匹配判据。出站脱敏多了邮箱、中国大陆手机号两种，都没有参数 */
export type Matcher = G.Matcher | { kind: "email" } | { kind: "cn-mobile-phone" };

// ─── 规则视图 ───

/** 一条规则 */
export type SecurityRuleView = {
  /** 内置规则的 id，或者自定义规则的名字 */
  id: string;
  custom: boolean;
  /** 英文名。界面按 id 查自己的名称表，查不到才用它；自定义规则就是名字 */
  name: string;
  /** 为什么值得看一眼（英文）。出站脱敏和自定义规则没有 */
  why?: string;
  /**
   * 类别。出站脱敏：`api-keys` … `personal`、`internal`、`custom`；工具调用审查：
   * `command` / `custom`；内容过滤：`invisible` / `injection` / `persona` / `chinese` / `custom`
   */
  kind: string;
  matcher: Matcher;
  enabled: boolean;
  /** 出厂时开不开。自定义规则是 `true` */
  on_by_default: boolean;
  /** 工具调用审查、内容过滤：第三档下做什么 */
  action?: RuleAction | null;
  /** 内置规则出厂时第三档下做什么。和 `action` 不一样就是改过 */
  default_action?: RuleAction | null;
  /** 出站脱敏：占位符里的标签（`SECRET`、`ID_NUMBER`…），内置和自定义都有。其余两项没有 */
  label?: string | null;
};

/** 一项防护的档位和规则 */
export type GuardDetail = {
  mode: G.GuardMode;
  /** 按界面上的顺序：内置的在前，自定义的在后 */
  rules: SecurityRuleView[];
};

/** 各项防护 */
export type SecurityDetail = { redact: GuardDetail; inspect_tools: GuardDetail; content: GuardDetail };

/** 每项防护各在哪一档（概览里的那一份） */
export type SecurityView = { redact: G.GuardMode; inspect_tools: G.GuardMode; content: G.GuardMode };

// ─── 写 ───

/** 新建或修改一条自定义规则。改的时候名字可以变，那就是改名 */
export type CustomRuleSave = {
  name: string;
  /** 正则、要找的那段文字，或码位（`U+200B, U+E0000–U+E007F`） */
  pattern: string;
  /** 工具调用审查：`cut` / `record`；内容过滤：`block` / `strip` / `record`。不给按 `record` */
  action?: RuleAction | null;
  /** 内容过滤才有。不给按 `contains`；别的两项的自定义规则都是正则 */
  match?: ContentMatch | null;
  /** 出站脱敏才有：占位符名称，`^[A-Z][A-Z0-9_]{0,23}$`。不给是 `SECRET` */
  label?: string | null;
  enabled: boolean;
  base_version?: string | null;
};

/** 改一条内置规则在第三档下做什么 */
export type ActionSave = { action: RuleAction; base_version?: string | null };

// ─── 测试 ───

/**
 * 拿一段文本试一试。给了 `pattern` 就只试这一条（内容过滤按 `match` 认，脱敏按 `label`
 * 写占位符），给了 `rule` 就只试这一条内置规则（停用着的也能试），都不给就按现在启用
 * 的全部规则
 */
export type SecurityTestRequest = {
  sample: string;
  pattern?: string | null;
  match?: ContentMatch | null;
  rule?: string | null;
  label?: string | null;
  /**
   * 试一条还没保存的规则、或者改过处置还没保存的内置规则时，对话框里选着的那一种处置：
   * `output` 和 `refused` 按它算。不给就按规则存着的处置（`pattern` 试的是只记录）
   */
  action?: RuleAction | null;
};

/** 试出来的一处 */
export type SecurityTestHit = {
  rule: string;
  custom: boolean;
  /** 在样本里的位置，**按 UTF-16 码元计** */
  start: number;
  end: number;
  /** 出站脱敏：打码后的值；另两项：命中的那一小段（码位规则把不可见字符画成 `‹U+E0049›`） */
  excerpt: string;
  /** 工具调用审查、内容过滤：第三档下做什么 */
  action?: RuleAction | null;
};

export type SecurityTestResult = {
  hits: SecurityTestHit[];
  /** 发出去的样子：脱敏是替换后的样本，内容过滤是删除后的样本。都没变化是 `null` */
  output: string | null;
  /** 内容过滤：第三档下这个请求会被拒（有「拒绝」规则命中）。别的两项总是 `false` */
  refused: boolean;
};

// ─── 日志 ───

/**
 * 安全日志的一条做了什么：`recorded`（只记录）/ `replaced`（已替换）/ `cut`（已切断）/
 * `stripped`（命中的文字删掉之后发出）/ `blocked`（请求被拒，没有发出去）
 */
export type SecurityOutcome = "recorded" | "replaced" | "cut" | "stripped" | "blocked";

/** 一段安全日志里，每一种做法各几条。没有的是 0，五项都在 */
export type SecurityOutcomeCounts = Record<SecurityOutcome, number>;

/**
 * 安全日志的一条。
 *
 * 内容过滤：`rule` 是规则 id 或自定义名，`excerpt` 是可见的片段（码位规则把不可见字符画成
 * `‹U+E0049›`），`count` 是这条规则在整个请求里命中几处（码位规则是几个字符）
 */
export type SecurityEventView = Omit<G.SecurityEventView, "guard" | "action"> & {
  guard: Guard;
  action: SecurityOutcome;
  /** 码位规则命中标签字符时，解出来的原文（最多 120 个字符）。别的没有 */
  revealed?: string | null;
};

export type SecurityEventsQuery = Omit<G.SecurityEventsQuery, "guard"> & { guard?: Guard | null };

export type SecurityEventsPage = {
  events: SecurityEventView[];
  more: boolean;
  /** 这一段时间里、按这一项筛出来的一共几条 —— 整段的，不只是这一页 */
  total: number;
  /** `total` 里各做了什么。五项加起来就是 `total` */
  by_outcome: SecurityOutcomeCounts;
};

/**
 * 各项防护在一段时间里各留下了几条记录（概览）。**约定里没写 `content_stripped`**，
 * 是这边要的：删除过的和拒绝的一样算「处置了」，概览那一行才不会把它们标成没处置
 */
export type SecurityCounts = {
  secrets: number;
  secrets_replaced: number;
  tool_calls: number;
  tool_calls_cut: number;
  content: number;
  content_blocked: number;
  content_stripped: number;
};

// ─── 事件 ───

/** 一条请求命中了一条内容规则 */
export type ContentMatchedEvent = {
  kind: "content_matched";
  id: number;
  provider: string;
  /** 内置规则的 id，或者自定义规则的名字 */
  rule: string;
  custom: boolean;
  /** 这条规则在第三档下做什么 */
  action: RuleAction;
  /** 实际做了什么 */
  outcome: "recorded" | "stripped" | "blocked";
  /** 在工具结果里，而不是调用方自己打的字 */
  in_tool_result: boolean;
  /** 命中处前后的一小段，**已截断** */
  excerpt: string;
  /** 几处；码位规则是几个字符 */
  count: number;
  /** 码位规则命中标签字符时解出来的原文 */
  revealed?: string | null;
  at_ms: number;
};

/** core 的事件流上的一条。隐藏字符、输出长度的两种没有了，内容过滤的换了形状 */
export type Event =
  | Exclude<G.Event, { kind: "hidden_text_found" | "output_limited" | "content_matched" }>
  | ContentMatchedEvent;

// ─── 装着上面这些的那几样 ───

export type HistoryRow = Omit<G.HistoryRow, "security"> & { security?: SecurityEventView[] };
export type RequestDetail = Omit<G.RequestDetail, "row"> & { row: HistoryRow };
export type HistorySearchPage = Omit<G.HistorySearchPage, "rows"> & { rows: HistoryRow[] };
export type InFlightRequest = Omit<G.InFlightRequest, "events"> & { events: Event[] };
export type InFlight = Omit<G.InFlight, "requests"> & { requests: InFlightRequest[] };
export type Overview = Omit<G.Overview, "security"> & { security: SecurityView };
export type Summary = Omit<G.Summary, "security"> & { security: SecurityCounts };

/** 端点的请求和响应。`SetSecurityLimit`（`PUT /security/{guard}/limit`）删掉了 */
type Changed = {
  Events: { req: null; res: Event };
  InFlight: { req: null; res: InFlight };
  Overview: { req: null; res: Overview };
  Summary: { req: G.Window; res: Summary };
  History: { req: G.ListQuery; res: HistoryRow[] };
  HistorySearch: { req: G.HistorySearchQuery; res: HistorySearchPage };
  RequestDetail: { req: null; res: RequestDetail };
  Security: { req: null; res: SecurityDetail };
  SecurityEvents: { req: SecurityEventsQuery; res: SecurityEventsPage };
  SetBuiltinRuleAction: { req: ActionSave; res: G.ConfigWritten };
  CreateCustomRule: { req: CustomRuleSave; res: G.ConfigWritten };
  UpdateCustomRule: { req: CustomRuleSave; res: G.ConfigWritten };
  TestSecurity: { req: SecurityTestRequest; res: SecurityTestResult };
};
export type Endpoints = Omit<G.Endpoints, keyof Changed | "SetSecurityLimit"> & Changed;
