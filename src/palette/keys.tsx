import { Kbd, KbdGroup } from "@/ui/kbd";
import { cn } from "@/lib/utils";
import { isMac } from "@/platform";

/**
 * 快捷键：**一处定义，三处显示**（命令面板每一项右端的键帽、快捷键一览、源列表的
 * 悬浮说明）。判定在 App.tsx 的全局按键和各页自己的按键里，键位改了要两边一起改。
 *
 * 一个组合写成一串键名：`["mod", "K"]`。`mod` 在 macOS 上是 ⌘，别的平台是 Ctrl
 * （见 `platform.ts` 的 `isMod`）；`alt` 是 ⌥ / Alt。
 */
export type KeyName =
  | "mod"
  | "alt"
  | "shift"
  | "enter"
  | "esc"
  | "backspace"
  | "up"
  | "down"
  | "left"
  | "right"
  | (string & {});

export type Combo = readonly KeyName[];

const MAC: Record<string, string> = {
  mod: "⌘",
  alt: "⌥",
  shift: "⇧",
  enter: "↵",
  esc: "esc",
  backspace: "⌫",
};
const OTHER: Record<string, string> = {
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  enter: "Enter",
  esc: "Esc",
  backspace: "Backspace",
};
const ARROWS: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→" };

/** 键帽上写的字 */
export function keyLabel(k: KeyName): string {
  return ARROWS[k] ?? (isMac ? MAC[k] : OTHER[k]) ?? k;
}

/** 写成一段文字（读屏、`aria-keyshortcuts` 以外的说明）：`⌘K`、`Ctrl+K` */
export function comboText(c: Combo): string {
  return c.map(keyLabel).join(isMac ? "" : "+");
}

/** 常用的几个。**和全局按键（App.tsx）一一对应** */
export const COMBOS = {
  palette: ["mod", "K"],
  refresh: ["mod", "R"],
  settings: ["mod", ","],
  search: ["mod", "F"],
  // macOS 上和访达、邮件一样是 ⌘⌥S；别的平台 Ctrl+Alt 常被输入法和桌面拿去，用 Ctrl+B
  rail: isMac ? ["mod", "alt", "S"] : ["mod", "B"],
  shortcuts: ["?"],
} as const satisfies Record<string, Combo>;

/** 源列表第 i 项（从 0 数）的键：⌘1…⌘9 */
export function pageCombo(i: number): Combo {
  return ["mod", String(i + 1)];
}

/**
 * 一个组合的键帽。**macOS 上整组写在一个键帽里**（⌘⌥S），和系统菜单一样；别的平台
 * 一个键一个键帽（Ctrl B）。
 */
export function Keys({
  combo,
  className,
  capClassName,
}: {
  combo: Combo;
  className?: string;
  /** 每个键帽上的类（选中的行里键帽换底色） */
  capClassName?: string;
}) {
  if (isMac || combo.length === 1) {
    return (
      <Kbd className={cn("tw-num", className, capClassName)} aria-label={comboText(combo)}>
        {combo.map(keyLabel).join("")}
      </Kbd>
    );
  }
  return (
    <KbdGroup className={className} aria-label={comboText(combo)}>
      {combo.map((k) => (
        <Kbd key={k} className={capClassName}>
          {keyLabel(k)}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

/**
 * 焦点在能打字的地方。**这时单键快捷键（`?`）不接管**：那是在输入。
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/**
 * 开着一个模态对话框（编辑上游、确认删除……）。
 *
 * **这时不换页。**对话框里可能是改了一半的表单，⌘2 一按页面卸掉，改动跟着没了。
 * 不算的：右侧的请求详情（`Sheet`，它是一栏，看着它换页是正常的），以及标了
 * `data-passive` 的对话框 —— 命令面板和快捷键一览，里面没有要保住的东西，在一览里
 * 看到 ⌘4 就按 ⌘4 也该管用。
 */
export function modalOpen(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.querySelector(
      '[data-slot="dialog-content"][data-state="open"]:not([data-passive]), [data-slot="alert-dialog-content"][data-state="open"]',
    ) !== null
  );
}
