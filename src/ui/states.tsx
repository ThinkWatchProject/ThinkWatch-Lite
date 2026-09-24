import { useEffect, useState, type ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import type { Resource } from "@/lib/resource";
import { Button } from "./button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";
import { Skeleton } from "./skeleton";
import { Spinner } from "./spinner";
import { uiText } from "./ui.i18n";

/**
 * 状态三件套：读取中、读取失败、没有内容。**每一页、每一块取数的地方都要三样
 * 齐全**，见 src/ui/README.md 的「State trio」。
 */

/** 等这么久还没好才画「读取中」：快的那一下不闪 */
const LOADING_DELAY_MS = 180;

function useDelayed(ms: number): boolean {
  const [on, setOn] = useState(ms === 0);
  useEffect(() => {
    if (ms === 0) return;
    const h = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(h);
  }, [ms]);
  return on;
}

/**
 * 读取中：转圈加一句话，居中。**180ms 之后才出现**，读得快时什么都不画。
 * 形状已知的内容（表格、列表）用 `TableSkeleton` / `ListSkeleton`，不用它。
 */
export function LoadingState({
  label,
  className,
  delay = LOADING_DELAY_MS,
}: {
  label?: ReactNode;
  className?: string;
  delay?: number;
}) {
  const t = useText(uiText);
  const on = useDelayed(delay);
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-busy="true"
      className={cn(
        "flex flex-1 items-center justify-center gap-2 py-16 tw-body text-muted-foreground",
        on ? "motion-fade" : "invisible",
        className,
      )}
    >
      <Spinner className="size-3.5" aria-hidden />
      <span>{label ?? t.loading}</span>
    </div>
  );
}

/**
 * 读取失败：说什么没取到、为什么，给「重试」。
 *
 * `error` 直接传 catch 到的东西，这里用 `errorText` 翻成一句话（core 的结构化
 * 错误按消息码翻译）。
 */
export function ErrorState({
  title,
  error,
  onRetry,
  retrying,
  className,
  compact,
}: {
  /** 一句话：什么没取到。缺省是「读取失败」 */
  title?: ReactNode;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  /** 放在卡片、表格一格里时用：不留大块上下边距 */
  compact?: boolean;
}) {
  const t = useText(uiText);
  return (
    <Empty data-slot="error-state" className={cn(compact ? "py-6" : "py-14", "motion-fade", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="text-destructive">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>{title ?? t.loadFailed}</EmptyTitle>
        {error !== undefined && error !== null && (
          <EmptyDescription className="select-text">{errorText(error)}</EmptyDescription>
        )}
      </EmptyHeader>
      {onRetry && (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onRetry} pending={retrying}>
            {t.retry}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}

/**
 * 没有内容。**永远回答「接下来做什么」**：标题说是什么没有，说明说怎样才会有，
 * `action` 给那个能点的入口。
 *
 *   <EmptyState icon={<IconKey />} title={t.noKeys} description={t.noKeysHint}
 *     action={<Button size="sm" onClick={create}>{t.create}</Button>} />
 *
 * `variant="outlined"`：放在一块有边界的区域里（对话框、页面的一节），画虚线框。
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "plain",
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  variant?: "plain" | "outlined";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Empty
      data-slot="empty-state"
      className={cn(
        "motion-fade",
        variant === "outlined" ? "border border-dashed border-border py-10" : "py-14",
        className,
      )}
    >
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {(action || children) && (
        <EmptyContent>
          {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
          {children}
        </EmptyContent>
      )}
    </Empty>
  );
}

/** 骨架条的宽度：按列轮换，看起来像参差的真数据而不是一堵墙 */
const WIDTHS = ["w-[72%]", "w-[48%]", "w-[60%]", "w-[36%]", "w-[54%]", "w-[42%]"];

/**
 * 表格的骨架：一行表头、`rows` 行数据，行高和 `Table` 一样（36px），所以数据
 * 到了之后不跳。第一列宽一点（通常是名字）。
 */
export function TableSkeleton({
  rows = 6,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  const grid = { gridTemplateColumns: `minmax(0,1.6fr) repeat(${Math.max(0, cols - 1)}, minmax(0,1fr))` };
  return (
    <div data-slot="table-skeleton" role="status" aria-busy="true" className={cn("w-full", className)}>
      <div className="grid h-9 items-center gap-4 border-b px-2" style={grid}>
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className="h-2.5 w-10 rounded-sm opacity-60" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="grid h-9 items-center gap-4 border-b border-border/60 px-2"
          style={{ ...grid, opacity: 1 - r * (0.6 / Math.max(1, rows)) }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-3 rounded-sm", WIDTHS[(r + c * 2) % WIDTHS.length])} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 列表或卡片区的骨架：一块块圆角条 */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div data-slot="list-skeleton" role="status" aria-busy="true" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, r) => (
        <Skeleton key={r} className="h-12 w-full rounded-lg" style={{ opacity: 1 - r * 0.15 }} />
      ))}
    </div>
  );
}

/**
 * 把一份 `useResource` 的结果画成三件套之一或内容本身。
 *
 * · 还没有数据、正在读：`loading`（缺省是 `LoadingState`，形状已知时传骨架）
 * · 还没有数据、读失败：`ErrorState`，带重试
 * · 有数据、`isEmpty(data)`：`empty`
 * · 有数据：`children(data)`。**后台刷新失败时照样画旧数据**，失败交给调用方
 *   决定要不要提示（通常什么都不做，下一次事件会再读）
 *
 *   <Loadable r={keys} loading={<TableSkeleton cols={5} />}
 *     isEmpty={(d) => d.length === 0} empty={<EmptyState … />}>
 *     {(data) => <KeysTable rows={data} />}
 *   </Loadable>
 */
export function Loadable<T>({
  r,
  loading,
  empty,
  isEmpty,
  errorTitle,
  children,
}: {
  r: Resource<T>;
  loading?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
  errorTitle?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (r.data === undefined) {
    if (r.error !== undefined && !r.loading)
      return <ErrorState title={errorTitle} error={r.error} onRetry={() => void r.reload()} />;
    return <>{loading ?? <LoadingState />}</>;
  }
  if (empty !== undefined && isEmpty?.(r.data)) return <>{empty}</>;
  return <>{children(r.data)}</>;
}
