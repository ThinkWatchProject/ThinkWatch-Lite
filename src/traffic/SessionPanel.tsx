import { useText } from "@/i18n";
import { usd, type SessionDetail, type TurnView } from "@/types";
import { sessionsText } from "@/Sessions.i18n";
import { dur, tokens, when } from "./format";

/**
 * 一次会话，在右侧分栏里。
 *
 * **原来它是个模态框。**请求详情走分栏、会话详情走模态框，同一页上两套
 * 范式 —— 学会一个不会用另一个。而模态框还挡住了它下面那张表，于是
 * 「这次任务的第 12 轮」和「表里那一行」没法对着看。
 */
export function SessionPanel({
  d,
  onOpenTurn,
}: {
  d: SessionDetail;
  /** 点瀑布图里的一轮 —— 那一轮就是一条请求，`TurnView.id` 就是它的 id */
  onOpenTurn: (id: number) => void;
}) {
  const t = useText(sessionsText);
  const { session: s, turns } = d;
  return (
    <div className="p-4">
      <div className="tw-head font-medium">
        {t.detailTitle(when(s.started_ms), s.turns, dur(s.ended_ms - s.started_ms))}
      </div>
      <div className="mt-1 tw-body text-muted-foreground">
        {t.detailUsage(
          s.models.join(t.modelSep),
          tokens(s.input_tokens),
          tokens(s.output_tokens),
          tokens(s.cache_read_tokens),
        )}
      </div>

      <Growth turns={turns} />
      <Waterfall turns={turns} onOpen={onOpenTurn} />
    </div>
  );
}

/**
 * 上下文增长曲线。**一眼看出哪次任务的上下文失控了**。
 *
 * 用条形而不是折线：轮次是离散的，而「第 12 轮突然翻倍」正是要找的
 * 那个东西 —— 折线会把那一跳平滑掉一部分。
 */
function Growth({ turns }: { turns: TurnView[] }) {
  const text = useText(sessionsText);
  const max = Math.max(1, ...turns.map((t) => t.input_tokens ?? 0));
  return (
    <section className="mt-4">
      <div className="tw-body text-muted-foreground">{text.growthTitle}</div>
      <div className="mt-1 flex h-16 items-end gap-px">
        {turns.map((t) => {
          const v = t.input_tokens ?? 0;
          const cached = t.cache_read_tokens ?? 0;
          return (
            <div
              key={t.id}
              className="flex-1 bg-neutral-200 dark:bg-neutral-700"
              style={{ height: `${Math.max(2, (v / max) * 100)}%` }}
              title={text.growthBar(tokens(v), v, cached > 0 ? tokens(cached) : null)}
            >
              {/* 缓存命中的那一段单独染色 —— 看出哪一轮打断了缓存 */}
              <div
                className="w-full bg-emerald-400 dark:bg-emerald-600"
                style={{ height: `${v > 0 ? (cached / v) * 100 : 0}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 tw-label text-neutral-400">{text.growthLegend(tokens(max))}</div>
    </section>
  );
}

/** 每轮的成本瀑布 —— 找出那个 8 万 token 的文件读取。 */
function Waterfall({
  turns,
  onOpen,
}: {
  turns: TurnView[];
  onOpen: (id: number) => void;
}) {
  const text = useText(sessionsText);
  const max = Math.max(1, ...turns.map((t) => t.cost_micros ?? 0));
  return (
    <section className="mt-4">
      <div className="tw-body text-muted-foreground">{text.waterfallTitle}</div>
      <ul className="mt-1 space-y-0.5">
        {turns.map((t, i) => (
          /*
            **一轮就是一条请求。**`TurnView.id` 就是请求 id —— 从「这次
            任务第 12 轮特别贵」走到「那一条请求到底发了什么」，原来这
            条路是断的：瀑布图点不动，而请求表也不说自己属于哪次任务。
          */
          <li
            key={t.id}
            onClick={() => onOpen(t.id)}
            className="flex cursor-pointer items-center gap-2 rounded tw-label hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="w-6 text-right text-neutral-400">{i + 1}</span>
            <span className="w-14 text-muted-foreground">{t.model.replace(/^claude-/, "")}</span>
            <span className="h-2 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
              <span
                className="block h-2 rounded bg-neutral-400 dark:bg-neutral-500"
                style={{ width: `${((t.cost_micros ?? 0) / max) * 100}%` }}
              />
            </span>
            <span className="w-16 text-right">
              {/* **没有价格就说没有价格，不写 $0** */}
              {t.cost_micros == null ? (
                <span className="text-neutral-400">{text.unpriced}</span>
              ) : (
                // 估算的金额要带记号：取消、断在中间的那几轮输出只计到断开时
                (t.cost_estimated ? "~" : "") + usd(t.cost_micros)
              )}
            </span>
            {t.error && <span className="text-red-600 dark:text-red-400">{text.turnFailed}</span>}
            {t.cancelled && <span className="text-neutral-400">{text.turnCancelled}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

