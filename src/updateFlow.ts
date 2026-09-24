/**
 * 更新流程在界面这一侧的类型和纯函数。
 *
 * 更新窗口和设置页都用它们。**判断在 Rust 里**（这一份怎么装上来的、
 * 能不能自己装、该不该弹窗），这里只负责把 Rust 给的状态说成一句话。
 */
import { textOf } from "@/i18n";
import { updateText } from "./Update.i18n";

/** 这一份是怎么装上来的。决定更新由谁做。 */
export type Install = "homebrew" | "standalone" | "deb" | "dev";

/** 查到的新版本。 */
export interface Found {
  version: string;
}

/** 设置页读的那份状态。 */
export interface UpdateView {
  version: string;
  install: Install;
  check_updates: boolean;
  offer: Found | null;
}

/** 更新窗口要画的东西。 */
export interface Offer {
  version: string;
  current: string;
  install: Install;
  /** Homebrew 那一档要执行的命令。由 Rust 给出，界面上不再写一遍 */
  command?: string | null;
}

/** 按下安装之后走到了哪一步。 */
export type Step =
  | { step: "downloading" }
  | { step: "waiting"; in_flight: number }
  | { step: "installing" }
  | { step: "restarting" };

/**
 * 这一档能不能在窗口里直接装。
 *
 * **Homebrew 那一档不能。**应用自己把包换掉之后，Homebrew 记的版本指向
 * 一个已经不在磁盘上的版本，下一次 `brew upgrade` 会把旧的那版盖回来。
 * Rust 那一侧也挡着；这里再判断一次，是因为多出来的那个按钮本身就是错
 * 的 —— 它承诺了一件做不到的事，用户要点下去才知道。
 *
 * Linux 的 deb 可以：下载、验签之后交给系统的授权框和 apt 安装。
 */
export function canInstall(install: Install): boolean {
  return install === "standalone" || install === "deb";
}

const MB = 1_048_576;

function mb(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

/**
 * 当前这一步说成一句话。
 *
 * **总长未知时不报总长。**服务器没给 Content-Length 的时候，一句
 * 「7.2 / 0.0 MB」是在编一个数。
 */
export function describeStep(step: Step, done: number, total: number | null): string {
  const t = textOf(updateText);
  switch (step.step) {
    case "downloading":
      return total ? t.downloadingOf(mb(done), mb(total)) : t.downloading(mb(done));
    case "waiting":
      return t.waiting(step.in_flight);
    case "installing":
      return t.installing;
    case "restarting":
      return t.restarting;
  }
}
