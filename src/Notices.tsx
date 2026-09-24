import { useCallback, useEffect, useRef, useState } from "react";
import { BellIcon, XIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { when } from "@/format";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { noticesText } from "./Notices.i18n";
import { commonText } from "@/i18n/common.i18n";
import type { NoticeMode } from "./NoticeSettings";

/** 一条提醒。判定在 Rust 侧，这里只负责显示 */
export interface Notice {
  key: string;
  level: "info" | "warning" | "critical";
  title: string;
  body: string;
  /** 点开之后落在哪一页 */
  view?: string | null;
  first_at_ms: number;
  at_ms: number;
  /** 同一件事发生了几次 */
  count: number;
  notified: boolean;
  /** 看过了。没好的照样在列表里，只是铃铛不再数它 */
  read: boolean;
}

/**
 * 提醒。
 *
 * **这不是通知的副本，而是通知的主视图**：关窗期间发生的事留在 Rust 侧，开窗时
 * 从那里取 —— 以前配置被拒、凭据写回失败这类提示只活在 React state 里，关一次窗
 * 就永远看不到了。
 */
export function Notices({
  onNavigate,
  asked = 0,
}: {
  onNavigate: (view: string) => void;
  /** 菜单栏里点了「全部提醒…」：数一变就打开 */
  asked?: number;
}) {
  const t = useText(noticesText);
  const c = useText(commonText);
  const [list, setList] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  /** 这一次是不是用鼠标点开的。决定打开时焦点进不进面板，见 onOpenAutoFocus */
  const byMouse = useRef(false);
  // 提醒关掉了就不放铃铛：列表永远是空的，留着它只是占地方
  const [mode, setMode] = useState<NoticeMode | null>(null);

  const load = useCallback(() => {
    invoke<Notice[]>("notices_list")
      .then(setList)
      .catch(() => {
        // 拿不到就当没有：提醒本身不该成为一个故障点
      });
  }, []);

  useEffect(() => {
    load();
    const un = listen<Notice[]>("notices-changed", (e) => setList(e.payload));
    return () => void un.then((f) => f());
  }, [load]);

  useEffect(() => {
    if (asked > 0) setOpen(true);
  }, [asked]);

  useEffect(() => {
    invoke<NoticeMode>("notice_mode")
      .then(setMode)
      .catch(() => setMode("system"));
    const un = listen<NoticeMode>("notice-mode-changed", (e) => setMode(e.payload));
    return () => void un.then((f) => f());
  }, []);

  function markRead(key: string) {
    setList((l) => l.map((n) => (n.key === key ? { ...n, read: true } : n)));
    void invoke("mark_notice_read", { key });
  }

  function markAllRead() {
    setList((l) => l.map((n) => ({ ...n, read: true })));
    void invoke("mark_all_notices_read");
  }

  function clearAll() {
    setList([]);
    void invoke("clear_notices");
  }

  /** 点开一条：落到能处理它的那一页。点开了就是看过了 */
  function openNotice(n: Notice) {
    if (!n.view) return;
    if (!n.read) markRead(n.key);
    onNavigate(n.view);
    setOpen(false);
  }

  // 铃铛只数没看过的。看过的问题没好之前还留在列表里，但不该一直催
  const unread = list.filter((n) => !n.read);
  const urgent = unread.some((n) => n.level !== "info");

  if (mode === "off") return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.bell(unread.length)}
          // 键盘（Enter、空格）触发的 click，detail 是 0
          onClick={(e) => (byMouse.current = e.detail > 0)}
        >
          <BellIcon />
          {unread.length > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 tabular-nums tw-label",
                urgent
                  ? "bg-destructive text-white"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {unread.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 gap-0 p-0"
        /*
          **鼠标点开时，焦点不进面板。**Radix 默认聚焦第一个可聚焦元素，也就是
          标题栏的 ×，WebKit 会给它画焦点框。改成聚焦面板本身也不行：WebKit
          判断「脚本设的焦点画不画框」看的是上一次焦点是不是点出来的，而面板
          已经有焦点时，点提醒正文不会改写这一笔 —— 关闭后焦点还给铃铛，铃铛
          上就套着一圈框。焦点不进面板，之后点面板里任何地方都记作点击。

          键盘打开的照旧把焦点放进面板本身：Tab 才走得到 ×，又不会一打开就
          高亮在 × 上。
        */
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (!byMouse.current) (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {/*
          × 只管关掉面板，对条目的操作一律写成字：以前每条提醒右边也是一个 ×
          （删除），和这个 × 叠在同一列，分不清哪个是关、哪个是删。

          「全部清除」离 × 最远；「全部已读」没得读时变灰而不是藏起来 —— 藏起来的话
          「全部清除」会挪到刚点过的位置上，连点两下就把列表清空了。
        */}
        <header className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          <span className="flex-1 tw-head">{t.title}</span>
          {list.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={clearAll}
              >
                {t.clearAll}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={unread.length === 0}
                onClick={markAllRead}
              >
                {t.readAll}
              </Button>
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={c.close}
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </Button>
        </header>
        {list.length === 0 ? (
          <p className="px-3 py-6 text-center tw-body text-muted-foreground">{t.empty}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {list.map((n) => (
              <li key={n.key} className="flex items-start gap-2 px-3 py-2.5">
                <i
                  aria-hidden
                  className={cn(
                    "mt-1.5 inline-block size-1.5 shrink-0 rounded-full",
                    n.level === "critical" && "bg-destructive",
                    n.level === "warning" && "bg-warning",
                    n.level === "info" && "bg-muted-foreground/50",
                  )}
                />
                <div
                  className={cn("min-w-0 flex-1", n.view && "cursor-pointer")}
                  onClick={() => openNotice(n)}
                >
                  <p className={cn("tw-body", n.read && "text-muted-foreground")}>
                    {n.title}
                    {n.count > 1 && (
                      <span className="ml-1 text-muted-foreground">×{n.count}</span>
                    )}
                  </p>
                  {n.body && <p className="tw-label text-muted-foreground">{n.body}</p>}
                  {/*
                    「标为已读」在时间这一行的右端，不占标题和正文的宽度。按钮比这一行
                    高，上下各让出 4px：看过和没看过的行一样高，点完不会把下面的行挪位
                  */}
                  <div className="flex h-4 items-center justify-between gap-2">
                    <p className="tw-label text-muted-foreground">{when(n.at_ms)}</p>
                    {!n.read && (
                      <Button
                        variant="ghost"
                        size="xs"
                        className="-my-1 -mr-2"
                        aria-label={t.readOne(n.title)}
                        onClick={(e) => {
                          // 只标已读，不算点开这一条
                          e.stopPropagation();
                          markRead(n.key);
                        }}
                      >
                        {t.read}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
