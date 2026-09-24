import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isMac } from "@/platform";
import { useText } from "@/i18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { paletteText } from "./CommandPalette.i18n";

/** 面板里的一项：一页或一个动作 */
export interface Command {
  id: string;
  group: "pages" | "actions";
  label: string;
  /** 另一种语言的名字、别名：搜索时也比对，显示时不出现 */
  keywords?: string;
  icon?: ReactNode;
  /** 右侧的键帽，比如 ⌘1 */
  shortcut?: string[];
  disabled?: boolean;
  run: () => void;
}

/**
 * ⌘K 的命令面板：输入几个字，回车跳到那一页或执行那个动作。
 *
 * **只做导航和少数几个全局动作**，不做每一页的每一个按钮 —— 那些在页面上，
 * 面板里放一份就是两套入口要一起维护。键盘：↑↓ 选、回车执行、Esc 关闭。
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const t = useText(paletteText);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
    }
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ok = commands.filter((c) => !c.disabled);
    if (!needle) return ok;
    return ok.filter((c) => `${c.label} ${c.keywords ?? ""} ${c.id}`.toLowerCase().includes(needle));
  }, [commands, q]);

  useEffect(() => {
    setAt((i) => Math.min(i, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onOpenChange(false);
    // 关掉面板之后再动：对话框的焦点归还和新页面挂上不要挤在同一帧
    setTimeout(c.run, 0);
  };

  const groups: { key: Command["group"]; title: string }[] = [
    { key: "pages", title: t.pages },
    { key: "actions", title: t.actions },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[14%] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-[520px]"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const d = e.key === "ArrowDown" ? 1 : -1;
            setAt((i) => (shown.length === 0 ? 0 : (i + d + shown.length) % shown.length));
          } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            run(shown[at]);
          }
        }}
      >
        <DialogTitle className="sr-only">{t.title}</DialogTitle>
        <DialogDescription className="sr-only">{t.placeholder}</DialogDescription>
        <div className="flex h-11 items-center gap-2.5 border-b border-border px-3.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            placeholder={t.placeholder}
            spellCheck={false}
            aria-label={t.placeholder}
            className="h-full min-w-0 flex-1 bg-transparent tw-body outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} role="listbox" aria-label={t.title} className="max-h-[min(520px,68vh)] overflow-y-auto p-1.5">
          {shown.length === 0 && <p className="px-2.5 py-6 text-center tw-body text-muted-foreground">{t.none}</p>}
          {groups.map((g) => {
            const items = shown.filter((c) => c.group === g.key);
            if (items.length === 0) return null;
            return (
              <div key={g.key} className="pb-1">
                <p className="px-2.5 pt-1.5 pb-1 tw-label font-medium text-muted-foreground">{g.title}</p>
                {items.map((c) => {
                  const i = shown.indexOf(c);
                  return (
                    <div
                      key={c.id}
                      role="option"
                      aria-selected={i === at}
                      data-index={i}
                      onMouseMove={() => setAt(i)}
                      onClick={() => run(c)}
                      className={cn(
                        "flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 tw-body select-none",
                        i === at ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4">
                        {c.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {/* macOS 上组合键写在一个键帽里（⌘1），和系统菜单一样；别的平台分开写 */}
                      {c.shortcut &&
                        (isMac ? (
                          <Kbd>{c.shortcut.join("")}</Kbd>
                        ) : (
                          <KbdGroup>
                            {c.shortcut.map((k) => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </KbdGroup>
                        ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex h-8 items-center justify-end gap-3 border-t border-border bg-surface/60 px-3 tw-label text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <KbdGroup>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </KbdGroup>
            {t.move}
          </span>
          <span className="inline-flex items-center gap-1">
            <Kbd>↵</Kbd>
            {t.open}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
