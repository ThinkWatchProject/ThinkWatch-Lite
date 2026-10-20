import { useText } from "@/i18n";
import { limitsText } from "@/keys/limits.i18n";
import { amount, resetText } from "@/keys/limits";
import { StatusDot, StatusLabel } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { useNow } from "@/useNow";
import type { ProviderView, Throttle } from "@/types";
import { periodText, resumeClock, throttleLabel, type UsageLimit } from "./throttle";
import { throttleText } from "./throttle.i18n";

/**
 * 上游表那一行名字旁边的「限流中 · 42 秒后恢复」「用量已满 · 1 分 10 秒后恢复」「今日用量已满」。
 *
 * **是状态，不是警告**：琥珀色的点和字，和「熔断中」同一个位置，但不进页头的「要处理」，
 * 不弹通知。倒数每秒走一格，到点就消失 —— 不等 core 再报一条；core 先报了「又可以发了」
 * （`throttle_changed`，空）就当场消失。
 *
 * 只给有状态的行挂上它：每秒一次的定时器只在这几行上走。
 */
export function ThrottleTag({ p, throttle }: { p: ProviderView; throttle: Throttle }) {
  const now = useNow(1_000);
  const label = throttleLabel(p, throttle, now);
  if (!label) return null;
  return (
    /*
      **名字不让位**：这一格从零宽起、只占名字和别的标记剩下的地方（`basis-0 flex-1`），放不下
      就截断它自己，名字照常写全。悬停只挂在字上，不挂在占满的那一格上
    */
    <span className="flex min-w-0 flex-1 basis-0">
      <Tip text={<ThrottleTip p={p} throttle={throttle} now={now} />}>
        <span className="inline-flex min-w-0 max-w-full" data-throttle={throttle.kind}>
          {/* 数字等宽：倒数时字不左右晃 */}
          <StatusLabel tone="warn" className="tw-num @max-3xl/page:hidden">
            {label}
          </StatusLabel>
          <StatusDot tone="warn" label={label} className="hidden @max-3xl/page:inline-block" />
        </span>
      </Tip>
    </span>
  );
}

/** 悬停：什么时候恢复发送；用量满了的，下面列出每条上限此刻用了多少 */
function ThrottleTip({ p, throttle, now }: { p: ProviderView; throttle: Throttle; now: number }) {
  const t = useText(throttleText);
  const at = resumeClock(throttle.until_ms, now);
  if (throttle.kind === "rate_limited") return <p>{t.rateLimitedTip(at)}</p>;
  return (
    <div className="flex max-w-80 flex-col gap-2">
      <p>{t.resumesAt(at)}</p>
      <LimitUsage limits={p.limits} now={now} />
    </div>
  );
}

/**
 * 一个上游的每条用量上限此刻用了多少，一条一行：「今天 $1.23 / $5.00 · 00:00 重置」
 * 「最近 5 分钟 12 / 30」。和密钥对话框里用量那一行同一个写法；到了的后面写「已达上限」
 * （悬停是反色的底，不再上琥珀色）。
 * 没有上限的不画。
 */
export function LimitUsage({ limits, now }: { limits: readonly UsageLimit[]; now: number }) {
  const t = useText(throttleText);
  const w = useText(limitsText);
  if (limits.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-medium">{t.limitsTitle}</p>
      {limits.map((l, i) => {
        const resets = l.resets_at_ms != null && l.resets_at_ms > now ? resetText(l.resets_at_ms, now) : null;
        return (
          <p key={i} className="tw-num">
            {periodText(l)} {amount(l.measure, l.used)} / {amount(l.measure, l.max)}
            {resets && ` · ${resets}`}
            {l.reached && ` · ${w.reached}`}
          </p>
        );
      })}
    </div>
  );
}
