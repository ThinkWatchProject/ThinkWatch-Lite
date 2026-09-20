import { useCallback, useEffect, useState } from "react";
import { BellIcon, XIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { toast } from "sonner";
import { when } from "@/format";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { noticesText } from "./Notices.i18n";
import { errorText } from "@/i18n/core.i18n";

/** 一条提醒。判定在 Rust 侧，这里只负责显示 */
export interface Notice {
  key: string;
  /** 属于哪一类。「不再弹出此类」按它来 */
  category: string;
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
  const [list, setList] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);

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

  function dismiss(key: string) {
    setList((l) => l.filter((n) => n.key !== key));
    void invoke("dismiss_notice", { key });
  }

  /** 这一类以后只记录、不弹出。**按类**：同一类事明天还会再发生 */
  function quiet(category: string) {
    invoke("set_notice_pref", { category, mode: "app" })
      .then(() => toast.success(t.quieted))
      .catch((e) => toast.error(errorText(e)));
  }

  const urgent = list.filter((n) => n.level !== "info").length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t.bell(list.length)}
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
      <PopoverContent align="end" className="w-96 p-0">
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
                  <p className="tw-label text-muted-foreground">
                    {when(n.at_ms)}
                    {n.notified && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            quiet(n.category);
                          }}
                        >
                          {t.quiet}
                        </button>
                      </>
                    )}
                  </p>
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
