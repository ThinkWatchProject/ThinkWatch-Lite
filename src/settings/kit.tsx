import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { CircleAlertIcon, PlugZapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/resource";
import { Button } from "@/ui/button";
import { Reveal, prefersReducedMotion } from "@/ui/motion";
import { notify } from "@/ui/notify";
import { Skeleton } from "@/ui/skeleton";
import { StatusDot, StatusLabel } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { useNavParams } from "@/nav";
import { kitText } from "./kit.i18n";

/**
 * 设置页的骨架：左边一列目录（跟着滚动点亮当前那一节），右边一节节的分组，
 * 每组是一块圆角面板，里面一行一项 —— 左边是名目和一行说明，右边是控件。
 * 样子照 macOS 的系统设置，颜色照这个应用的黑白灰。
 *
 *   <SettingsShell items={[{ id: "general", label: t.general }, …]} header={<PageHeader … />}>
 *     <SettingsGroup id="general" title={t.general}>
 *       <SettingsCard>
 *         <SettingsRow label={t.language} control={<NativeSelect … />} />
 *       </SettingsCard>
 *     </SettingsGroup>
 *   </SettingsShell>
 *
 * 目录只在内容区够宽时出现（窗口拉窄、侧栏展开时藏起来，分组照常一节节往下排）。
 */

/** 分组在页面上的锚点。深链（`nav.open("settings", { section })`）和目录都认它 */
export function anchorId(id: string): string {
  return `settings-${id}`;
}

/** 跳过去之后，分组标题离滚动区顶边多远。和目录吸顶的距离（`top-5`）一样 */
const JUMP_GAP = 20;
/** 顶边越过这条线的最后一节算「正在看的」 */
const SPY_LINE = JUMP_GAP + 44;
/** 点目录滚过去的途中不跟着点亮别的节；滚动停下这么久才放开 */
const SETTLE_MS = 160;
/** 深链落到一行时，那一行的底色亮多久 */
const FLASH_MS = 1_200;

/** 往上找第一个会竖着滚的祖先：外壳给每一页的那一层（App.tsx） */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * 滚到哪一节了，以及「跳到某一节」。
 *
 * 顶边越过判定线的最后一节算正在看的。**页尾那几节的顶边永远到不了判定线**（滚到底
 * 了它们还在下面），就把最后一段滚动平分给它们：从最后一节够得着的开始，按顺序各轮
 * 一段，到底正好是最后一节。以前是到底直接跳到最后一节，「关于」一次都轮不到；而让
 * 判定线整体往下走，又会在顶上那一节还整个露着的时候就点亮下面的。
 *
 * **点目录的那一下不让滚动途中经过的节抢走高亮**：先把目标点亮、锁住，滚动停下再
 * 放开。
 */
function useSpy(ids: readonly string[], root: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(ids[0] ?? "");
  const box = useRef<HTMLElement | null>(null);
  const lock = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = ids.join(",");

  const measure = useCallback(() => {
    const b = box.current;
    if (!b || lock.current) return;
    const list = key.split(",");
    const max = Math.max(0, b.scrollHeight - b.clientHeight);
    /** 内容顶边此刻在视口里的位置（和滚到哪儿无关的那个原点） */
    const origin = b.getBoundingClientRect().top - b.scrollTop;
    /** 每一节从哪个滚动位置起算「正在看的」：它的顶边到判定线的那一刻 */
    const starts = list.map((id) => {
      const el = document.getElementById(anchorId(id));
      return el ? el.getBoundingClientRect().top - origin - SPY_LINE : Number.POSITIVE_INFINITY;
    });
    // 页尾够不着的那几节，和最后一节够得着的一起平分最后一段
    const tail = Math.max(1, starts.findIndex((v) => v > max));
    if (starts[tail] !== undefined && starts[tail] > max) {
      const from = Math.min(max, Math.max(0, starts[tail - 1] ?? 0));
      const share = (max - from) / (list.length - tail + 1);
      for (let i = tail; i < list.length; i++) starts[i] = from + share * (i - tail + 1);
    }
    let cur = list[0] ?? "";
    list.forEach((id, i) => {
      if (b.scrollTop >= (starts[i] ?? 0) - 1) cur = id;
    });
    setActive(cur);
  }, [key]);

  useEffect(() => {
    const b = scrollParent(root.current);
    box.current = b;
    if (!b) return;
    const settle = () => {
      if (lock.current) clearTimeout(lock.current);
      lock.current = setTimeout(() => {
        lock.current = null;
      }, SETTLE_MS);
    };
    const onScroll = () => (lock.current ? settle() : measure());
    b.addEventListener("scroll", onScroll, { passive: true });
    measure();
    // 内容从骨架换成数据、一节展开或收起：各节的位置都变了
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => measure());
    if (root.current) ro?.observe(root.current);
    return () => {
      b.removeEventListener("scroll", onScroll);
      ro?.disconnect();
      if (lock.current) clearTimeout(lock.current);
      lock.current = null;
    };
  }, [measure, root]);

  /**
   * 滚到一节或一行。`id` 是一节（目录里那几项）或一行的锚点（`SettingsRow` 的
   * `anchor`：「通用」里的语言、外观……，命令面板搜到的就是它们）。一行的话，目录上点亮
   * 它所在的那一节，那一行的底色亮一下再退掉 —— 落在一节中间，要让眼睛找得到是哪一行。
   */
  const jump = useCallback(
    (id: string) => {
      const b = box.current ?? scrollParent(root.current);
      const el = document.getElementById(anchorId(id));
      if (!b || !el) return;
      const group = el.closest<HTMLElement>("section[data-section]") ?? el;
      setActive(group.dataset.section ?? id);
      if (lock.current) clearTimeout(lock.current);
      lock.current = setTimeout(() => {
        lock.current = null;
      }, SETTLE_MS * 4);
      const top = b.getBoundingClientRect().top;
      let delta = group.getBoundingClientRect().top - top - JUMP_GAP;
      if (el !== group) {
        // 那一行在这一节里很靠下、一屏放不下标题和它：让它自己靠上，上面留出一行的空
        const row = el.getBoundingClientRect();
        if (row.bottom - top - delta > b.clientHeight - JUMP_GAP) delta = row.top - top - JUMP_GAP * 3;
        el.dataset.flash = "on";
        setTimeout(() => delete el.dataset.flash, FLASH_MS);
      }
      b.scrollTo({ top: b.scrollTop + delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
      // 焦点落到那一节的标题上：键盘接着按 Tab 从这一节往下走。不带滚动，滚动上面已经做了
      group.querySelector<HTMLElement>("[data-settings-heading]")?.focus({ preventScroll: true });
    },
    [root],
  );

  return { active, jump };
}

interface Nav {
  /** 这一节有没改完的表单：目录上那一项挂一个点 */
  markDirty: (id: string, dirty: boolean) => void;
  /** 滚到某一节（摘要里的「有新版本」点过去用） */
  jump: (id: string) => void;
}

const NavCtx = createContext<Nav>({ markDirty: () => {}, jump: () => {} });

export function useSettingsNav(): Nav {
  return useContext(NavCtx);
}

/** 这一节的表单改过没存：目录上跟着挂点，存完或放弃了点消失 */
export function useDirtyMark(id: string, dirty: boolean) {
  const { markDirty } = useContext(NavCtx);
  useEffect(() => markDirty(id, dirty), [markDirty, id, dirty]);
  useEffect(() => () => markDirty(id, false), [markDirty, id]);
}

/** 目录里的一项。`caption`：这一项上面的小标题（连着远程时分「这台 Mac」和「服务器」） */
export interface IndexItem {
  id: string;
  label: string;
  caption?: string;
}

/**
 * 整页的骨架：页头、左边的目录、右边的分组。**宽度自己收**（880px，居中）：设置
 * 的一行是「名目 … 控件」，拉得太宽两头就隔得太远，读的时候要来回找。
 */
export function SettingsShell({
  items,
  header,
  children,
}: {
  items: IndexItem[];
  header: ReactNode;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const { active, jump } = useSpy(ids, root);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const markDirty = useCallback((id: string, on: boolean) => {
    setDirty((prev) => {
      if (prev.has(id) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // 深链：`nav.open("settings", { section: "listen" })`。等这一帧排完版再滚
  useNavParams("settings", (p) => {
    const s = p.section;
    if (s) setTimeout(() => jump(s), 0);
  });

  const nav = useMemo(() => ({ markDirty, jump }), [markDirty, jump]);
  return (
    <NavCtx.Provider value={nav}>
      <div ref={root} className="@container mx-auto w-full max-w-[880px]">
        {header}
        <div className="grid grid-cols-1 gap-x-10 @min-[680px]:grid-cols-[132px_minmax(0,1fr)]">
          <div className="hidden @min-[680px]:block">
            <SettingsIndex items={items} active={active} dirty={dirty} onJump={jump} />
          </div>
          <div className="flex min-w-0 flex-col gap-8">{children}</div>
        </div>
      </div>
    </NavCtx.Provider>
  );
}

/**
 * 目录。当前那一项底下垫一块灰（和侧栏的选中同一个样子），**跟着滚动滑过去**，
 * 不是一格格跳；系统里关掉了动效就直接落到位。
 */
function SettingsIndex({
  items,
  active,
  dirty,
  onJump,
}: {
  items: IndexItem[];
  active: string;
  dirty: ReadonlySet<string>;
  onJump: (id: string) => void;
}) {
  const t = useText(kitText);
  const list = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  /** 第一次落位不滑（从顶上滑下来像是出了什么事），之后才带过渡 */
  const [moving, setMoving] = useState(false);

  useLayoutEffect(() => {
    const b = list.current?.querySelector<HTMLElement>(`[data-index-item="${active}"]`);
    if (!b) return;
    const y = b.offsetTop;
    const h = b.offsetHeight;
    setPill((p) => (p && p.y === y && p.h === h ? p : { y, h }));
  }, [active, items]);
  useEffect(() => {
    if (!pill || moving) return;
    const h = setTimeout(() => setMoving(true), 60);
    return () => clearTimeout(h);
  }, [pill, moving]);

  return (
    <nav aria-label={t.index} className="sticky top-5 pt-1">
      <div ref={list} className="relative flex flex-col gap-0.5">
        {pill && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute inset-x-0 top-0 rounded-md bg-foreground/[0.07]", moving && "motion-bar")}
            style={{ transform: `translateY(${pill.y}px)`, height: pill.h }}
          />
        )}
        {items.map((it) => (
          <Fragment key={it.id}>
            {it.caption && (
              <p className="truncate px-2.5 pt-3 pb-1 tw-label font-medium text-muted-foreground first:pt-0">
                {it.caption}
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-index-item={it.id}
              aria-current={active === it.id ? "location" : undefined}
              onClick={() => onJump(it.id)}
              className={cn(
                "relative w-full justify-start gap-2 px-2.5 font-normal text-muted-foreground hover:bg-foreground/[0.035] dark:hover:bg-foreground/[0.035] active:not-aria-[haspopup]:translate-y-0",
                "aria-[current=location]:font-medium aria-[current=location]:text-foreground aria-[current=location]:hover:bg-transparent",
              )}
            >
              <span className="min-w-0 truncate">{it.label}</span>
              {dirty.has(it.id) && <StatusDot tone="warn" className="ml-auto" label={t.unsaved} />}
            </Button>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

/**
 * 一节。标题（和目录里那一项同一个词）、可选的一行说明和右侧的操作，下面是一块或
 * 几块面板。`badge`：标题后面的小标记（连着远程时写这一节改的是哪台服务器）。
 */
export function SettingsGroup({
  id,
  title,
  description,
  actions,
  badge,
  className,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const a = anchorId(id);
  return (
    <section
      id={a}
      data-section={id}
      aria-labelledby={`${a}-title`}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex min-h-7 items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2
            id={`${a}-title`}
            data-settings-heading
            tabIndex={-1}
            className="flex min-w-0 items-center gap-2 tw-head text-foreground outline-none"
          >
            <span className="truncate">{title}</span>
            {badge}
          </h2>
          {description && <p className="mt-0.5 tw-body text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * 一块面板：一组行。细边、圆角，行与行之间一条缩进的细线。
 *
 * **底色比页面高一档，用的是菜单那一档（`popover`）**：浅色下是白的，深色下比窗口底
 * 亮一点 —— 和 macOS 系统设置里的分组一个样。`surface` 在浅色下比页面暗，分段控件
 * 的灰底（`muted`）落在上面几乎看不见。
 */
export function SettingsCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-slot="settings-card" className={cn("min-w-0 overflow-hidden rounded-lg border border-border bg-popover", className)}>
      {children}
    </div>
  );
}

/** 深链落到这一行时底色亮一下（`jump` 挂上、过一会儿摘掉 `data-flash`），退掉时走过渡 */
export const FLASH = "transition-colors duration-(--motion-slow) data-[flash=on]:bg-muted";

/** 行与行之间的细线：两头各缩进 16px，第一行上面没有 */
const DIVIDER =
  "relative before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:border-t before:border-border first:before:hidden";

/**
 * 一行设置。
 *
 * · 默认：名目和说明在左，控件在右，竖着居中。窄到放不下时控件折到下一行。
 * · `stack`：控件在名目下面、占满整行（名单这类自己有好几行的控件）。
 * · `children`：行里再往下接的东西（生成完的路径、试连的结果）。
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  anchor,
  control,
  stack,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** 控件的 id。给了的话点名目会聚焦控件（开关会被拨动） */
  htmlFor?: string;
  /** 这一行自己的锚点：`nav.open("settings", { section: anchor })` 直接落到这一行 */
  anchor?: string;
  control?: ReactNode;
  stack?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const head = (
    <div className="min-w-0 flex-1 basis-56">
      <div className="tw-body text-foreground">{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}</div>
      {description && <div className="mt-0.5 tw-label text-muted-foreground">{description}</div>}
    </div>
  );
  return (
    <div
      data-slot="settings-row"
      id={anchor ? anchorId(anchor) : undefined}
      data-section={anchor}
      className={cn(DIVIDER, FLASH, "px-4 py-3", className)}
    >
      {stack ? (
        <>
          {head}
          {control && <div className="mt-2.5 min-w-0">{control}</div>}
        </>
      ) : (
        <div className="flex min-h-7 flex-wrap items-center gap-x-6 gap-y-2">
          {head}
          {/* 窄到折行时控件落在下一行的右边：一列控件始终靠右对齐 */}
          {control && <div className="ml-auto flex max-w-full min-w-0 shrink-0 items-center gap-2">{control}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/** 读取中的一行：名目和控件的位置各一块灰，数据到了不跳 */
export function RowSkeleton({ control = "w-40", description }: { control?: string; description?: boolean }) {
  return (
    <div data-slot="settings-row" aria-hidden className={cn(DIVIDER, "px-4 py-3")}>
      <div className="flex min-h-7 items-center gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-24 rounded-sm" />
          {description && <Skeleton className="h-2.5 w-56 max-w-full rounded-sm opacity-70" />}
        </div>
        <Skeleton className={cn("h-7 shrink-0 rounded-lg", control)} />
      </div>
    </div>
  );
}

/**
 * 一份 `useResource` 画在控件那一格：有数据画控件；还在读画一块同样大的灰；读
 * 不出来说一声，给重试。**不整行消失**：以前这几项读到之前是 null，读到了才冒出来，
 * 整页往下一跳。
 */
export function Loaded<T>({
  r,
  width = "w-40",
  children,
}: {
  r: Resource<T>;
  /** 骨架的宽度，和控件差不多宽 */
  width?: string;
  children: (data: T) => ReactNode;
}) {
  if (r.data !== undefined) return <>{children(r.data)}</>;
  if (r.error !== undefined && !r.loading) return <RowError error={r.error} onRetry={() => void r.reload()} />;
  return <Skeleton className={cn("h-7 rounded-lg", width)} />;
}

/** 控件那一格读不出来：一句话，原因在悬停说明里，旁边是重试 */
export function RowError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useText(kitText);
  const common = useText(commonText);
  return (
    <span className="inline-flex items-center gap-2">
      <Tip text={errorText(error)}>
        <span className="inline-flex items-center gap-1.5 tw-body text-destructive">
          <CircleAlertIcon className="size-3.5" aria-hidden />
          {t.loadFailed}
        </span>
      </Tip>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        {common.retry}
      </Button>
    </span>
  );
}

/** 没连上 core 时，改配置文件的那几节：说明白现在改不了，不画一张空表单 */
export function OfflineRow() {
  const t = useText(kitText);
  return (
    <div data-slot="settings-row" className={cn(DIVIDER, "flex items-center gap-2.5 px-4 py-3.5 tw-body text-muted-foreground")}>
      <PlugZapIcon className="size-4 shrink-0" aria-hidden />
      {t.offline}
    </div>
  );
}

/**
 * 一整节读不出来：一行说什么没读到、为什么，右边是重试。**不画骨架等下去**：读不
 * 出来的时候骨架会一直转，看起来像还在读。
 */
export function ErrorRow({
  title,
  error,
  onRetry,
  retrying,
}: {
  title: ReactNode;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const common = useText(commonText);
  return (
    <div role="alert" data-slot="settings-row" className={cn(DIVIDER, "flex items-center gap-3 px-4 py-3 motion-fade")}>
      <CircleAlertIcon className="size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="tw-body text-foreground">{title}</p>
        <p className="tw-label break-words text-muted-foreground select-text">{errorText(error)}</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="shrink-0" pending={retrying} onClick={onRetry}>
        {common.retry}
      </Button>
    </div>
  );
}

/**
 * 改配置文件的那几节底下的保存栏。**改过才出现**（没改的时候两个按钮摆在那儿，
 * 看起来像有什么没存）；存上之后停一下写「已保存」，再收起来。
 *
 * 保存按钮是表单的 submit：在输入框里按回车也是保存。
 */
export function SaveBar({
  dirty,
  pending,
  saved,
  invalid,
  onDiscard,
}: {
  dirty: boolean;
  pending: boolean;
  /** 刚存上：停在「已保存」上 */
  saved: boolean;
  /** 哪一格不对：那一格下面自己会说，这里只是保存按不下去 */
  invalid?: boolean;
  onDiscard: () => void;
}) {
  const t = useText(kitText);
  const common = useText(commonText);
  const editing = dirty || pending;
  return (
    <Reveal show={editing || saved}>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-muted/40 px-4 py-2.5">
        {editing ? (
          <StatusLabel tone="warn" muted>
            {t.unsaved}
          </StatusLabel>
        ) : (
          <StatusLabel tone="ok" className="motion-fade">
            {t.saved}
          </StatusLabel>
        )}
        {editing && (
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onDiscard}>
              {t.discard}
            </Button>
            <Button type="submit" size="sm" pending={pending} disabled={invalid}>
              {common.save}
            </Button>
          </div>
        )}
      </div>
    </Reveal>
  );
}

/** 「已保存」停多久 */
const SAVED_MS = 1_600;

/**
 * 表单刚存上的那一下：`flash()` 之后 `saved` 亮一会儿再灭。切走再回来不会再亮。
 */
export function useSavedFlash(): [boolean, () => void] {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flash = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setSaved(true);
    timer.current = setTimeout(() => setSaved(false), SAVED_MS);
  }, []);
  return [saved, flash];
}

/**
 * 改一项「这个应用自己的」设置：先按新值画上，等 Rust 回话，以它交回的**实际**
 * 状态为准；失败就弹回去并报错。`pending` 给开关用（滑块明暗）。
 */
export function useWrite<T>(r: Resource<T>, write: (next: T) => Promise<T>): [boolean, (next: T) => Promise<void>] {
  const [pending, setPending] = useState(false);
  const w = useRef(write);
  w.current = write;
  const { mutate } = r;
  const set = useCallback(
    async (next: T) => {
      const rollback = mutate(next);
      setPending(true);
      try {
        mutate(await w.current(next));
      } catch (e) {
        rollback();
        notify.error(e);
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );
  return [pending, set];
}

/**
 * 听一个 Rust 那边发的应用事件（`language-changed`、`notice-mode-changed`…）。它们
 * 不是 core 的事件，`useResource` 的 `events` 管不到。不在应用里时什么都不做。
 */
export function useAppEvent<T>(name: string, cb: (payload: T) => void) {
  const f = useRef(cb);
  f.current = cb;
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    listen<T>(name, (e) => f.current(e.payload))
      .then((un) => {
        if (dead) un();
        else off = un;
      })
      .catch(() => {});
    return () => {
      dead = true;
      off?.();
    };
  }, [name]);
}
