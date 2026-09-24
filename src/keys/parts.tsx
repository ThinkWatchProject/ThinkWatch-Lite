import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { AlertDialogAction } from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { IconCopied, IconCopy } from "@/ui/icons";
import { Logo, clientGlyph } from "@/ui/logos";
import { AnimatedNumber } from "@/ui/motion";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { StatusDot } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { when } from "@/format";
import { usd } from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { BARS, type KeyUse } from "./usage";
import { partsText } from "./parts.i18n";

/**
 * 密钥页和客户端页共用的几样小东西。两页的表格是同一个长相：每行开头一块带标志的
 * 小方块、两行字，右边一格 24 小时的用量（小柱图 + 次数）。
 */

/**
 * 行首的小方块：客户端的标志，或者一个图标。**28px、细边、压一档的底**，
 * 和空状态里的图标位是同一种面，只是小一号。
 */
export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * 方块里的客户端标志（单色）。**认不出来的写名字的第一个字**，不再套一层小方框
 * —— 外面已经是一个方块了，框里再画框是两层边。
 */
export function ClientMark({ id, name, size = 16 }: { id: string; name: string; size?: 16 | 18 }) {
  const g = clientGlyph(id) ?? clientGlyph(name);
  if (g) return <Logo id={g} size={size} />;
  const ch = Array.from(name.trim().replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?";
  return <span className={cn("font-semibold leading-none", size === 18 ? "tw-title" : "tw-body")}>{ch}</span>;
}

/**
 * 24 小时的小柱图：一格一小时，最后一格是正在走的这一小时（时间窗见 `usageWindow`）。
 *
 * **每一行按自己的最大值画**：它回答的是「什么时候在用」，量有多大由旁边的
 * 数字说。空着的小时画一道很淡的底线 —— 一条什么都没有的空白读起来像是没取到。
 */
export function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const max = Math.max(0, ...series);
  // 读屏读旁边的次数就够了：一排柱子念出来是二十四个数
  return (
    <span aria-hidden className={cn("flex h-4 shrink-0 items-end gap-px", className)}>
      {series.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] rounded-[1px] motion-bar",
            v > 0 ? (i === series.length - 1 ? "bg-chart-1" : "bg-chart-2") : "bg-foreground/[0.08]",
          )}
          // 有请求的格子至少 3px 高：一次请求的那一格要看得见
          style={{ height: v > 0 ? `max(3px, ${Math.round((v / max) * 100)}%)` : "1px" }}
        />
      ))}
    </span>
  );
}

/**
 * 24 小时那一格：小柱图，次数，下面一行是最近一次使用。
 *
 * · 用量没取到（`use === undefined` 且 `loaded` 为假）：只写「—」，不画一条空的柱图
 *   —— 那等于说「没有请求」，是一个编出来的零。
 * · 取到了、这把密钥没有请求：底线柱图 + 「—」。
 * · 名字为空（这个客户端还没有密钥）：「—」。
 * · 此刻有带着这把密钥的请求在跑（`busy`）：下面一行换成一个跳动的点和「请求中」
 *   —— 最近一次使用就是现在。
 *
 * 小柱图在窄窗口下收起（页面上的 `@container/page` 窄于 48rem）。
 */
export function UsageCell({
  use,
  loaded,
  lastSeen,
  busy,
  hasKey = true,
}: {
  use: KeyUse | undefined;
  /** 整份用量取到了没有 */
  loaded: boolean;
  lastSeen: number | null | undefined;
  /** 此刻有请求在跑 */
  busy?: boolean;
  hasKey?: boolean;
}) {
  const t = useText(partsText);
  if (!hasKey) return <span className="text-muted-foreground">—</span>;
  const n = use?.requests ?? 0;
  return (
    <div className="flex items-center justify-end gap-3">
      {loaded && (
        <Sparkline series={use?.series ?? EMPTY} className="motion-fade @max-3xl/page:hidden" />
      )}
      {/* 定宽：几行的小柱图才排成一列，不跟着右边字的长短左右错开 */}
      <div className="w-[5.5rem] shrink-0 text-right">
        <div className={cn("tw-num", !(loaded && n > 0) && "text-muted-foreground")}>
          {loaded && n > 0 ? <AnimatedNumber value={n} format={t.requests} /> : "—"}
        </div>
        <div className="tw-label tw-num text-muted-foreground">
          {busy ? (
            <span className="motion-fade inline-flex items-center gap-1.5">
              <StatusDot tone="pending" />
              {t.inProgress}
            </span>
          ) : (
            <LastSeen at={lastSeen} />
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY: number[] = new Array<number>(BARS).fill(0);

/** 最近一次使用：今天的写到秒，更早的写日期；从没用过就说从未使用 */
export function LastSeen({ at }: { at: number | null | undefined }) {
  const t = useText(partsText);
  return <>{at ? when(at) : t.neverUsed}</>;
}

/** 金额那一格：有费用写金额，没有写「—」（没有请求、或者都不计费时不写「$0」） */
export function CostCell({ use, loaded }: { use: KeyUse | undefined; loaded: boolean }) {
  if (!loaded || !use || use.requests === 0) return <span className="text-muted-foreground">—</span>;
  return <AnimatedNumber value={use.cost} format={(v) => usd(Math.round(v))} />;
}

/**
 * 只有图标的复制按钮。复制成功后换成一个勾，一秒半后换回来。**失败由调用方说**
 * （`onCopy` 抛出去就不打勾）。
 */
export function CopyIconButton({
  onCopy,
  label,
  className,
}: {
  onCopy: () => Promise<void>;
  label: string;
  className?: string;
}) {
  const common = useText(commonText);
  const [copied, flash] = useFlash();
  return (
    <Tip text={copied ? common.copied : label}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        className={cn("shrink-0 text-muted-foreground", className)}
        onClick={(e) => {
          e.stopPropagation();
          void onCopy().then(flash, () => {});
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {copied ? <IconCopied /> : <IconCopy />}
      </Button>
    </Tip>
  );
}

/**
 * 带字的复制按钮（对话框里用）。`label` 给了就用它（「创建并复制」），否则是「复制」。
 * 进行中转圈，复制完换成「已复制」一秒半。
 */
export function CopyButton({
  onCopy,
  label,
  disabled,
}: {
  onCopy: () => Promise<void>;
  label?: string;
  disabled?: boolean;
}) {
  const common = useText(commonText);
  const [copied, flash] = useFlash();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={disabled}
      pending={busy}
      onClick={() => {
        setBusy(true);
        onCopy()
          .then(flash, () => {})
          .finally(() => setBusy(false));
      }}
    >
      {!busy && (copied ? <IconCopied /> : <IconCopy />)}
      {copied ? common.copied : (label ?? common.copy)}
    </Button>
  );
}

/** 亮一下再灭：复制之后那个勾 */
function useFlash(ms = 1_500): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [
    on,
    () => {
      setOn(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), ms);
    },
  ];
}

/**
 * 确认框里的主按钮，带「进行中」。
 *
 * **按下去不自己关**（`preventDefault`）：结果出来之前对话框留着，按钮转圈；失败
 * 时错误写在对话框里，成功由调用方关。`AlertDialogAction` 默认一按就关 —— 那样
 * 请求还在路上，对话框先没了，失败了也没处说。
 */
export function ConfirmAction({
  pending,
  onConfirm,
  variant = "default",
  disabled,
  children,
}: {
  pending: boolean;
  onConfirm: () => void;
  variant?: "default" | "destructive";
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <AlertDialogAction
      variant={variant}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      onClick={(e) => {
        e.preventDefault();
        if (!pending) onConfirm();
      }}
    >
      {pending && <Spinner data-icon="inline-start" aria-hidden />}
      {children}
    </AlertDialogAction>
  );
}

/**
 * 对话框打开时焦点落在对话框本身，不落到第一个按钮上（`onOpenAutoFocus`）。
 *
 * **WebKit 里脚本给的焦点会在按钮上画一圈框**，除非上一次焦点来自点击 —— 从行菜单
 * 里点一项打开的确认框就不算，于是「取消」上带着一圈框，像是被选中了。焦点仍在
 * 对话框里：读屏照读，Esc 照样关，Tab 一下就到按钮。
 */
export function focusSelf(e: Event) {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
}

/**
 * 按 Esc 关掉对话框时，焦点回到打开它的那一行（`DialogContent` 上展开用）。
 *
 * Radix 的对话框关掉时只把焦点还给它自己的 Trigger。这几个对话框是点行打开的，没有
 * Trigger，焦点就落到了 body 上：用键盘的人回车打开一行、Esc 关掉之后，下一个 Tab
 * 要从页面顶上重新数起。**鼠标关掉的不还**：那是一次脚本给的焦点，WebKit 会在行上
 * 画一圈框，而点鼠标的人并不需要它。
 *
 * 打开它的元素在第一次渲染时记下（那时焦点还在行上，对话框的 effect 还没把焦点
 * 挪进来）。
 */
export function useDialogFocus() {
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  const byKey = useRef(false);
  return {
    onEscapeKeyDown: () => {
      byKey.current = true;
    },
    onCloseAutoFocus: (e: Event) => {
      if (!byKey.current || !(opener instanceof HTMLElement) || !opener.isConnected) return;
      e.preventDefault();
      opener.focus();
    },
  };
}

/**
 * 可以点开的一行：单击打开，回车或空格也打开，Tab 能停上去。
 *
 * **选中文字时不打开**：双击密钥的值是要选中它，而单击整行是打开对话框 —— 拖选
 * 结束的那一下也是一次 click。
 */
export function openable(open: () => void) {
  return {
    tabIndex: 0,
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  };
}

/**
 * 展开、收起一块内容的 ghost 按钮（带 `aria-expanded`）。**展开时不铺底色**：ghost
 * 按钮在 `aria-expanded` 时铺一层底，那是菜单按钮打开时的样子；展开的一节不是一个
 * 按下去的按钮。悬停照常有底。
 */
export const DISCLOSURE = "aria-expanded:bg-transparent aria-expanded:hover:bg-muted dark:aria-expanded:hover:bg-muted/50";

/** 可以点开的行的样子：默认光标（桌面应用不用手形），键盘停上去时一圈内描边 */
export const OPENABLE_ROW =
  "cursor-default focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50";

/**
 * 行里不该触发整行打开的那一块（按钮、链接）。点击到它为止。
 */
export function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation();
}

/**
 * 两页表格的骨架：表头一行，`rows` 行两行字的数据行（带行首方块），和真实的行
 * 一样高，数据到了之后不跳。
 */
export function RowsSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-busy="true" className="w-full">
      <div className="flex h-8 items-center gap-6 border-b border-border px-2">
        <Skeleton className="h-2.5 w-12 rounded-sm opacity-60" />
        <div className="flex-1" />
        {Array.from({ length: cols - 1 }, (_, c) => (
          <Skeleton key={c} className="h-2.5 w-14 rounded-sm opacity-60" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex h-[53px] items-center gap-6 border-b border-border/60 px-2"
          style={{ opacity: 1 - r * (0.5 / Math.max(1, rows)) }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Skeleton className="size-7 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className={cn("h-3 rounded-sm", ["w-28", "w-36", "w-24", "w-32"][r % 4])} />
              <Skeleton className={cn("h-2.5 rounded-sm opacity-70", ["w-56", "w-44", "w-60", "w-48"][r % 4])} />
            </div>
          </div>
          {Array.from({ length: cols - 1 }, (_, c) => (
            <Skeleton key={c} className={cn("h-3 rounded-sm", ["w-14", "w-20", "w-16"][(r + c) % 3])} />
          ))}
        </div>
      ))}
    </div>
  );
}
