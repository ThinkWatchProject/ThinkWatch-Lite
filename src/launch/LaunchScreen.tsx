import { Suspense, lazy, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clsx } from "clsx";
import { useText } from "@/i18n";
import { troubleText } from "./trouble.i18n";
import { launchText } from "./LaunchScreen.i18n";
import { launchPhase } from "./phase";
import { connText } from "@/connection/connection.i18n";

/**
 * 至少停多久。**冷启动每次都停**：秒开也不跳过，四笔要画完、亮一下。
 * 热启动（开窗时 core 已经在跑）没有这一面，见 `warm.ts`；开机自启时不建
 * 窗口，自然也不会有。
 */
export const MIN_MS = 800;
/** 淡出多久。和 index.css 里 `.launch` 的过渡是同一个数 */
const FADE_MS = 250;
/** 过了这么久还没好，补一句已用时间 */
const SLOW_MS = 5_000;

/*
  **启动画面是冷启动最先画出来的东西，它这一块越小越好**（见 `App`）。所以这里不用 `cn`
  （它带着 tailwind-merge；这几处的类名本来就不会互相覆盖，`clsx` 拼起来就够了），出了事
  才出现的「重新启动」按钮也是用到时才载入。
*/
const RestartButton = lazy(() => import("./RestartButton"));

/**
 * TW 四笔和各自的长度。坐标和应用图标（src-tauri/icons/render.py 的 STROKES）
 * 是同一套。
 *
 * **长度写死，不用 `pathLength="1"` 归一。**虚线按归一的长度算，WebKit 各个
 * 版本的支持不一样；写死的长度哪儿都一样。V 的一边是 √(4.5² + 8²)
 */
const V = Math.hypot(4.5, 8);
const STROKES: [string, number][] = [
  ["M7 9H25", 18],
  ["M16 9V17", 8],
  ["M7 17L11.5 25L16 17", 2 * V],
  ["M16 17L20.5 25L25 17", 2 * V],
];

/**
 * 启动画面：开窗到主界面能用之间的那一面。
 *
 * **整窗盖住，而不是在内容区里画骨架。**骨架屏一出来侧栏就在，看起来已经
 * 能用了，点下去却是一句「连不上」；而那段时间里每一个取数的地方都在报错。
 * 所以连上、并且首屏的数据取好之前，只有这一面（`ready` 由 App 判断）。
 *
 * 状态只说真实走到了哪一步：网关在起（守护要等控制面答应才报「运行中」），
 * 然后是取数。起不来的时候字形熄灭，说原因、给出路。
 *
 * **这次开窗连上之后就不再出现。**之后 core 重启，是顶上那条带子在说：
 * 用户本来在看数据，整窗盖住比留着旧值加一句说明更糟。
 */
export function LaunchScreen({
  remote,
  state,
  linked,
  tries,
  linkError,
  ready,
  onGone,
}: {
  /**
   * 连的是远程 core 时是它的名字。**那时这一面只说「正在连接」**：本机 core 的那几种
   * 状态（起不来、安全模式）和它无关，重启本机 core 也不是出路 —— 连不上的原因和出路
   * 在交接之后的「未连接」页上
   */
  remote: string | null;
  /** `core_state` 的字符串 */
  state: string;
  /** 状态读到过了 */
  linked: boolean;
  /** 读状态失败了几次 */
  tries: number;
  /** 最近一次读状态失败的原因，原样（`invoke` 抛出来的东西） */
  linkError: unknown;
  /** 主界面可以接手了：连上了，首屏的数据也取好了 */
  ready: boolean;
  /** 淡出完了 */
  onGone: () => void;
}) {
  const t = useText(launchText);
  const tt = useText(troubleText);
  const ct = useText(connText);
  const born = useRef(performance.now());
  const [leaving, setLeaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  /** 点「重新启动」没成的原因，原样 */
  const [failedAction, setFailedAction] = useState<unknown>(null);
  const linkText = useErrorText(linkError);
  const failedText = useErrorText(failedAction);
  const gone = useRef(onGone);
  gone.current = onGone;

  // 能交接了：凑够最短停留，淡出，然后让位
  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_MS - (performance.now() - born.current));
    let h = setTimeout(() => {
      setLeaving(true);
      h = setTimeout(() => gone.current(), FADE_MS);
    }, wait);
    return () => clearTimeout(h);
  }, [ready]);

  // 已用时间，从这一轮开始起算：出过问题、点了重新启动，重新数
  const since = useRef(born.current);
  useEffect(() => {
    if (leaving) return;
    const h = setInterval(() => setElapsed(performance.now() - since.current), 1_000);
    return () => clearInterval(h);
  }, [leaving]);

  const { what, problem } =
    remote !== null && !linked
      ? { what: ct.connectingTo(remote), problem: null }
      : launchPhase(state, linked, tries, linkText);
  const sub =
    failedText ??
    problem?.next ??
    (elapsed >= SLOW_MS ? t.slow(Math.floor(elapsed / 1000)) : "");
  const dim = problem?.bad === true;
  const troubled = problem !== null;
  useEffect(() => {
    if (troubled) return;
    since.current = performance.now();
    setElapsed(0);
  }, [troubled]);

  function retry() {
    setBusy(true);
    setFailedAction(null);
    void invoke("restart_core")
      .catch((e: unknown) => setFailedAction(e))
      .finally(() => setBusy(false));
  }

  return (
    <div
      data-tauri-drag-region
      className={clsx(
        "launch fixed inset-0 z-[70] flex flex-col items-center justify-center bg-(--chrome-ground) px-8 select-none",
        leaving && "launch-leave",
      )}
    >
      <svg
        viewBox="0 0 32 32"
        className={clsx("launch-glyph size-24 overflow-visible", dim && "launch-dim")}
        aria-hidden
      >
        <defs>
          <linearGradient id="launch-neon" x1="7" y1="0" x2="25" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22E5F2" />
            <stop offset="1" stopColor="#F05CD8" />
          </linearGradient>
          <filter id="launch-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>
        {/* 光晕：同样四笔，粗一点、糊开，画完之后才亮 */}
        <g className="launch-glow" filter="url(#launch-blur)">
          {STROKES.map(([d]) => (
            <path key={d} d={d} className="launch-line" strokeWidth={3.6} />
          ))}
        </g>
        {STROKES.map(([d, len], i) => (
          <path
            key={d}
            d={d}
            className="launch-line launch-stroke"
            strokeWidth={2.8}
            // 整笔是一段实线，挪出去一个长度就看不见；动画把它挪回来
            style={{
              strokeDasharray: `${len} ${len * 2}`,
              strokeDashoffset: len,
              animationDelay: `${i * 120}ms`,
            }}
          />
        ))}
      </svg>
      <p className="mt-5 tw-title text-foreground">ThinkWatch Lite</p>
      <div role="status" aria-live="polite" className="mt-2 flex flex-col items-center gap-1 text-center">
        <p key={what} className={clsx("launch-say tw-body", dim ? "text-destructive" : "text-muted-foreground")}>
          {what}
        </p>
        {/* 占住一行，文字出现时下面的按钮不跳 */}
        <p className="min-h-[1.45em] max-w-md tw-label whitespace-pre-wrap text-muted-foreground">{sub}</p>
      </div>
      <div className="mt-3 h-8">
        {problem?.retry && (
          <Suspense fallback={null}>
            <RestartButton busy={busy} onClick={retry} label={tt.restart} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/** core 的译文表（`errorText` 在里面），载入过就留着 */
let coreI18n: typeof import("@/i18n/core.i18n") | null = null;

/**
 * 一个错误说成一句话（`errorText`）。**用到时才载入 core 的译文表**：那张表有一百多 kB，
 * 启动画面是冷启动最先画出来的东西，不该为了一句多半用不上的错误先等它。第一次载入完之前
 * 是 null，那一下照没出错画；载入过之后当场翻，连着失败、原因换了也不闪。
 */
function useErrorText(e: unknown): string | null {
  const [, loaded] = useReducer((n: number) => n + 1, 0);
  const want = e !== null && e !== undefined;
  useEffect(() => {
    if (!want || coreI18n) return;
    let alive = true;
    void import("@/i18n/core.i18n").then((m) => {
      coreI18n = m;
      if (alive) loaded();
    });
    return () => {
      alive = false;
    };
  }, [want]);
  return want && coreI18n ? coreI18n.errorText(e) : null;
}
