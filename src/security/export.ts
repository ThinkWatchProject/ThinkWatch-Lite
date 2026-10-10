/**
 * 安全日志导出：一段时间里的全部命中，JSON（完整细节）或 CSV（一条一行）。
 *
 * **读的是整段，不是已经翻出来的那几页**：日志一次只读一屏半，导出要的是这段时间里的
 * 每一条，所以从头按 core 允许的最大页一页一页读完。终点定在开始导出的那一刻：读的
 * 这一会儿来了新命中，也不会让翻页错位。
 *
 * 内容在这里拼好，交给 Rust 弹「存储」对话框写盘（`api.saveExport`）。
 */
import { textOf } from "@/i18n";
import { appLabel } from "@/labels";
import type { HitLocation, OutcomeDetail, SecurityEventView, SecurityEventsPage, SecurityEventsQuery } from "@/types";
import { exportText } from "./export.i18n";
import { matchingOf, partLabel, snapshotName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { MAX_PAGE } from "./useSecurityLog";

export type ExportFormat = "json" | "csv";

/** UTF-8 的 BOM。表格软件见到它才按 UTF-8 读 */
const BOM = String.fromCharCode(0xfeff);

/** 读一页。缺省是控制面；测试里换成假的 */
type Page = (q: SecurityEventsQuery) => Promise<SecurityEventsPage>;

/**
 * `[from, to)` 里的全部命中，按时间倒序（和日志一样）。按 `before` 往前翻，直到 core 说
 * 没有更多。
 */
export async function fetchAll(page: Page, from: number, to: number): Promise<SecurityEventView[]> {
  const out: SecurityEventView[] = [];
  let before: number | null = null;
  for (;;) {
    const p = await page({ from_ms: from, to_ms: to, before, limit: MAX_PAGE });
    out.push(...p.events);
    const last = p.events[p.events.length - 1];
    if (!p.more || !last) return out;
    before = last.id;
  }
}

/** JSON：控制面的原样字段，外加这一段的起止和导出的时刻 */
export function toJson(events: SecurityEventView[], from: number, to: number, now = Date.now()): string {
  return `${JSON.stringify({ from_ms: from, to_ms: to, exported_at_ms: now, count: events.length, events }, null, 2)}\n`;
}

/** 本地时间，到秒：`2026-10-10 16:42:07`。和日志上的时刻同一个时区 */
export function localTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 位置一列里的一处：`第 4 条消息 · 用户（messages[3].content[0].text）：前文«命中»后文` */
export function locationLine(l: HitLocation): string {
  return `${partLabel(l)} (${l.path}): ${l.before}«${l.matched}»${l.after}`;
}

/** 处置细节一列 */
export function outcomeLine(d: OutcomeDetail): string {
  const t = textOf(exportText).outcome;
  switch (d.action) {
    case "recorded":
      return t.recorded;
    case "replaced":
      return t.replaced(d.placeholders.join(", "));
    case "cut":
      return `${t.cut(d.tool, d.arguments, d.truncated)}\n${t.clientNotice(d.client_notice)}`;
    case "blocked":
      return `${t.blocked}\n${t.clientNotice(d.client_notice)}`;
    case "stripped":
      return t.stripped(d.segments);
  }
}

/**
 * 一格。含逗号、引号、换行的加引号（引号写两遍，RFC 4180）。
 *
 * **以 `=` `+` `-` `@`、制表符、回车开头的前面加一个 `'`**：日志里的前后文、工具参数是
 * 模型和客户端写的，表格软件会把这样开头的一格当公式算 —— 导出的安全日志不能成为
 * 公式注入的入口。
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV：一条一行，位置合成一列（一处一行，在同一格里）。表头和处置、类型这些值按界面
 * 语言写；JSON 才是给程序读的原样字段。开头带 BOM、行尾 CRLF：表格软件按 UTF-8 打开，
 * 中文不乱码。
 */
export function toCsv(events: SecurityEventView[]): string {
  const t = textOf(exportText);
  const lt = textOf(securityLabelsText);
  const c = t.columns;
  const head = [
    c.time,
    c.action,
    c.guard,
    c.rule,
    c.ruleId,
    c.ruleSource,
    c.pattern,
    c.matching,
    c.coreVersion,
    c.excerpt,
    c.count,
    c.revealed,
    c.direction,
    c.locations,
    c.outcome,
    c.requestId,
    c.session,
    c.key,
    c.keyMasked,
    c.provider,
    c.model,
    c.sentModel,
    c.app,
    c.peer,
  ];
  const rows = events.map((e) => {
    const s = e.rule_snapshot;
    const mode = matchingOf(e);
    const locations = e.locations.map(locationLine);
    if (e.more_locations > 0) locations.push(t.more(e.more_locations));
    return [
      localTime(e.at_ms),
      lt.actions[e.action] ?? e.action,
      lt.guards[e.guard],
      snapshotName(e),
      s.id,
      s.builtin ? t.builtin : t.custom,
      s.pattern ?? "",
      mode ? lt.matching[mode] : "",
      s.core_version,
      e.excerpt,
      e.count,
      e.revealed ?? "",
      lt.directions[e.direction],
      locations.join("\n"),
      outcomeLine(e.outcome_detail),
      e.request_id,
      e.session ?? "",
      e.client,
      e.key_masked ?? "",
      e.provider,
      e.model,
      e.sent_model ?? "",
      e.client_hint ? appLabel(e.client_hint) : "",
      e.peer ?? "",
    ];
  });
  return `${BOM}${[head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** 默认文件名：`安全日志-2026-10-10-1642.csv`，按界面语言 */
export function fileName(format: ExportFormat, now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `${textOf(exportText).fileName}-${stamp}.${format}`;
}
