import { Fragment, lazy, Suspense, useMemo, type ReactNode } from "react";
import { Badge } from "@/ui/badge";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { Spinner } from "@/ui/spinner";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { appLabel } from "@/labels";
import { when } from "@/format";
import {
  PERMISSIONS,
  type Permission,
  type PluginOutcome,
  type PluginScope,
  type PluginStats,
  type PluginStatus,
  type ReplyMode,
} from "./api.provisional";
import { hunks, lineDiff, tally } from "./diff";
import { pluginLabelsText, pluginStatsText } from "./labels.i18n";
import { cpuMs, splitInvisible, touchesReplies, SCOPE_PARTS } from "./model";
import { pluginPartsText } from "./parts.i18n";

/** 代码框按需加载：CodeMirror 只在这几个对话框里用（见 `CodeView`） */
const CodeView = lazy(() => import("./CodeView"));

/**
 * 插件自己写的字：名字、说明、设置项的标签、日志、报错（I11）。
 *
 * **只当纯文本画**：React 本来就转义，这里再做两件事 —— 外面包一层 `<bdi>`，一段从右往左
 * 的文字不会把旁边界面上的字带着倒过来；看不见的字符（零宽、双向控制符）画成一个带码位的
 * 红色小标记，一个名字里藏着它们时一眼看得出来。
 */
export function PluginText({ text, className }: { text: string; className?: string }) {
  const t = useText(pluginPartsText);
  const parts = useMemo(() => splitInvisible(text), [text]);
  return (
    <bdi className={className}>
      {parts.map((p, i) =>
        "code" in p ? (
          <Tip key={i} text={t.invisible(p.code)}>
            <span className="mx-px rounded-[3px] bg-destructive/15 px-0.5 font-mono tw-label text-destructive">
              {p.code}
            </span>
          </Tip>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </bdi>
  );
}

const STATUS_TONE: Record<PluginStatus["kind"], StatusTone> = {
  ok: "ok",
  disabled: "idle",
  changed: "warn",
  error: "error",
};

export const statusTone = (s: PluginStatus): StatusTone => STATUS_TONE[s.kind] ?? "idle";

/** 状态：点加一个词。生效中的字是灰的（一列里多半都是它） */
export function StatusOf({ status }: { status: PluginStatus }) {
  const t = useText(pluginLabelsText);
  const tone = statusTone(status);
  return (
    <StatusLabel tone={tone} muted={tone === "ok" || tone === "idle"} className="shrink-0 whitespace-nowrap">
      {t.status[status.kind] ?? status.kind}
    </StatusLabel>
  );
}

const OUTCOME_TONE: Record<PluginOutcome, StatusTone> = {
  unchanged: "idle",
  changed: "ok",
  rejected: "warn",
  error: "error",
  skipped: "idle",
};

/** 一次运行的结果：未改动、已改写、已拒绝、出错、已跳过 */
export function OutcomeOf({ outcome }: { outcome: PluginOutcome }) {
  const t = useText(pluginLabelsText);
  const tone = OUTCOME_TONE[outcome] ?? "idle";
  return (
    <StatusLabel tone={tone} muted={tone === "idle"}>
      {t.outcomes[outcome] ?? outcome}
    </StatusLabel>
  );
}

/** 按约定的顺序排好（core 给的顺序不一定是这个） */
export const ordered = (ps: readonly Permission[]) => PERMISSIONS.filter((p) => ps.includes(p));

/** 一项权限的小标签。**回答中的工具调用是红的**：它是唯一被标成高风险的那一项 */
export function PermissionChip({ p }: { p: Permission }) {
  const t = useText(pluginLabelsText);
  const words = t.permissions[p];
  const danger = p === "reply_tool_calls";
  return (
    <Tip text={words ? t.chipTip(words.what, words.note) : p}>
      <Badge
        variant={danger ? "destructive" : "secondary"}
        className="h-[18px] rounded-[5px] px-1.5 font-normal"
      >
        {words?.short ?? p}
      </Badge>
    </Tip>
  );
}

export function PermissionChips({ permissions }: { permissions: readonly Permission[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {ordered(permissions).map((p) => (
        <PermissionChip key={p} p={p} />
      ))}
    </span>
  );
}

/**
 * 申请的每一项权限：能做什么，和要留意的后果。安装、更换代码、确认文件变更时给人看。
 *
 * `previous`：原来那一版申请的。这一版**新增**的标出来，不再申请的列在最后、灰着 ——
 * 一次文件变更里多要了一项权限，正是确认之前最该看见的事。
 */
export function PermissionList({
  permissions,
  previous,
  replyMode,
}: {
  permissions: readonly Permission[];
  previous?: readonly Permission[];
  replyMode?: ReplyMode;
}) {
  const t = useText(pluginLabelsText);
  const pt = useText(pluginPartsText);
  const removed = previous ? ordered(previous).filter((p) => !permissions.includes(p)) : [];
  return (
    <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
      {ordered(permissions).map((p) => {
        const words = t.permissions[p];
        const danger = p === "reply_tool_calls";
        const added = previous !== undefined && !previous.includes(p);
        const note =
          p === "reply_text" && replyMode === "block" ? t.blockMode : words?.note;
        return (
          <li
            key={p}
            data-permission={p}
            className={cn(
              "flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0",
              danger && "bg-destructive/8",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className={cn("tw-body", danger ? "font-medium text-destructive" : "text-foreground")}>
                {words?.what ?? p}
              </p>
              {note && (
                <p className={cn("tw-label", danger ? "text-destructive" : "text-muted-foreground")}>{note}</p>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-1.5 pt-px">
              {added && (
                <Badge variant="warning" className="h-[18px] rounded-[5px] px-1.5 font-normal">
                  {t.added}
                </Badge>
              )}
              {danger && (
                <Badge variant="destructive" className="h-[18px] rounded-[5px] px-1.5">
                  {t.highRisk}
                </Badge>
              )}
            </span>
          </li>
        );
      })}
      {removed.map((p) => (
        <li key={p} className="flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0">
          <p className="min-w-0 flex-1 tw-body text-muted-foreground line-through decoration-muted-foreground/60">
            {t.permissions[p]?.what ?? p}
          </p>
          <span className="shrink-0 pt-px tw-label text-muted-foreground">{pt.permissionRemoved}</span>
        </li>
      ))}
    </ul>
  );
}

/** 适用范围里一项名单写成一句：客户端按应用的名字，别的原样 */
function partText(part: (typeof SCOPE_PARTS)[number], list: readonly string[], sep: string): string {
  return list.map((x) => (part === "clients" ? appLabel(x) : x)).join(sep);
}

/**
 * 适用范围的一行摘要：「Claude Code、Codex · claude-*」，什么都没限的是「全部请求」。
 * 上游只约束回答，**只改请求的插件不写上游**（写了也不起作用）。悬停是三项各自的名单。
 */
export function ScopeSummary({ scope, permissions }: { scope: PluginScope; permissions: readonly Permission[] }) {
  const t = useText(pluginLabelsText);
  const parts = SCOPE_PARTS.filter((p) => p !== "upstreams" || touchesReplies(permissions));
  const set = parts.filter((p) => scope[p].length > 0);
  if (set.length === 0) return <span className="text-muted-foreground">{t.allRequests}</span>;
  const tip = (
    <span className="flex flex-col gap-0.5">
      {parts.map((p) => (
        <span key={p}>{t.scopeLine(t.scopeParts[p], scope[p].length > 0 ? partText(p, scope[p], t.listSep) : t.all)}</span>
      ))}
    </span>
  );
  return (
    <Tip text={tip}>
      <span className="block truncate text-muted-foreground">
        {set.map((p) => partText(p, scope[p], t.listSep)).join(" · ")}
      </span>
    </Tip>
  );
}

/**
 * 运行统计的一格：运行几次、改写几次，出错的标红。悬停是全部的数（core 启动以来）。
 */
export function StatsCell({ stats }: { stats: PluginStats }) {
  const t = useText(pluginStatsText);
  const lt = useText(pluginLabelsText);
  if (stats.calls === 0) return <span className="text-muted-foreground">{t.noRuns}</span>;
  const cpu = cpuMs(stats.avg_cpu_us);
  const rows: [string, ReactNode][] = [
    [t.lines.calls, stats.calls.toLocaleString()],
    [t.lines.changed, stats.changed.toLocaleString()],
    [t.lines.rejected, stats.rejected.toLocaleString()],
    [t.lines.errors, stats.errors.toLocaleString()],
    [t.lines.cpu, cpu ? lt.cpu(cpu) : lt.lessThanMs],
  ];
  const tip = (
    <span className="flex max-w-80 flex-col gap-0.5">
      <span className="text-muted-foreground">{t.since}</span>
      {rows.map(([k, v]) => (
        <span key={k} className="flex justify-between gap-4">
          <span>{k}</span>
          <span className="tw-num">{v}</span>
        </span>
      ))}
      {stats.last_error && (
        <span className="mt-1 flex flex-col">
          <span>
            {t.lines.lastError} · {when(stats.last_error.at_ms)}
          </span>
          <PluginText text={stats.last_error.message} className="break-words text-muted-foreground" />
        </span>
      )}
    </span>
  );
  return (
    <Tip text={tip}>
      <span className="flex flex-wrap items-center gap-x-1.5 tw-num text-muted-foreground">
        <span>{t.runs(stats.calls)}</span>
        {stats.changed > 0 && <span>· {t.changedShort(stats.changed)}</span>}
        {stats.errors > 0 && <span className="text-destructive">· {t.errorsShort(stats.errors)}</span>}
      </span>
    </Tip>
  );
}

/** 代码框：边框先画出来，编辑器加载完填进去，版面不跳 */
export function CodeBox({ code, errorAt, maxHeight }: { code: string; errorAt?: number | null; maxHeight?: number }) {
  const t = useText(pluginPartsText);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface/40">
      <Suspense
        fallback={
          <div className="flex h-24 items-center justify-center gap-2 tw-label text-muted-foreground">
            <Spinner className="size-3.5" aria-hidden />
            {t.loadingCode}
          </div>
        }
      >
        <CodeView code={code} errorAt={errorAt} maxHeight={maxHeight} />
      </Suspense>
    </div>
  );
}

/**
 * 两份文字的改动：行号、增删，改动前后各三行原样的，中间大段没动的收成一行。
 *
 * 看不见的字符在这里也画出来（`PluginText`）：一次文件变更里只多了一个双向控制符，
 * 在普通的对比里它是一行「看起来没变」的改动。
 */
export function SourceDiff({ before, after, className }: { before: string; after: string; className?: string }) {
  const t = useText(pluginPartsText);
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const pieces = useMemo(() => hunks(lines), [lines]);
  const n = useMemo(() => tally(lines), [lines]);
  if (pieces.length === 0) {
    return <p className={cn("tw-body text-muted-foreground", className)}>{t.noDifference}</p>;
  }
  const width = String(Math.max(lines.length, 1)).length;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <p className="tw-label text-muted-foreground">{t.tally(n.added, n.removed)}</p>
      <div className="max-h-80 overflow-auto rounded-lg border border-border bg-surface/40 py-1 font-mono tw-label leading-relaxed">
        {pieces.map((piece, i) =>
          piece.kind === "skip" ? (
            <div key={i} className="px-3 py-0.5 text-muted-foreground/80 select-none">
              ⋯ {t.unchangedLines(piece.count)}
            </div>
          ) : (
            piece.lines.map((l, j) => (
              <div
                key={`${i}-${j}`}
                className={cn(
                  "grid grid-cols-[auto_auto_1rem_minmax(0,1fr)] gap-x-2 px-2",
                  l.kind === "add" && "bg-success/10",
                  l.kind === "del" && "bg-destructive/8",
                )}
              >
                <span className="text-right text-muted-foreground/70 tabular-nums select-none" style={{ minWidth: `${width}ch` }}>
                  {l.a ?? ""}
                </span>
                <span className="text-right text-muted-foreground/70 tabular-nums select-none" style={{ minWidth: `${width}ch` }}>
                  {l.b ?? ""}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "select-none",
                    l.kind === "add" ? "text-success-foreground" : l.kind === "del" ? "text-destructive-foreground" : "text-muted-foreground/60",
                  )}
                >
                  {l.kind === "add" ? "+" : l.kind === "del" ? "-" : ""}
                </span>
                <span
                  className={cn(
                    "break-all whitespace-pre-wrap",
                    l.kind === "add" ? "text-success-foreground" : l.kind === "del" ? "text-destructive-foreground" : "text-foreground",
                  )}
                >
                  <PluginText text={l.text || " "} />
                </span>
              </div>
            ))
          ),
        )}
      </div>
    </div>
  );
}
