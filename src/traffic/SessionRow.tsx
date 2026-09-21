import { ChevronDown, ChevronRight } from "lucide-react";
import { Tip } from "@/ui/tip";
import { TableCell, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { sessionsText } from "@/Sessions.i18n";
import { SessionCost } from "./SessionCost";
import { dur, tokens as short, when } from "./format";
import { failedIn, type Group } from "./grouping";

/**
 * 归组之后的组头：**一次会话，占一行**。
 *
 * **不是一条横跨整表的横幅。**每一列都保留它自己的意思，组头只是把
 * 同一个问题问在另一个粒度上 —— 时间是这次任务什么时候开始的，延迟是
 * 它跑了多久，token 是上下文的峰值。横幅式的组头会让这张表在折叠态下
 * 变成两张不相干的表叠在一起。
 *
 * 只有「上游」这一列在两个粒度上问的不是同一件事：一条请求走了哪一家，
 * 而一次任务可能走过好几家 —— **而那恰恰是两个视图原来都说不出的话**
 * （「这次任务中途切到 openrouter 了两回」）。
 */
export function SessionRow({
  g,
  open,
  showClient,
  selected,
  onToggle,
  onOpen,
}: {
  g: Group;
  open: boolean;
  showClient: boolean;
  selected: boolean;
  onToggle: () => void;
  /** 点组头本身 —— 右侧分栏里打开这次会话 */
  onOpen: () => void;
}) {
  const t = useText(appText);
  const ts = useText(sessionsText);
  const s = g.session;
  const rows = g.rows;
  const started = s?.started_ms ?? Math.min(...rows.map((r) => r.atMs));
  const ended = s?.ended_ms ?? Math.max(...rows.map((r) => r.atMs));
  // **上游从行里数，不从汇总里拿** —— `SessionView` 没有这一项，
  // 而组里的每一条都知道自己走了哪家
  const providers = [...new Set(rows.map((r) => r.provider))];
  const failed = s?.errors ?? failedIn(g);
  const turns = s?.turns ?? rows.length;

  return (
    <TableRow
      onClick={onOpen}
      className={
        "cursor-pointer border-b border-neutral-100 bg-neutral-50/60 font-medium dark:border-neutral-900 dark:bg-neutral-900/40 " +
        (selected ? "bg-neutral-100 dark:bg-neutral-800" : "")
      }
    >
      <TableCell className="whitespace-nowrap">
        <span className="flex items-center gap-1">
          {/* 展开钮**不能连带打开右边的详情** —— 那是两个动作 */}
          <button
            type="button"
            aria-label={open ? t.collapseSession : t.expandSession}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="rounded p-0.5 text-muted-foreground hover:bg-neutral-200 dark:hover:bg-neutral-700"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <span>{t.turnCount(turns)}</span>
          {failed > 0 && (
            <span className="text-red-600 dark:text-red-400">
              {ts.failedTurns(failed)}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">{when(started)}</TableCell>
      {showClient && <TableCell>{s?.client ?? rows[0]?.client}</TableCell>}
      <TableCell className="max-w-48 truncate" title={s?.models.join(ts.modelSep)}>
        {s?.models.join(ts.modelSep) ?? ""}
      </TableCell>
      <TableCell className="max-w-32 truncate" title={providers.join(" · ")}>
        {providers.join(" · ")}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {dur(ended - started)}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {s ? (
          <Tip text={ts.peakContext}>
            <span>{short(s.peak_input_tokens)}</span>
          </Tip>
        ) : (
          ""
        )}
      </TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {s ? <SessionCost s={s} /> : ""}
      </TableCell>
    </TableRow>
  );
}
