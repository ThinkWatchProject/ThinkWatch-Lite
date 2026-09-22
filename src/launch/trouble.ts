import { textOf } from "@/i18n";
import { troubleText } from "./trouble.i18n";

/** 把守护状态翻成「现在怎么了、能做什么」。 */
export interface Trouble {
  /** 一句话说清现在什么情况 */
  what: string;
  /** 接下来会自动发生什么，或者用户该做什么 */
  next: string;
  /** 这是个需要人介入的状态吗 —— 决定要不要上告警色 */
  bad: boolean;
  /** 能不能点一下重来 */
  retry: boolean;
}

/**
 * `core_state` 的字符串 → 界面要说的话。启动画面和断线时顶上那条带子共用。
 *
 * **不说 socket 层的错误。**「Connection refused (os error 61)」是给
 * 写代码的人看的；而这一层其实知道得多得多 —— 守护正在报「第 3 次
 * 重启，2 秒后」，那才是用户该看到的。
 */
export function trouble(raw: string, tries: number): Trouble {
  const t = textOf(troubleText);
  // core 程序运行不了：**原因要说出来**，等多久也不会自己好，所以给重试
  if (raw.startsWith("failed:")) {
    return {
      what: t.failed,
      next: raw.slice("failed:".length),
      bad: true,
      retry: true,
    };
  }
  if (raw.startsWith("missing:")) {
    return {
      what: t.missing,
      next: raw.slice("missing:".length),
      bad: true,
      retry: false,
    };
  }
  if (raw.startsWith("restarting:")) {
    const [, attempt = "1", inMs = "0"] = raw.split(":");
    const secs = Math.max(1, Math.round(Number(inMs) / 1000));
    return {
      what: t.restarting(attempt),
      next: t.retryIn(secs),
      bad: Number(attempt) >= 3,
      retry: false,
    };
  }
  if (raw === "safe_mode") {
    return {
      what: t.safeMode,
      next: t.safeModeNext,
      bad: true,
      retry: true,
    };
  }
  if (raw === "stopped") {
    return { what: t.stopped, next: t.stoppedNext, bad: true, retry: true };
  }
  if (raw === "starting") {
    return { what: t.starting, next: t.wait, bad: false, retry: false };
  }
  // running:pid —— 控制面答应过（守护要等到它答应才报「运行中」），却读不到
  // 状态：多半是 core 刚好又停了，或者两边的协议对不上
  return {
    what: t.connecting,
    next: tries > 1 ? t.attempt(tries) : t.wait,
    bad: tries > 6,
    retry: tries > 6,
  };
}
