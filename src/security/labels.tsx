import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { getLang, textOf, useText } from "@/i18n";
import { contentWhy, ruleWhy as coreRuleWhy } from "@/i18n/core.i18n";
import { secretLabel } from "@/labels";
import type {
  ContentMatch,
  Guard,
  GuardMode,
  HitLocation,
  Matcher,
  SecurityEventView,
  SecurityOutcome,
  SecurityRuleView,
} from "@/types";
import { securityLabelsText } from "./labels.i18n";

/**
 * 一项防护的档位，画成状态点的语气。
 *
 * **第三档是绿的**（防护在起作用），**观察是琥珀的**（命中照常放行，只记下来 ——
 * 要留意，但它在工作），**关闭是灰的**（没有在工作，也不是故障）。页头、标签、
 * 档位那一块用同一套，一眼对得上。
 */
export function modeTone(mode: GuardMode): StatusTone {
  return mode === "enforce" ? "ok" : mode === "observe" ? "warn" : "idle";
}

/**
 * 一项防护的一档叫什么。前两档各项一样（关闭、观察）；**第三档按这一项做的事命名**：
 * 出站脱敏「替换」、工具调用审查「切断」、内容过滤「处置」（规则各自拒绝或删除）。
 */
export function modeName(guard: Guard, mode: GuardMode): string {
  const t = textOf(securityLabelsText);
  return mode === "enforce" ? t.enforce[guard] : t.modes[mode];
}

/**
 * 一次命中最后怎么处置的，画成状态点的语气。
 *
 * **三种颜色说三件事**：切断、拒绝是红的（请求的结局变了），替换、删除是绿的（防护在
 * 起作用，请求照常完成），仅记录是琥珀的（命中的东西照常放行了，值得看一眼）。
 */
export function outcomeTone(action: SecurityOutcome): StatusTone {
  return action === "cut" || action === "blocked"
    ? "error"
    : action === "replaced" || action === "stripped"
      ? "ok"
      : "warn";
}

/**
 * 几种处置一起列时的先后（页头）：先说改变了请求结局的切断、拒绝，再说改了内容照常
 * 发出的删除、替换，最后是仅记录。
 */
export const OUTCOMES: readonly SecurityOutcome[] = ["cut", "blocked", "stripped", "replaced", "recorded"];

/**
 * 一条规则叫什么。
 *
 * 出站脱敏的内置规则 id 就是凭据种类（`anthropic-api-key` …），和流量页上
 * 那张名称表是同一张；另两项各查这里的一张表：工具调用审查查扫描规则那张，
 * 内容过滤查内容规则那张（隐藏字符那一组也在里面）。
 * **自定义规则的 id 就是用户起的名字**，原样显示。表里都没有的，退回 core
 * 给的英文名，再没有就是 id。
 */
export function ruleName(guard: string, id: string, custom?: boolean, fallback?: string): string {
  if (custom) return id;
  const t = textOf(securityLabelsText);
  switch (guard) {
    case "redact": {
      const name = secretLabel(id);
      return name !== id ? name : (fallback ?? id);
    }
    case "content":
      return t.contentRules[id] ?? fallback ?? id;
    default:
      return t.rules[id] ?? fallback ?? id;
  }
}

/** 规则列表里的一条叫什么 */
export function viewName(guard: Guard, r: SecurityRuleView): string {
  return ruleName(guard, r.id, r.custom, r.name);
}

/**
 * 内置规则为什么值得看一眼。中文查词表，查不到就用 core 的原话。
 *
 * 内容规则（隐藏字符那一组有）和工具调用规则各查各的表：两边的 id 是各起各的。
 */
export function ruleWhy(guard: Guard, r: SecurityRuleView): string {
  if (r.custom || !r.why) return "";
  if (guard !== "content") return coreRuleWhy(r.id, r.why);
  const why = contentWhy(r.id, r.why);
  // 英文那句可能以名字开头（「Bidirectional controls: …」），名字已经在上一行了
  const lead = `${r.name}:`.toLowerCase();
  if (!why.toLowerCase().startsWith(lead)) return why;
  const rest = why.slice(lead.length).trimStart();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** 命中在哪儿：工具调用审查是哪个工具，内容过滤是「工具结果」 */
export function whereOf(e: SecurityEventView): string | null {
  if (!e.tool) return null;
  return e.tool === "tool_result" ? textOf(securityLabelsText).toolResult : e.tool;
}

/**
 * 命中的一处在哪一段：系统提示、第几条消息（带角色）、工具结果或工具调用（带工具名）、
 * 回答正文。**消息从 1 数**（「第 4 条消息」），JSON 路径里的下标照 core 给的从 0 数
 * （`messages[3]`）：前者是给人读的序数，后者是报文里的原样。角色按客户端写的查表，
 * 表里没有的照写。
 */
export function partLabel(l: HitLocation): string {
  const t = textOf(securityLabelsText);
  switch (l.part) {
    case "message": {
      const head = l.message_index != null ? t.parts.message(l.message_index + 1) : null;
      const role = l.role ? (t.roles[l.role] ?? l.role) : null;
      // 两样都没有（core 不会这样给）时，路径本身就是位置
      return [head, role].filter(Boolean).join(" · ") || l.path;
    }
    case "tool_result":
    case "tool_call":
      return l.tool ? `${t.parts[l.part]} · ${l.tool}` : t.parts[l.part];
    default:
      return t.parts[l.part];
  }
}

/**
 * 命中那一刻的规则叫什么。**按快照，不按现在的规则表**：规则改了名、删掉了，日志里
 * 还是当时那一条。内置规则的名字照常查词表（快照里的英文名是退路）。
 */
export function snapshotName(e: SecurityEventView): string {
  const s = e.rule_snapshot;
  return s.builtin ? ruleName(e.guard, s.id, false, s.name) : s.name;
}

/**
 * 自定义规则怎么认。内容过滤的快照里写着；**另两项的自定义规则只有正则一种写法**
 * （脱敏和工具调用规则都是一个正则），快照里不写，这里补上。内置规则没有写法可展示。
 */
export function matchingOf(e: SecurityEventView): ContentMatch | null {
  const s = e.rule_snapshot;
  if (s.builtin) return null;
  return s.matching ?? (e.guard === "content" ? null : "regex");
}

/** 一条内容过滤的命中是不是码位规则的（日志里带着规则怎么认）。是的话 `count` 数的是字符，不是几处 */
export function byCodepoints(e: SecurityEventView): boolean {
  return e.guard === "content" && e.match === "codepoints";
}

/**
 * 一次命中的细节，日志和请求详情里的第二行。
 *
 * **各项防护的 `excerpt` 和 `count` 说的不是一回事**：出站脱敏是打码的值和出现
 * 几次；工具调用审查、内容过滤是命中的那一小段，内容过滤还有命中了几处。**码位规则
 * 数的是字符**，几个字符写在前面（这一行放不下时截掉的是后面），后面是标签字符解出来
 * 的原文 —— 藏的是什么比藏在哪儿要紧；解不出原文的是画出码位的那一小段。
 */
export function EventDetail({ e, codepoints = false }: { e: SecurityEventView; codepoints?: boolean }) {
  const t = useText(securityLabelsText).detail;
  if (codepoints)
    return (
      <>
        {`${t.chars(e.count)} · `}
        {e.revealed ? t.revealed(e.revealed) : <span className="font-mono">{e.excerpt}</span>}
      </>
    );
  return (
    <>
      <span className="font-mono">{e.excerpt}</span>
      {e.count > 1 && ` · ${t.times(e.count)}`}
    </>
  );
}

/** 按代码样式画的一小段 */
export function Code({ children }: { children: string }) {
  return (
    // `pre`：内容规则的首尾空格有意义（` dan `），不能被折叠掉
    <code className="rounded bg-surface px-1 font-mono text-[0.92em] whitespace-pre text-foreground">
      {children}
    </code>
  );
}

const code = (s: string) => <Code key={s}>{s}</Code>;

/** 内置规则的匹配判据，写成一句话 */
export function MatcherText({ m }: { m: Matcher }) {
  const t = useText(securityLabelsText).matcher;
  switch (m.kind) {
    case "prefix":
      return t.prefix(code, m.prefix, m.min_tail);
    case "openai-legacy":
      return t.openaiLegacy(code, m.min_len);
    case "pem":
      return t.pem(code);
    case "jwt":
      return t.jwt(code);
    case "conn-string":
      return t.connString(code);
    case "private-ip":
      return t.privateIp(code);
    case "domain-suffix":
      return t.domainSuffix(code, m.suffixes);
    case "cn-resident-id":
      return t.cnResidentId(m.born_since);
    case "bank-card":
      return t.bankCard(m.networks.map((n) => n.name));
    case "email":
      return t.email(code);
    case "cn-mobile-phone":
      return t.cnMobilePhone(code);
    // 代码里做的检查没有可展示的写法：按检查名说它查什么，不说怎么查
    case "builtin":
      return <>{t.builtin[m.check] ?? t.builtinOther}</>;
    case "regex":
      return t.regex(code, m.pattern);
    case "contains":
      return t.contains(code, m.text);
    case "codepoints":
      return t.codepoints(code, m.ranges);
  }
}

/**
 * 一次命中最后怎么处置的：状态点加一个词，颜色见 `outcomeTone`。
 *
 * **只有切断、拒绝的字是红的** —— 一列里大多数是替换和仅记录，满列彩字等于
 * 没有重点；那两种改变了请求的结局，要一眼挑得出来。
 */
export function ActionBadge({ action }: { action: SecurityOutcome }) {
  const t = useText(securityLabelsText).actions;
  const tone = outcomeTone(action);
  return (
    <StatusLabel tone={tone} muted={tone !== "error"}>
      {t[action] ?? action}
    </StatusLabel>
  );
}

/** 本地时区里的哪一天，当分组的键 */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 一天的标题：今天、昨天写词，日期跟在后面；更早的只写日期（带星期，跨年带年份）。
 * 日期按界面语言写（`9月23日周三` / `Wed, Sep 23`）。
 */
export function dayHead(ms: number, now = Date.now()): { title: string; date: string | null } {
  const t = textOf(securityLabelsText).day;
  const d = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const date = new Intl.DateTimeFormat(getLang() === "zh" ? "zh-CN" : "en-US", {
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
    month: getLang() === "zh" ? "long" : "short",
    day: "numeric",
    weekday: "short",
  }).format(d);
  if (dayKey(ms) === dayKey(now)) return { title: t.today, date };
  if (dayKey(ms) === dayKey(yesterday.getTime())) return { title: t.yesterday, date };
  return { title: date, date: null };
}

/** 一天之内的时刻，到秒。日期在那一天的标题上 */
export function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
