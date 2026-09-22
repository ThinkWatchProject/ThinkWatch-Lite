import { textOf } from "@/i18n";
import { trouble, type Trouble } from "./trouble";
import { launchText } from "./LaunchScreen.i18n";

/**
 * 启动画面此刻该说什么。
 *
 * 没出事的时候只有两句：网关在起，或者在取数（守护要等控制面答应才报「运行
 * 中」，所以见到它就是在取数了）。出事的时候给 `problem`：原因、要不要标红、
 * 能不能点一下重来。
 */
export function launchPhase(
  state: string,
  linked: boolean,
  tries: number,
  linkError: string | null,
): { what: string; problem: Trouble | null } {
  const t = textOf(launchText);
  const running = state.startsWith("running:");
  // 为改配置之类主动重启的那一下（第 0 次）照「在起」算，不是出了事
  const starting = state === "starting" || state.startsWith("restarting:0:");
  const problem: Trouble | null =
    // 控制面答应过，状态却连着读不到：说读不到的原因（多半是两边版本对不上）
    running && !linked && tries >= 2 && linkError
      ? { what: t.readFailed, next: linkError, bad: true, retry: true }
      : !running && !starting && !linked
        ? trouble(state, tries)
        : null;
  return {
    what: problem?.what ?? (running || linked ? t.loading : t.starting),
    problem,
  };
}
