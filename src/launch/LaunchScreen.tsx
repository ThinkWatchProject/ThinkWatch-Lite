import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { troubleText } from "./trouble.i18n";
import { launchText } from "./LaunchScreen.i18n";
import { launchPhase } from "./phase";

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
  state,
  linked,
  tries,
  linkError,
  ready,
  onGone,
}: {
  /** `core_state` 的字符串 */
  state: string;
  /** 状态读到过了 */
  linked: boolean;
  /** 读状态失败了几次 */
  tries: number;
  /** 最近一次读状态失败的原因 */
  linkError: string | null;
  /** 主界面可以接手了：连上了，首屏的数据也取好了 */
  ready: boolean;
  /** 淡出完了 */
  onGone: () => void;
}) {
  const t = useText(launchText);
  const tt = useText(troubleText);
  const born = useRef(performance.now());
  const [leaving, setLeaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failedAction, setFailedAction] = useState<string | null>(null);
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

  const { what, problem } = launchPhase(state, linked, tries, linkError);
  const sub =
    failedAction ??
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
      .catch((e) => setFailedAction(errorText(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "launch fixed inset-0 z-[70] flex flex-col items-center justify-center bg-(--chrome-ground) px-8 select-none",
        leaving && "launch-leave",
      )}
    >
      <svg
        viewBox="0 0 32 32"
        className={cn("launch-glyph size-24 overflow-visible", dim && "launch-dim")}
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
        <p key={what} className={cn("launch-say tw-body", dim ? "text-destructive" : "text-muted-foreground")}>
          {what}
        </p>
        {/* 占住一行，文字出现时下面的按钮不跳 */}
        <p className="min-h-[1.45em] max-w-md tw-label whitespace-pre-wrap text-muted-foreground">{sub}</p>
      </div>
      <div className="mt-3 h-8">
        {problem?.retry && (
          <Button size="sm" variant="outline" disabled={busy} onClick={retry}>
            {busy && <Spinner />}
            {tt.restart}
          </Button>
        )}
      </div>
    </div>
  );
}
