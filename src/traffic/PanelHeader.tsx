import { useEffect, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";

/**
 * 右侧浮层（请求详情、会话详情）顶上那一块：标题一行，下面一行要点，可选的一排
 * 标签。
 *
 * **两个浮层同一个头。**原来请求详情是 `px-3 py-2` 的一条细边、会话详情是 `p-4`
 * 的一段文字加 Sheet 自带的 ×，叠在一起时两层的标题、关闭钮都不在同一个位置。
 *
 * **关闭钮在标题这一行里，不用 Sheet 自带的那个。**自带的是 `absolute top-3
 * right-3` 的方块，和这一行的基线对不上；放进来之后它跟着标题走。
 *
 * 标题截断、关闭钮 `shrink-0`：标题一长，浏览器会去挤按钮，按钮挤无可挤就把
 * 「关闭」折成两行。
 *
 * `tabs`：一排 `variant="line"` 的标签，贴着底边那条线 —— 和页头的标签同一个
 * 做法（`PageHeader`），选中的那条下划线压在分隔线上。
 */
export function PanelHeader({
  title,
  meta,
  onClose,
  tabs,
  children,
  className,
}: {
  title: ReactNode;
  /** 标题后面淡一档的一小段（时刻） */
  meta?: ReactNode;
  onClose: () => void;
  /** 贴着底边的一排标签 */
  tabs?: ReactNode;
  /** 第二行：这一条的要点 */
  children?: ReactNode;
  className?: string;
}) {
  const common = useText(commonText);
  return (
    <header
      data-slot="panel-header"
      className={cn("shrink-0 border-b border-border px-4 pt-3", tabs ? "pb-0" : "pb-3", className)}
    >
      <div className="flex min-h-7 items-center gap-2">
        <h2 className="min-w-0 truncate tw-title text-foreground">{title}</h2>
        {meta && <span className="shrink-0 tw-num tw-label whitespace-nowrap text-muted-foreground">{meta}</span>}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mr-1.5 shrink-0 text-muted-foreground"
          aria-label={common.close}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      {children && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 tw-body text-muted-foreground">
          {children}
        </div>
      )}
      {/* 左移到标签的字和标题对齐：列表有 3px 内边距、每个标签左右 6px */}
      {tabs && <div className="mt-2.5 -ml-[9px]">{tabs}</div>}
    </header>
  );
}

/** 等这么久还没取到，才画骨架 */
const SKELETON_DELAY_MS = 150;

/**
 * 浮层里取数时的样子，**150ms 之后才露出来**。本机取一条详情通常只要几毫秒：
 * 骨架在滑进来的浮层里闪一帧、再换成内容，比什么都不画更扎眼。取得慢时它再
 * 淡进来。里面放和内容同样形状的骨架（`PanelHeaderSkeleton` 加几块）。
 */
export function PanelSkeleton({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setOn(true), SKELETON_DELAY_MS);
    return () => clearTimeout(h);
  }, []);
  return (
    <div aria-busy="true" className={cn("flex min-h-0 flex-1 flex-col", on ? "motion-fade" : "invisible")}>
      {children}
    </div>
  );
}

/**
 * 头还没取到时的样子：同样的高度，标题和要点各一条骨架；`tabs` 是有几个标签，
 * 同样高的一排短条占住它们的位置。
 */
export function PanelHeaderSkeleton({
  onClose,
  title,
  tabs,
}: {
  onClose: () => void;
  title?: ReactNode;
  tabs?: number;
}) {
  return (
    <PanelHeader
      title={title ?? <Skeleton className="my-1 h-4 w-44 rounded-sm" />}
      onClose={onClose}
      tabs={
        tabs ? (
          <div className="flex h-8 items-center gap-5 px-[9px]">
            {Array.from({ length: tabs }, (_, i) => (
              <Skeleton key={i} className="h-3 w-9 rounded-sm" />
            ))}
          </div>
        ) : undefined
      }
    >
      <Skeleton className="my-1 h-3 w-64 rounded-sm" />
    </PanelHeader>
  );
}
