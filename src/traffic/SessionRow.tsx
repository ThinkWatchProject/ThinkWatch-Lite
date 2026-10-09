import { memo, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { notSent } from "@/requestRouting";
import type { RequestRow, SessionView } from "@/types";
import { Button } from "@/ui/button";
import { UpstreamLogo } from "@/ui/logos";
import type { MenuItems } from "@/ui/row-menu";
import { StatusDot } from "@/ui/status-dot";
import { TableCell, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { copyText } from "@/ui/notify";
import { KeyCell, ROW } from "./cells";
import { costCell } from "./costCell";
import { SessionCost } from "./SessionCost";
import { sessionsText } from "./Sessions.i18n";
import { compact as short, span as dur, whenMinute as when } from "@/format";
import { RowActions } from "./TableMenus";
import { tallyOf, type Cursor, type Group, type Tally } from "./grouping";
import { capped, NAME_PX, textWidth, type Col, type Widths } from "./virtual";

type Text = (typeof sessionsText)["zh"];

/**
 * 归组之后的组头：**一次会话，占一行**。
 *
 * **不是一条横跨整表的横幅。**每一列都保留它自己的意思，组头只是把
 * 同一个问题问在另一个粒度上 —— 时间是这次任务什么时候开始的，延迟是
 * 它跑了多久，token 是上下文的峰值。横幅式的组头会让这张表在折叠态下
 * 变成两张不相干的表叠在一起。
 *
 * 只有「上游」这一列在两个粒度上问的不是同一件事：一条请求走了哪一个上游，
 * 而一次任务可能走过好几个 —— **而那恰恰是两个视图原来都说不出的话**
 * （「这次任务中途切到 openrouter 了两回」）。
 *
 * **组头的每一格都不比请求行宽多少。**列宽是按请求行调出来的：默认窗口
 * 下平表正好放得下，费用在最右（见 `RequestTable` 里上游那一格）。组头
 * 原来把失败数、费用的限定语、整串模型和上游都摊在一行里，归组之后表宽
 * 出一百多像素，费用被挤出视野。所以组头只写一眼要看的那部分，其余的进
 * 悬停：失败数是一个红点加数字，费用缺了轮次写成下限，名字只有第一个
 * 决定列宽。
 *
 * 右键和行尾「…」的菜单是整张表共用的那一份（`TableMenus`），条目见 `sessionItems`。
 */
export const SessionRow = memo(function SessionRow({
  g,
  open,
  showClient,
  hints,
  selected,
  fresh,
  onToggle,
  onOpen,
  onCursor,
}: {
  g: Group;
  open: boolean;
  showClient: boolean;
  /** 同请求行：密钥那一格要不要给应用的标志留位置 */
  hints: boolean;
  selected: boolean;
  /** 刚出现的会话，滑进来 */
  fresh: boolean;
  onToggle: (id: string) => void;
  /** 点组头本身 —— 右侧打开这次会话 */
  onOpen: (id: string) => void;
  onCursor: (c: Cursor) => void;
}) {
  const t = useText(sessionsText);
  const f = sessionFacts(g);
  const c: CellCtx = { t, open, selected, hints, onToggle };
  const openIt = () => {
    // 点组头和点请求行一样，键盘接着从这一行往下走
    onCursor({ kind: "session", id: f.id });
    onOpen(f.id);
  };

  return (
    <TableRow
      // 键盘选中组头时流量页按它找到这一行、滚进视野
      data-session={f.id}
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      onClick={openIt}
      className={cn(ROW, "bg-foreground/[0.025] font-medium", fresh && "motion-row-in")}
    >
      <TableCell>{sessionCell("status", f, c)}</TableCell>
      <TableCell>{sessionCell("time", f, c)}</TableCell>
      {showClient && <TableCell>{sessionCell("client", f, c)}</TableCell>}
      <TableCell>{sessionCell("model", f, c)}</TableCell>
      <TableCell>{sessionCell("upstream", f, c)}</TableCell>
      <TableCell className="text-right">{sessionCell("latency", f, c)}</TableCell>
      <TableCell className="text-right">{sessionCell("tokens", f, c)}</TableCell>
      <TableCell className="text-right">{sessionCell("cost", f, c)}</TableCell>
      <TableCell className="w-6 px-0! py-0 text-center font-normal" onClick={(e) => e.stopPropagation()}>
        <RowActions target={{ kind: "session", id: f.id }} label={t.sessionActions} selected={selected} />
      </TableCell>
    </TableRow>
  );
});

/** 组头的菜单条目：右键和行尾「…」共用。`openIt` 和点组头本身是同一件事 */
export function sessionItems(
  id: string,
  open: boolean,
  t: Text,
  on: { openIt: () => void; toggle: () => void },
): MenuItems {
  return [
    { kind: "item", label: t.openSession, onSelect: on.openIt },
    { kind: "item", label: open ? t.collapseSession : t.expandSession, onSelect: on.toggle },
    { kind: "sep" },
    { kind: "item", label: t.copySessionId, onSelect: () => void copyText(id) },
  ];
}

/** 组头上要写的几样，从组里算一次 */
interface Facts {
  id: string;
  s: SessionView | null;
  first: RequestRow | undefined;
  /** 汇总加上汇总里还没有的那几轮：在跑的、刚落地的（见 `tally`） */
  n: Tally;
  providers: string[];
}

function sessionFacts(g: Group): Facts {
  const rows = g.rows;
  return {
    // 组头只画有会话的组：无主的请求在表里直接画成一行请求
    id: g.id ?? "",
    s: g.session,
    first: rows[0],
    n: tallyOf(g),
    // **上游从行里数，不从汇总里拿** —— `SessionView` 没有这一项，
    // 而组里的每一条都知道自己走了哪个上游（没有发往任何上游的那几条是空的，不算；上游都满着
    // 的那几条记在最后看过的那一家上，可那一家没收到它，也不算 —— 见 `notSent`）
    providers: [...new Set(rows.filter((r) => notSent(r) === null).map((r) => r.provider).filter(Boolean))],
  };
}

type CellCtx = { t: Text; open: boolean; selected: boolean; hints: boolean; onToggle: (id: string) => void };

/** 组头的一格。组头自己和表头量列宽的那一块（`SessionSizerCell`）都用它 */
function sessionCell(col: Col, f: Facts, { t, open, selected, hints, onToggle }: CellCtx): ReactNode {
  const { id, s, first, n, providers } = f;
  switch (col) {
    case "status":
      return (
        <span className="flex items-center gap-1">
          {/* 展开钮**不能连带打开右边的详情** —— 那是两个动作 */}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={open ? t.collapseSession : t.expandSession}
            // 键盘用 → ← 展开收起；Tab 只停在选中的那一个组头上，同行尾的「…」
            tabIndex={selected ? 0 : -1}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(id);
            }}
            className="-my-1 -ml-1.5 size-5 text-muted-foreground"
          >
            <ChevronRightIcon
              className={cn("transition-transform duration-(--motion-fast) ease-(--motion-ease)", open && "rotate-90")}
            />
          </Button>
          <span>{t.turnCount(n.turns)}</span>
          {/*
            失败数：红点加数字，和请求行里失败那一条是同一个红点。「几轮
            失败」这几个字进悬停 —— 写成「1 失败」要 42px，英文「1 failed」
            要 50px，红点加数字是 22px。
          */}
          {n.failed > 0 && (
            <Tip lazy text={t.failedTip(n.failed)}>
              <span className="flex items-center gap-[3px] text-destructive">
                <StatusDot tone="error" />
                <span aria-hidden>{n.failed}</span>
                <span className="sr-only">{t.failedTip(n.failed)}</span>
              </span>
            </Tip>
          )}
        </span>
      );
    /*
      正在进行的会话：开始时刻前面一个跳动的点，和在跑的请求行上是同一个点。
      **不放在状态那一格**：那一格已经是整列最宽的（展开钮、轮数、失败数），
      再加一个点，默认窗口下归组的表就比页面宽；这一格比请求行的「16:42:01」
      窄，放得下。
    */
    case "time":
      return n.running > 0 ? (
        <Tip lazy text={t.runningTip(n.running)}>
          <span className="flex items-center gap-1.5">
            <StatusDot tone="pending" />
            {when(n.started)}
            <span className="sr-only">{t.runningTip(n.running)}</span>
          </span>
        </Tip>
      ) : (
        when(n.started)
      );
    case "client":
      return (
        <KeyCell
          client={s?.client ?? first?.client ?? ""}
          masked={first?.keyMasked}
          hint={first?.hint}
          peer={first?.peer}
          hints={hints}
        />
      );
    case "model":
      return <Names items={n.models} sep={t.modelSep} max={NAME_PX.model} />;
    // 标志和名字一起封顶，和请求行的上游那一格一样
    case "upstream":
      return (
        <span className="flex items-center gap-1.5" style={{ maxWidth: NAME_PX.upstream }}>
          {providers[0] !== undefined && !first?.local && <UpstreamLogo name={providers[0]} className="opacity-70" />}
          <Names items={providers} sep=" · " />
        </span>
      );
    case "latency":
      return dur(n.ended - n.started);
    // 上下文峰值和费用只有汇总里有：第一轮还没落库的会话写「—」，和请求行一样
    case "tokens":
      return s ? (
        <Tip lazy text={t.peakContext}>
          <span>{short(s.peak_input_tokens)}</span>
        </Tip>
      ) : (
        <span className="text-muted-foreground">—</span>
      );
    case "cost":
      return s ? <SessionCost s={s} /> : <span className="text-muted-foreground">—</span>;
  }
}

/** 表头里量列宽用的组头的一格：和组头里的那一格画得一模一样，只是没人点得到它 */
export function SessionSizerCell({ col, g, hints }: { col: Col; g: Group; hints: boolean }) {
  const t = useText(sessionsText);
  return sessionCell(col, sessionFacts(g), { t, open: false, selected: false, hints, onToggle: () => {} });
}

/**
 * 组头各列大约多宽，挑表头里垫哪几格用（见 `widest`）。和 `sessionCell` 写的是同样的字；
 * 图标、展开钮按两三个字宽算。名字和请求行一样按画出来的宽度封顶（`NAME_PX`）。
 */
export function sessionWidths(g: Group, t: Text): Widths {
  const { s, first, n, providers } = sessionFacts(g);
  // 第一个名字，有其余的再加上留给它们的一个省略号（`Names`）
  const names = (xs: string[]) => (xs[0] === undefined ? 0 : textWidth(xs[0]) + (xs.length > 1 ? 2 : 0));
  const upstream = capped(names(providers), NAME_PX.upstream, 22) + 3;
  return {
    status: 3 + textWidth(t.turnCount(n.turns)) + (n.failed > 0 ? 2 + String(n.failed).length : 0),
    time: textWidth(when(n.started)) + (n.running > 0 ? 2 : 0),
    client: capped(textWidth(s?.client ?? first?.client ?? ""), NAME_PX.client, first?.peer ? 18 : 0) + (first?.peer ? 3 : 0),
    model: capped(names(n.models), NAME_PX.model),
    upstream,
    upstreamMin: upstream,
    latency: textWidth(dur(n.ended - n.started)),
    tokens: s ? textWidth(short(s.peak_input_tokens)) : 1,
    cost: s ? textWidth(costCell(s, t).text) : 1,
  };
}

/**
 * 组头里的一串名字（模型、上游）。**决定列宽的只有第一项。**
 *
 * 一次任务用过三个模型、走过四个上游很常见，连起来写有两三百像素 ——
 * 让它撑列宽，费用就被挤出视野。所以第一项完整显示；分隔符和其余的那段
 * 宽度记作 0（`w-0 flex-1`），这一列有多宽就显示多少，最少留出一个省略号：
 * 窄的时候是「claude-sonnet-5…」，宽的时候整串都在。截断了的悬停看全。
 *
 * **整块和请求行同一个上限**（`max`，或者外面那一块的，见 `NAME_PX`）：第一项
 * 本身就超长时，它让出最后那个省略号的位置，组头不比请求行宽。
 *
 * **分隔符跟着后面那段，不跟着第一项。**跟着第一项的话，第一个模型正好是
 * 全表最长的那个时，组头比请求行宽出一个分隔符，归组之后整张表被撑出视野。
 *
 * `whitespace-pre` 是为了留住「 · 」两边的空格 —— 两段各是一个块，
 * 行尾和行首的空格会被吞掉。
 */
function Names({ items, sep, max }: { items: string[]; sep: string; max?: number }) {
  const [first, ...rest] = items;
  if (first === undefined) return null;
  return (
    <Tip clip text={items.join(sep)}>
      <div className="flex min-w-0 flex-1" style={max === undefined ? undefined : { maxWidth: max }}>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{first}</span>
        {rest.length > 0 && (
          <span className="w-0 min-w-3 flex-1 overflow-hidden text-ellipsis whitespace-pre">
            {sep + rest.join(sep)}
          </span>
        )}
      </div>
    </Tip>
  );
}
