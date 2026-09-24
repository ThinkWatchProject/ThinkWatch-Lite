/**
 * 上游页几张表和几个对话框共用的小件。
 */
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Label } from "@/ui/label";
import { Logo, upstreamGlyph } from "@/ui/logos";
import { StatusDot } from "@/ui/status-dot";
import type { ProviderView } from "@/types";

/**
 * 上游的标志，放在一块小方片上：列表的每一行、编辑对话框的标题、服务类型的下拉。
 *
 * **方片而不是光秃秃的图标**：各家标志的外形差得很远（一个圆、一个字母、一串
 * 笔画），放进同样大小的方片里一列才对得齐；认不出来的上游写首字母，同一块方片。
 * 标志一律单色，跟着文字色走（见 `@/ui/logos`）。
 *
 * `live`：此刻有请求正经它转发 —— 角上一个跳动的点。
 */
export function VendorTile({
  name,
  baseUrl,
  protocol,
  size = "md",
  muted = false,
  live = false,
  className,
}: {
  name: string;
  baseUrl?: string | null;
  protocol?: string | null;
  /** `md` 28px（表格行）；`sm` 20px（下拉、标签里） */
  size?: "sm" | "md";
  /** 停用的上游：整块退成次要色 */
  muted?: boolean;
  live?: boolean;
  className?: string;
}) {
  const id = upstreamGlyph({ name, baseUrl, protocol });
  const px = size === "md" ? 16 : 12;
  return (
    <span
      data-slot="vendor-tile"
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center border border-border bg-surface shadow-[0_1px_0_0_var(--border)]",
        size === "md" ? "size-7 rounded-lg" : "size-5 rounded-md",
        muted ? "text-idle" : "text-foreground/85",
        className,
      )}
    >
      {id ? (
        <Logo id={id} size={px} />
      ) : (
        <span className={cn("font-semibold leading-none", size === "md" ? "tw-body" : "tw-label")}>{initial(name)}</span>
      )}
      {live && <StatusDot tone="pending" className="absolute -top-[3px] -right-[3px] ring-2 ring-background" />}
    </span>
  );
}

/** 名字里第一个字母或数字，大写 */
function initial(name: string): string {
  return Array.from(name.trim().replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?";
}

/** 上游的标志：直接给一条 `ProviderView` */
export function ProviderTile({
  p,
  ...rest
}: { p: Pick<ProviderView, "name" | "base_url" | "protocol"> } & Omit<
  Parameters<typeof VendorTile>[0],
  "name" | "baseUrl" | "protocol"
>) {
  return <VendorTile name={p.name} baseUrl={p.base_url} protocol={p.protocol} {...rest} />;
}

/** 一组名称标签（使用某个代理、某张价目表的上游）。空的时候说清是空的 */
export function NameChips({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-md border border-border bg-surface px-1.5 font-mono tw-label leading-5"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

/**
 * 一组上游的名称标签，各带标志。名字是用户起的（`relay-hk`），标志说的是它
 * 实际连到哪一家 —— 在「使用上游」这种一列名字里，比名字本身更快认得出。
 */
export function UpstreamChips({
  names,
  providers,
  empty,
}: {
  names: string[];
  providers: Pick<ProviderView, "name" | "base_url" | "protocol">[];
  empty: string;
}) {
  if (names.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {names.map((n) => {
        const p = providers.find((x) => x.name === n);
        const id = upstreamGlyph({ name: n, baseUrl: p?.base_url, protocol: p?.protocol });
        return (
          <span
            key={n}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface pr-1.5 pl-1 font-mono tw-label leading-5"
          >
            {id ? (
              <Logo id={id} size={11} className="text-foreground/70" />
            ) : (
              <span aria-hidden className="w-[11px] text-center font-sans font-semibold text-foreground/60">
                {initial(n)}
              </span>
            )}
            {n}
          </span>
        );
      })}
    </span>
  );
}

/**
 * 只读列表的一行：**单击打开**它的对话框，键盘上 Enter / 空格同样打开。
 *
 *   <TableRow {...openRow(() => edit(p.name), rowMotion(presence))}>
 *
 * 行里的按钮（模型数、行尾菜单）自己处理点击，外面挂 `keepInRow` 不让它冒泡成
 * 「打开这一行」。焦点来自键盘时左边描一道，鼠标点的不描（`focus-visible`）。
 */
export function openRow(open: () => void, className?: string) {
  return {
    tabIndex: 0,
    onClick: (e: MouseEvent<HTMLElement>) => {
      // 选中文字不算点击：拖着选一段地址时不该弹出对话框
      if (window.getSelection()?.toString()) return;
      if (e.defaultPrevented) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
    className: cn(
      "cursor-default outline-none focus-visible:bg-muted/60 focus-visible:shadow-[inset_2px_0_0_0_var(--ring)]",
      className,
    ),
  };
}

/** 行里自己能点的那一格：点击和按键不再冒泡成「打开这一行」 */
export const keepInRow = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
};

/**
 * 对话框里的报错。**上游页所有对话框只用这一种**：一块红色的行内横幅，出现和
 * 消失都带动画（`Banner show`）。保存、检测、删除失败都在这里说；原因是 core
 * 给的那一句，按消息码翻译过（调用方传 `errorText` 之后的文字）。
 */
export function DialogError({ error, className }: { error: string | null; className?: string }) {
  return (
    <Banner show={error != null} layout="inline" tone="error" className={className}>
      <span className="select-text break-words">{error}</span>
    </Banner>
  );
}

/** 表单里的一项：标签在上，说明在下 */
export function FormItem({
  label,
  hint,
  desc,
  htmlFor,
  className,
  children,
}: {
  label: string;
  /** 标题下、控件上的一句。控件本身是空的（比如一张还没有行的列表）时，说明放在下面会压在按钮底下 */
  hint?: ReactNode;
  desc?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="tw-body font-medium">
        {label}
      </Label>
      {hint && <p className="-mt-1 tw-label text-muted-foreground">{hint}</p>}
      {children}
      {desc && <p className="tw-label text-muted-foreground">{desc}</p>}
    </div>
  );
}

/** 对话框顶部的分节导航。新建时按顺序走，编辑时随意切换 */
export function StepNav<T extends string>({
  steps,
  current,
  done,
  onPick,
}: {
  steps: { id: T; label: string }[];
  current: T;
  /** 新建流程里已经走过的；编辑时传 undefined，每一节都能点 */
  done?: Set<T>;
  onPick?: (id: T) => void;
}) {
  return (
    <ol className="flex items-center gap-1">
      {steps.map((s, i) => {
        const on = s.id === current;
        const reachable = !done || done.has(s.id) || on;
        return (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="mx-1 h-px w-6 bg-border" />}
            <Button
              variant="ghost"
              size="sm"
              disabled={!reachable || !onPick}
              onClick={() => onPick?.(s.id)}
              aria-current={on ? "step" : undefined}
              className={cn("gap-1.5 px-2 text-muted-foreground", on && "bg-muted text-foreground")}
            >
              {done && (
                <span
                  className={cn(
                    "inline-flex size-4 items-center justify-center rounded-full border border-input tw-label tw-num transition-colors duration-(--motion-fast)",
                    (on || done.has(s.id)) && "border-foreground/40 text-foreground",
                  )}
                >
                  {i + 1}
                </span>
              )}
              {s.label}
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

/** 表格外框：圆角、描边、内部可滚 */
export function Boxed({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      {children}
    </div>
  );
}

/**
 * 对话框里一段说明或提示。`warning` 给要留意的一句（会产生费用、会改掉别的设置）。
 *
 * **报错不用它**：上游页的对话框报错一律 `DialogError`。`error` 这一档还留着，是因为
 * 路由页的几个对话框也从这里取 `Note`（它们归那一页自己迁）。
 */
export function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "tw-label",
        tone === "muted" && "text-muted-foreground",
        tone === "warning" && "text-warning",
        tone === "error" && "text-destructive",
      )}
    >
      {children}
    </p>
  );
}

// 挪到了 `@/ui/segmented`：全应用的单选都用它。设置页、密钥页、路由页还从这里取
export { Segmented } from "@/ui/segmented";

/** 单选的一行：圆点 + 标题 + 说明（路由页的分组对话框在用） */
export function RadioRow({
  checked,
  title,
  desc,
  onSelect,
  disabled,
}: {
  checked: boolean;
  title: string;
  desc: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 rounded-md text-left disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input",
          checked && "border-primary",
        )}
      >
        {checked && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="tw-body font-medium">{title}</span>
        <span className="tw-label text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
