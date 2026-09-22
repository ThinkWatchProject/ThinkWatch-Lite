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
 *
 * **组头的每一格都不比请求行宽多少。**列宽是按请求行调出来的：默认窗口
 * 下平表正好放得下，费用在最右（见 `RequestTable` 里上游那一格）。组头
 * 原来把失败数、费用的限定语、整串模型和上游都摊在一行里，归组之后表宽
 * 出一百多像素，费用被挤出视野。所以组头只写一眼要看的那部分，其余的进
 * 悬停：失败数是一个红点加数字，费用缺了轮次写成下限，名字只有第一个
 * 决定列宽。
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
          {/*
            失败数：红点加数字，和请求行里失败那一条是同一个红点。「几轮
            失败」这几个字进悬停 —— 写成「1 失败」要 42px，英文「1 failed」
            要 50px，红点加数字是 22px。
          */}
          {failed > 0 && (
            <Tip text={ts.failedTip(failed)}>
              <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                />
                <span aria-hidden>{failed}</span>
                <span className="sr-only">{ts.failedTip(failed)}</span>
              </span>
            </Tip>
          )}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">{when(started)}</TableCell>
      {showClient && <TableCell>{s?.client ?? rows[0]?.client}</TableCell>}
      <TableCell>
        <Names items={s?.models ?? []} sep={ts.modelSep} />
      </TableCell>
      <TableCell>
        <Names items={providers} sep=" · " />
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

/**
 * 组头里的一串名字（模型、上游）。**决定列宽的只有第一项。**
 *
 * 一次任务用过三个模型、走过四个上游很常见，连起来写有两三百像素 ——
 * 让它撑列宽，费用就被挤出视野。所以第一项完整显示（和请求行的模型
 * 一样最多 13rem），分隔符跟在它后面；其余的那段宽度记作 0
 * （`w-0 flex-1`），这一列有多宽就显示多少，最少留出一个省略号：
 * 窄的时候是「claude-sonnet-5、…」，宽的时候整串都在。悬停看全。
 *
 * `whitespace-pre` 是为了留住「 · 」两边的空格 —— 两段各是一个块，
 * 行尾和行首的空格会被吞掉。
 */
function Names({ items, sep }: { items: string[]; sep: string }) {
  const [first, ...rest] = items;
  if (first === undefined) return null;
  return (
    <Tip text={items.join(sep)}>
      <div className="flex">
        <span className="max-w-[13rem] shrink-0 overflow-hidden text-ellipsis whitespace-pre">
          {rest.length > 0 ? first + sep : first}
        </span>
        {rest.length > 0 && (
          <span className="w-0 min-w-3 flex-1 overflow-hidden text-ellipsis whitespace-pre">
            {rest.join(sep)}
          </span>
        )}
      </div>
    </Tip>
  );
}
