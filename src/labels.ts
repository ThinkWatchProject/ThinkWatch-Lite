/**
 * core 发来的标识符在界面上的叫法。
 *
 * **取值来自固定集合的字段，core 只发标识符，叫法由界面决定。**以前 core
 * 发的是中文标签，界面只能拿显示文字做判断，core 改一个措辞，这边的判断
 * 就悄悄失效了。同一个标识符在概览、详情、试运行里必须是同一个词，所以
 * 集中在这里。上游页自己的那些在 `upstreams/labels.ts`。
 *
 * **认不出的值原样显示。**core 0.4 之前写进数据库的记录里是当时的文字，
 * 没有迁移。
 */
import {
  usd,
  type AttemptView,
  type ConditionView,
  type DriftView,
  type MismatchView,
  type ReplayQuote,
  type ScanResponse,
  type SetView,
  type StorageStatus,
  type TakesEffect,
  type TranslatedView,
} from "./types";
import { PROTOCOLS } from "./upstreams/labels";

// ---------------------------------------------------------------- 路由

export const GROUP_KINDS: { id: string; label: string }[] = [
  { id: "fallback", label: "按顺序" },
  { id: "select", label: "手动选择" },
  { id: "load-balance", label: "轮询" },
  { id: "url-test", label: "延迟最低" },
  { id: "cheapest", label: "费用最低" },
];

export function groupKindLabel(kind: string): string {
  return GROUP_KINDS.find((k) => k.id === kind)?.label ?? kind;
}

/** 客户端和上游的格式。和上游协议同一个词表，认不出时原样显示 */
export function formatLabel(id: string): string {
  return PROTOCOLS.find((p) => p.id === id)?.label ?? id;
}

/** 客户端辅助请求的类别，和路由条件 `intent` 同一个词表 */
export const PROBES: { id: string; label: string; what: string }[] = [
  {
    id: "health_check",
    label: "连通性检查",
    what: "客户端启动时发送的空请求，用于确认网关可达。",
  },
  { id: "warmup", label: "预热", what: "正文为 Warmup 的请求，用于预热连接与缓存。" },
  { id: "titling", label: "生成标题", what: "为会话生成标题。设为本地应答时，所有会话使用同一标题。" },
  {
    id: "topic_detect",
    label: "话题识别",
    what: "判断本轮对话的话题，客户端据此决定是否切换上下文。",
  },
  { id: "suggestion", label: "输入建议", what: "输入框中显示的补全建议。" },
];

export function probeLabel(id: string): string {
  return PROBES.find((p) => p.id === id)?.label ?? id;
}

/** 布尔条件满足和不满足时的说法 */
const FLAGS: Record<string, [yes: string, no: string]> = {
  cache: ["带缓存", "不带缓存"],
  tools: ["带工具", "不带工具"],
  image: ["带图片", "不带图片"],
  thinking: ["开启扩展思考", "未开启扩展思考"],
  stream: ["流式", "非流式"],
};

const CONDITION_NAMES: Record<string, string> = {
  model: "模型",
  client: "密钥",
  dialect: "客户端格式",
  input_tokens: "输入 token",
  max_tokens: "max_tokens",
  tool_count: "工具数",
  intent: "辅助请求",
  provider_would_be: "预定上游",
};

/** 值是比较式的条件 */
const COUNTS = new Set(["input_tokens", "max_tokens", "tool_count"]);

/** 条件里写的值怎么念：辅助请求和格式换成名称，其余原样 */
function conditionValue(field: string, value: string): string {
  if (field === "intent") return probeLabel(value);
  if (field === "dialect") return formatLabel(value);
  return value;
}

/** 规则列表里的一个条件：`模型 claude-*`、`带缓存` */
export function conditionText(c: ConditionView): string {
  const flag = FLAGS[c.field];
  if (flag) return c.values[0] === "false" ? flag[1] : flag[0];
  const values = c.values.map((v) => conditionValue(c.field, v)).join(" 或 ");
  return `${CONDITION_NAMES[c.field] ?? c.field} ${values}`;
}

/** 试算明细里一条规则没命中的原因 */
export function mismatchText(m: MismatchView): string {
  const flag = FLAGS[m.field];
  if (flag) {
    const want = m.want[0] === "false" ? flag[1] : flag[0];
    const got = m.got === "false" ? flag[1] : flag[0];
    return `要求${want}，实际为${got}`;
  }
  const name = CONDITION_NAMES[m.field] ?? m.field;
  const want = m.want.map((v) => conditionValue(m.field, v)).join(" 或 ");
  // 辅助请求为空说的是「这是用户自己发的请求」
  const got = m.field === "intent" && m.got === "" ? "用户请求" : conditionValue(m.field, m.got);
  // 数量条件写的是比较式（`>200k`），前面不加「为」
  return COUNTS.has(m.field)
    ? `要求${name} ${want}，实际为 ${got}`
    : `要求${name}为 ${want}，实际为 ${got}`;
}

/** 规则命中后的一项参数改写 */
export function setText(s: SetView): string {
  switch (s.field) {
    case "model":
      return `模型改为 ${s.value}，prompt cache 整体失效`;
    case "only_at_session_start":
      return "以上改写仅在新会话开始时应用";
    default:
      return `${s.field} 改为 ${s.value}`;
  }
}

/** 尝试链里的一跳。`ok` 决定颜色 */
export function attemptText(a: AttemptView): { text: string; ok: boolean } {
  switch (a.outcome) {
    case "served":
      if (a.status == null || a.status < 400) {
        return { text: a.status == null ? "成功" : `成功 · ${a.status}`, ok: true };
      }
      return { text: `${a.status} · 请求被上游拒绝`, ok: false };
    case "status":
      return { text: a.status === 429 ? "429 · 限流" : `${a.status ?? "—"} · 上游错误`, ok: false };
    case "error":
      return { text: a.error ?? "未收到响应", ok: false };
    default:
      return { text: a.outcome, ok: a.outcome === "成功" };
  }
}

/** 做过的格式转换：`OpenAI Chat Completions → Anthropic Messages` */
export function translatedText(t: Pick<TranslatedView, "from" | "to">): string {
  return `${formatLabel(t.from)} → ${formatLabel(t.to)}`;
}

// ---------------------------------------------------------------- 请求与费用

/** 重放前的费用预估 */
export function quoteText(q: ReplayQuote): string {
  switch (q.billing) {
    case "subscription":
      return "计入订阅额度，不计算费用。";
    case "free":
      return "不计费。";
    case "unknown":
      return "计费方式未知，无法预估费用。";
    default:
      return q.cost_micros != null
        ? `预估费用约 ${usd(q.cost_micros)}。`
        : `无法计价：${q.model} 不在价目表中。`;
  }
}

export function storageText(level: StorageStatus["level"]): string {
  switch (level) {
    case "ok":
      return "正常";
    case "metadata_only":
      return "磁盘空间不足，仅记录请求摘要，不保存请求体与响应体";
    case "stopped":
      return "磁盘空间严重不足，已停止记录";
    case "unavailable":
      return "请求记录未能启动";
    default:
      return level;
  }
}

// ---------------------------------------------------------------- 配置

export function originLabel(origin: string): string {
  switch (origin) {
    case "ui":
      return "界面";
    case "cli":
      return "命令行";
    case "external":
      return "外部编辑";
    case "rollback":
      return "回滚";
    case "rotation":
      return "凭据轮换";
    default:
      return origin;
  }
}

/** 配置在哪一层没通过，后面接「错误」 */
export function stageLabel(stage: string): string {
  switch (stage) {
    case "syntax":
      return "语法";
    case "schema":
      return "字段";
    case "semantics":
      return "语义";
    default:
      return stage;
  }
}

// ---------------------------------------------------------------- 安全

/** 出站检测和脱敏识别出的凭据种类 */
const SECRETS: Record<string, string> = {
  "anthropic-api-key": "Anthropic API 密钥",
  "openai-api-key": "OpenAI API 密钥",
  "openai-project-key": "OpenAI 项目密钥",
  "github-personal-token": "GitHub 个人令牌",
  "github-oauth-token": "GitHub OAuth 令牌",
  "github-server-token": "GitHub 服务器令牌",
  "github-user-token": "GitHub 用户令牌",
  "github-fine-grained-token": "GitHub 细粒度令牌",
  "slack-bot-token": "Slack 机器人令牌",
  "slack-user-token": "Slack 用户令牌",
  "slack-app-token": "Slack 应用令牌",
  "aws-access-key-id": "AWS 访问密钥 ID",
  "aws-temporary-key-id": "AWS 临时访问密钥 ID",
  "google-api-key": "Google API 密钥",
  "google-oauth-token": "Google OAuth 令牌",
  "gitlab-token": "GitLab 令牌",
  "stripe-live-key": "Stripe 生产密钥",
  "stripe-restricted-key": "Stripe 受限密钥",
  "npm-token": "npm 令牌",
  "digitalocean-token": "DigitalOcean 令牌",
  "sendgrid-key": "SendGrid 密钥",
  "private-key": "私钥",
  jwt: "JWT",
  "conn-string-password": "连接串口令",
  "internal-ip": "内网地址",
  "internal-domain": "内部域名",
};

export function secretLabel(secret: string): string {
  return SECRETS[secret] ?? secret;
}

export function driftLabel(metric: DriftView["metric"]): string {
  switch (metric) {
    case "flagged":
      return "命中高危规则的响应";
    case "tool_calls":
      return "带工具调用的响应";
    case "errors":
      return "失败的请求";
    default:
      return metric;
  }
}

/** 扫描用了哪些规则：`生效扫描规则 42 条（其中自定义 2 条），已停用内置规则 1 条` */
export function scanRulesText(s: ScanResponse): string {
  let text = `生效扫描规则 ${s.rules_active} 条`;
  if (s.rules_custom > 0) text += `（其中自定义 ${s.rules_custom} 条）`;
  if (s.rules_disabled > 0) text += `，已停用内置规则 ${s.rules_disabled} 条`;
  return text;
}

// ---------------------------------------------------------------- 客户端接管

export function takesEffectText(t: TakesEffect): string {
  return t === "immediately"
    ? "下一个请求即使用新配置。"
    : "重新启动客户端后生效；通过环境变量读取配置的客户端需重新打开终端。";
}

/** 只查证过字段名的客户端要说出来。实测过的不用说 */
export const FIELDS_ONLY_TEXT = "字段名已查证，尚未在本机实际运行验证。";
