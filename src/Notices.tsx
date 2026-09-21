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
}

/**
 * 提醒。
 *
 * **这不是通知的副本，而是通知的主视图**：关窗期间发生的事留在 Rust 侧，开窗时
 * 从那里取 —— 以前配置被拒、凭据写回失败这类提示只活在 React state 里，关一次窗
 * 就永远看不到了。
 */
export function Notices({ onNavigate }: { onNavigate: (view: string) => void }) {
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
    invoke<NoticeMode>("notice_mode")
      .then(setMode)
      .catch(() => setMode("system"));
    const un = listen<NoticeMode>("notice-mode-changed", (e) => setMode(e.payload));
    return () => void un.then((f) => f());
  }, []);

  function dismiss(key: string) {
    setList((l) => l.filter((n) => n.key !== key));
    void invoke("dismiss_notice", { key });
  }

  const urgent = list.filter((n) => n.level !== "info").length;

  if (mode === "off") return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.bell(list.length)}
          // 键盘（Enter、空格）触发的 click，detail 是 0
          onClick={(e) => (byMouse.current = e.detail > 0)}
        >
          <BellIcon />
          {list.length > 0 && (
            <span
              className={cn(
                "rounded-full px-1.5 tabular-nums tw-label",
                urgent > 0
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {list.length}
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
        {/* × 和每条提醒右边的 × 在同一列：那一列是 px-3 之内的 icon-sm */}
        <header className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="flex-1 tw-head">{t.title}</span>
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
                  onClick={() => {
                    if (!n.view) return;
                    onNavigate(n.view);
                    setOpen(false);
                  }}
                >
                  <p className="tw-body">
                    {n.title}
                    {n.count > 1 && (
                      <span className="ml-1 text-muted-foreground">×{n.count}</span>
                    )}
                  </p>
                  {n.body && <p className="tw-label text-muted-foreground">{n.body}</p>}
                  <p className="tw-label text-muted-foreground">{when(n.at_ms)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.dismiss(n.title)}
                  onClick={() => dismiss(n.key)}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
