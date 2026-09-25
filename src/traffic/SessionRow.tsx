import { memo } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { Button } from "@/ui/button";
import { UpstreamLogo } from "@/ui/logos";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { StatusDot } from "@/ui/status-dot";
import { TableCell, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { copyText, KeyCell, MENU_REVEAL, ROW } from "./cells";
import { SessionCost } from "./SessionCost";
import { sessionsText } from "./Sessions.i18n";
import { dur, tokens as short, when } from "./format";
import { failedIn, type Cursor, type Group } from "./grouping";

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
  // 组头只画有会话的组：无主的请求在 `RequestRows` 里直接画成一行请求
  const id = g.id ?? "";
  const s = g.session;
  const rows = g.rows;
  const first = rows[0];
  const started = s?.started_ms ?? Math.min(...rows.map((r) => r.atMs));
  const ended = s?.ended_ms ?? Math.max(...rows.map((r) => r.atMs));
  // **上游从行里数，不从汇总里拿** —— `SessionView` 没有这一项，
  // 而组里的每一条都知道自己走了哪个上游（没有发往任何上游的那几条是空的，不算）
  const providers = [...new Set(rows.map((r) => r.provider).filter(Boolean))];
  const failed = s?.errors ?? failedIn(g);
  const turns = s?.turns ?? rows.length;
  const openIt = () => {
    // 点组头和点请求行一样，键盘接着从这一行往下走
    onCursor({ kind: "session", id });
    onOpen(id);
  };
  const items: MenuItems = [
    { kind: "item", label: t.openSession, onSelect: openIt },
    { kind: "item", label: open ? t.collapseSession : t.expandSession, onSelect: () => onToggle(id) },
    { kind: "sep" },
    { kind: "item", label: t.copySessionId, onSelect: () => void copyText(id) },
  ];

  return (
    <RowMenu items={items}>
      <TableRow
        // 键盘选中组头时流量页按它找到这一行、滚进视野
        data-session={id}
        data-state={selected ? "selected" : undefined}
        aria-selected={selected}
        onClick={openIt}
        className={cn(ROW, "bg-foreground/[0.025] font-medium", fresh && "motion-row-in")}
      >
        <TableCell>
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
            <span>{t.turnCount(turns)}</span>
            {/*
              失败数：红点加数字，和请求行里失败那一条是同一个红点。「几轮
              失败」这几个字进悬停 —— 写成「1 失败」要 42px，英文「1 failed」
              要 50px，红点加数字是 22px。
            */}
            {failed > 0 && (
              <Tip text={t.failedTip(failed)}>
                <span className="flex items-center gap-[3px] text-destructive">
                  <StatusDot tone="error" />
                  <span aria-hidden>{failed}</span>
                  <span className="sr-only">{t.failedTip(failed)}</span>
                </span>
              </Tip>
            )}
          </span>
        </TableCell>
        <TableCell>{when(started)}</TableCell>
        {showClient && (
          <TableCell>
            <KeyCell
              client={s?.client ?? first?.client ?? ""}
              masked={first?.keyMasked}
              hint={first?.hint}
              peer={first?.peer}
              hints={hints}
            />
          </TableCell>
        )}
        <TableCell>
          <Names items={s?.models ?? []} sep={t.modelSep} />
        </TableCell>
        <TableCell>
          <span className="flex items-center gap-1.5">
            {providers[0] !== undefined && !first?.local && (
              <UpstreamLogo name={providers[0]} className="opacity-70" />
            )}
            <Names items={providers} sep=" · " />
          </span>
        </TableCell>
        <TableCell className="text-right">{dur(ended - started)}</TableCell>
        <TableCell className="text-right">
          {s ? (
            <Tip text={t.peakContext}>
              <span>{short(s.peak_input_tokens)}</span>
            </Tip>
          ) : (
            ""
          )}
        </TableCell>
        <TableCell className="text-right">{s ? <SessionCost s={s} /> : ""}</TableCell>
        <TableCell className="w-6 px-0! py-0 text-center font-normal" onClick={(e) => e.stopPropagation()}>
          <span className={MENU_REVEAL}>
            <RowMenuButton items={items} label={t.sessionActions} tabIndex={selected ? 0 : -1} />
          </span>
        </TableCell>
      </TableRow>
    </RowMenu>
  );
});

/**
 * 组头里的一串名字（模型、上游）。**决定列宽的只有第一项。**
 *
 * 一次任务用过三个模型、走过四个上游很常见，连起来写有两三百像素 ——
 * 让它撑列宽，费用就被挤出视野。所以第一项完整显示（和请求行的模型
 * 一样最多 13rem）；分隔符和其余的那段宽度记作 0（`w-0 flex-1`），这一列
 * 有多宽就显示多少，最少留出一个省略号：窄的时候是「claude-sonnet-5…」，
 * 宽的时候整串都在。悬停看全。
 *
 * **分隔符跟着后面那段，不跟着第一项。**跟着第一项的话，第一个模型正好是
 * 全表最长的那个时，组头比请求行宽出一个分隔符，归组之后整张表被撑出视野。
 *
 * `whitespace-pre` 是为了留住「 · 」两边的空格 —— 两段各是一个块，
 * 行尾和行首的空格会被吞掉。
 */
function Names({ items, sep }: { items: string[]; sep: string }) {
  const [first, ...rest] = items;
  if (first === undefined) return null;
  return (
    <Tip text={items.join(sep)}>
      <div className="flex min-w-0 flex-1">
        <span className="max-w-[13rem] shrink-0 overflow-hidden text-ellipsis whitespace-pre">{first}</span>
        {rest.length > 0 && (
          <span className="w-0 min-w-3 flex-1 overflow-hidden text-ellipsis whitespace-pre">
            {sep + rest.join(sep)}
          </span>
        )}
      </div>
    </Tip>
  );
}
