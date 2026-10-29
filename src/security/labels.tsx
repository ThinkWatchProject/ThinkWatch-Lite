import { Fragment } from "react";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { getLang, textOf, useText } from "@/i18n";
import type {
  ContentMatch,
  Guard,
  GuardMode,
  HitLocation,
  Matcher,
  SavedSource,
  SecurityEventView,
  SecurityKindView,
  SecurityOutcome,
  SecurityRuleView,
} from "@/types";
import { catalogRule, localized } from "./catalog";
import { securityLabelsText } from "./labels.i18n";

/**
 * 一项防护的状态，画成状态点的语气。
 *
 * **开启是绿的**（防护在起作用），**监控是琥珀的**（命中照常放行，只记录并通知 ——
 * 要留意，但它在工作），**关闭是灰的**（没有在工作，也不是故障）。页头、标签、
 * 状态那一块用同一套，一眼对得上。
 */
export function modeTone(mode: GuardMode): StatusTone {
  return mode === "enforce" ? "ok" : mode === "observe" ? "warn" : "idle";
}

/** 一项防护的状态叫什么：开启、监控、关闭，各项一样 */
export function modeName(mode: GuardMode): string {
  return textOf(securityLabelsText).modes[mode];
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
 * 一条规则叫什么：日志、流量页徽标这些只带 id 的地方用。
 *
 * **名字由 core 给**（规则表里的 `name` / `name_zh`），这里按 id 到规则目录里查（见
 * `catalog.ts`；用到的组件要挂上 `useRuleCatalog`）。**自定义规则的 id 就是用户起的名字**，
 * 原样显示。目录还没取到、或者规则已经没有了，退回日志里存的英文名，再没有就是 id。
 */
export function ruleName(guard: string, id: string, custom?: boolean, fallback?: string): string {
  if (custom) return id;
  const r = catalogRule(guard, id);
  return r ? viewName(r) : (fallback ?? id);
}

/** 规则列表里的一条叫什么：内置的按界面语言取 `name` / `name_zh`，自定义的就是它的名字 */
export function viewName(r: SecurityRuleView): string {
  return r.custom ? r.name : localized(r.name, r.name_zh);
}

/**
 * 内置规则为什么值得看一眼（危险命令、内容过滤有；规则名说得清的没有）。按界面语言取
 * `why` / `why_zh`。
 */
export function ruleWhy(guard: Guard, r: SecurityRuleView): string {
  if (r.custom || !r.why) return "";
  const why = localized(r.why, r.why_zh);
  if (guard !== "content" || why !== r.why) return why;
  // 内容规则英文那句可能以名字开头（「Bidirectional controls: …」），名字已经在上一行了
  const lead = `${r.name}:`.toLowerCase();
  if (!why.toLowerCase().startsWith(lead)) return why;
  const rest = why.slice(lead.length).trimStart();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/**
 * 规则表的分组叫什么：core 给的 `kinds` 里按 `slug` 查。查不到（旧的 core 不给）时
 * 自定义那一组照样叫「自定义」，其余写 slug。
 */
export function kindName(kinds: readonly SecurityKindView[] | undefined, slug: string): string {
  const k = kinds?.find((x) => x.slug === slug);
  if (k) return localized(k.name, k.name_zh);
  return slug === "custom" ? textOf(securityLabelsText).custom : slug;
}

/** 命中在哪儿：危险命令是哪个工具；内容过滤是「工具结果」，或者「回答」（查的是回答正文） */
export function whereOf(e: SecurityEventView): string | null {
  const t = textOf(securityLabelsText);
  if (e.guard === "content" && e.direction === "response") return t.directions.response;
  if (!e.tool) return null;
  return e.tool === "tool_result" ? t.toolResult : e.tool;
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
 * 还是当时那一条。内置规则的名字按 id 到规则目录里查（快照里的英文名是退路）。
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
 * 「ThinkWatch 中保存的密钥」命中的是哪一处配置里的值：上游「DeepSeek」的密钥、网关密钥
 * 「默认」…… **只有来源，没有值**：这条规则报出来的值是空的，连头尾都不留 —— 来源已经
 * 说清楚是哪一把。不认识的来源（更新的 core）退回名字本身。
 */
export function savedSourceText(s: SavedSource): string {
  const f = textOf(securityLabelsText).savedSource[s.kind] as ((name: string) => string) | undefined;
  return f ? f(s.name) : s.name;
}

/** 安全日志一条（或流量页上的一项）的值那一段：保存的密钥写来源，其余是打码后的值 */
export function hitValue(x: { source?: SavedSource | null }, masked: string): { text: string; mono: boolean } {
  return x.source ? { text: savedSourceText(x.source), mono: false } : { text: masked, mono: true };
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
  // 保存的密钥没有值可写，写来源；值是空的（更早的记录）就只剩次数
  const v = hitValue(e, e.excerpt);
  const times = e.count > 1 ? t.times(e.count) : null;
  return (
    <>
      {v.text && <span className={v.mono ? "font-mono" : undefined}>{v.text}</span>}
      {times && (v.text ? ` · ${times}` : times)}
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

/**
 * core 写的一句说明，反引号括起来的一段画成代码（反引号本身不显示）。反引号总是成对的；
 * 万一落单，最后那一段照普通文字画
 */
export function CoreText({ text }: { text: string }) {
  const parts = text.split("`");
  const paired = parts.length % 2 === 1;
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 && (paired || i < parts.length - 1) ? (
          <Code key={i}>{p}</Code>
        ) : (
          <Fragment key={i}>{i % 2 === 1 ? `\`${p}` : p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * 一条规则认什么，写成一句话。
 *
 * **密钥与隐私的内置规则由 core 写**（`about` / `about_zh`）。其余的按判据写：自定义
 * 规则和内容规则是正则、包含、码位，危险命令里代码实现的检查按检查名说它查什么。
 */
export function RuleMatchText({ r }: { r: SecurityRuleView }) {
  useText(securityLabelsText);
  const about = r.custom ? "" : localized(r.about, r.about_zh);
  return about ? <CoreText text={about} /> : <MatcherText m={r.matcher} />;
}

/** 判据里能列出来的写法（前缀、后缀、变量名、字段名）：说明缺了的时候至少列出这些 */
function listed(m: Matcher): string[] {
  switch (m.kind) {
    case "prefix":
      return [m.prefix];
    case "prefixes":
      return m.prefixes.map((p) => p.prefix);
    case "domain-suffix":
    case "assignment":
      return m.suffixes;
    case "labeled":
      return m.names;
    default:
      return [];
  }
}

/** 规则的判据，写成一句话。没有 core 写的说明时用 */
export function MatcherText({ m }: { m: Matcher }) {
  const t = useText(securityLabelsText).matcher;
  switch (m.kind) {
    // 代码里做的检查没有可展示的写法：按检查名说它查什么，不说怎么查
    case "builtin":
      return <>{t.builtin[m.check] ?? t.builtinOther}</>;
    case "regex":
      return t.regex(code, m.pattern, m.case_sensitive ?? false);
    case "contains":
      return t.contains(code, m.text, m.case_sensitive ?? false);
    case "codepoints":
      return t.codepoints(code, m.ranges);
    default: {
      // 内置脱敏规则的说明由 core 给；旧的 core 不给时，列出写法，没有写法的说是内置检查
      const xs = listed(m);
      if (xs.length === 0) return <>{t.builtinOther}</>;
      return (
        <>
          {xs.map((x, i) => (
            <Fragment key={x}>
              {i > 0 && t.listSep}
              {code(x)}
            </Fragment>
          ))}
        </>
      );
    }
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
