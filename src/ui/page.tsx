import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 页面的骨架：`Page` 管宽度和边距，`PageHeader` 是每一页顶上那一块。
 * 规则见 src/ui/README.md 的「Layout」。
 *
 *   <Page width="wide">
 *     <PageHeader title={t.title} summary={t.summary(n)} actions={<Button size="sm">…</Button>} />
 *     …内容…
 *   </Page>
 */

/**
 * 内容的最大宽度：
 *
 * · `full`：不设上限。列多、横向信息密的表（流量）。
 * · `wide`（默认）：1200px。一般的表格页、概览。窗口再宽，行也不会长到看不过来。
 * · `narrow`：760px。表单、设置、只有一段话的页（未连接）。
 *
 * 应用默认窗口 1100px，内容区约 900px —— 三档在默认窗口下一样宽，只在用户把
 * 窗口拉大时才分开。宽了之后居中。
 */
export type PageWidth = "full" | "wide" | "narrow";

const WIDTH: Record<PageWidth, string> = {
  full: "",
  wide: "max-w-[1200px]",
  narrow: "max-w-[760px]",
};

/**
 * 一页的外层。左右 20px、底部 32px 的边距，按 `width` 限宽并居中。换页的进场
 * 动画在外壳上（App.tsx），这里不用再挂。
 */
export function Page({
  width = "wide",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-slot="page" className={cn("mx-auto flex w-full min-w-0 flex-col px-5 pb-8", WIDTH[width], className)}>
      {children}
    </div>
  );
}

/**
 * 外壳和页头之间的约定：页头的标题在不在视野里。
 *
 * **标题只写一次。**页头里有大标题时，窗口顶上那条 38px 的工具栏不再重复页名；
 * 往下滚、页头的标题滚出视野之后，工具栏上淡入一个小标题 —— 和 macOS 的系统
 * 设置、访达一样。还没有页头的页，工具栏照旧一直显示页名。
 */
export const PageTitleContext = createContext<((visible: boolean | null) => void) | null>(null);

/**
 * 每一页顶上那一块：标题、一行摘要、右侧的操作，可选的一排标签。
 *
 * · `title`：页名，和源列表里那一项同一个词。
 * · `summary`：一行，说这一页现在的总体状态 —— 数字（`12 个上游 · 1 个不可用`）、
 *   状态点（`StatusLabel`）。**不写说明文字**：界面不解释机制。
 * · `actions`：这一页的主要动作。`Button size="sm"`；最多一个 `default` 变体（主
 *   动作，放最右），其余 `outline` / `ghost`。
 * · `tabs`：页内的标签（`Tabs` 的 `TabsList`）。有标签时页头下面带一条分隔线。
 */
export function PageHeader({
  title,
  summary,
  actions,
  tabs,
  className,
}: {
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}) {
  const report = useContext(PageTitleContext);
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!report || !el) return;
    report(true);
    if (typeof IntersectionObserver === "undefined") return () => report(null);
    const io = new IntersectionObserver(([e]) => report(e?.isIntersecting ?? true), { threshold: 0 });
    io.observe(el);
    return () => {
      io.disconnect();
      report(null);
    };
  }, [report]);

  return (
    <header data-slot="page-header" className={cn("flex flex-col pt-5", tabs ? "pb-0" : "pb-4", className)}>
      <div className="flex min-h-7 items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 ref={ref} className="truncate tw-title text-foreground">
            {title}
          </h1>
          {summary && (
            <div data-slot="page-summary" className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 tw-body text-muted-foreground">
              {summary}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-3 border-b border-border">{tabs}</div>}
    </header>
  );
}

/**
 * 摘要里的一项：可选的状态点或标志，加一个数和它的单位。挨着的几项之间用
 * `gap-x-3` 隔开（`PageHeader` 已经给了），不用手写「·」。
 *
 *   summary={<>
 *     <SummaryItem value={12} label={t.upstreams} />
 *     <SummaryItem lead={<StatusDot tone="error" />} value={1} label={t.unavailable} />
 *   </>}
 */
export function SummaryItem({
  lead,
  value,
  label,
}: {
  lead?: ReactNode;
  value?: ReactNode;
  label: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {lead}
      {value !== undefined && <span className="tw-num font-medium text-foreground">{value}</span>}
      <span>{label}</span>
    </span>
  );
}

/**
 * 页面里的一节：小标题、可选的说明和右侧操作，下面是内容。节与节之间 32px。
 */
export function PageSection({
  title,
  description,
  actions,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-slot="page-section" className={cn("mt-8 first:mt-0 [[data-slot=page-header]+&]:mt-1", className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-end gap-4">
          <div className="min-w-0 flex-1">
            {title && <h2 className="tw-head text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 tw-body text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
