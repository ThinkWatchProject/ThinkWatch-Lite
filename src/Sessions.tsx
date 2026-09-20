import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import { usd, type SessionDetail, type SessionView, type TurnView } from "./types";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { toast } from "sonner";
import { useCoreEvent } from "./useCoreEvent";
import { textOf, useText } from "@/i18n";
import { sessionsText } from "./Sessions.i18n";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";

/**
 * 会话页。
 *
 * **孤立地看单个请求，看不出任何有用的东西。**Claude Code 的一次任务是
 * 几十到上百个请求，携带不断增长的上下文。这一页要能回答的是
 * 「我那次重构花了多少、为什么」，而不是「第 47 个请求耗时多少毫秒」。
 *
 * 成本仍然是三态的：没有价格的轮次单独报数，**不当成 0 加进
 * 总额**。一个会撒谎的成本面板不如没有。
 */
export default function Sessions() {
  const t = useText(sessionsText);
  const [rows, setRows] = useState<SessionView[] | null>(null);
  const [open, setOpen] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await invoke<SessionView[]>("sessions"));
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(typeof e === "string" ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 会话是把存下来的请求聚起来算的，**只在有请求落地之后才会变** ——
  // 原来每 10 秒重算一遍，空闲时每一遍都算出同一个答案。
  useCoreEvent(["request_finished", "request_failed", "request_cancelled"], () => void load());

  if (!rows) return <div className="p-5 tw-head text-muted-foreground">{error ?? t.loading}</div>;

  if (rows.length === 0) {
    // 空状态永远在回答「接下来该做什么」
    return (
      <div className="p-5">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t.emptyTitle}</EmptyTitle>
            <EmptyDescription>{t.emptyBody}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="p-5">
            <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-normal">{t.started}</TableHead>
            <TableHead className="font-normal">{t.client}</TableHead>
            <TableHead className="text-right font-normal">{t.turns}</TableHead>
            <TableHead className="text-right font-normal">{t.duration}</TableHead>
            <TableHead className="text-right font-normal">{t.peakContext}</TableHead>
            <TableHead className="text-right font-normal">{t.cacheSavings}</TableHead>
            <TableHead className="text-right font-normal">{t.cost}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow
              key={s.id} className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900"
              onClick={async () => {
                try {
                  setOpen(await invoke<SessionDetail>("session_detail", { id: s.id }));
                } catch (e) {
                  toast.error(typeof e === "string" ? e : String(e));
                }
              }}
            >
              <TableCell>{when(s.started_ms)}</TableCell>
              <TableCell>{s.client}</TableCell>
              <TableCell className="text-right">
                {/* 轮次和失败数之间要有间隔 —— 挨着写会读成「181 失败」 */}
                <span>{s.turns}</span>
                {s.errors > 0 && (
                  <span className="ml-2 text-red-600 dark:text-red-400">{t.failedTurns(s.errors)}</span>
                )}
              </TableCell>
              <TableCell className="text-right">{dur(s.ended_ms - s.started_ms)}</TableCell>
              <TableCell className="text-right">{tokens(s.peak_input_tokens)}</TableCell>
              <TableCell className="text-right text-emerald-700 dark:text-emerald-400">
                {s.cache_saved_micros > 0 ? usd(s.cache_saved_micros) : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Cost s={s} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {open && <Detail d={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * 一次会话的花费。
 *
 * **三态**：有价格的加起来，没价格的单独说，一轮都没有价格时
 * 不显示 $0 —— 那是在撒谎。
 *
 * 订阅制上游服务的轮次**不在这三态里**：它们计入订阅额度，不按用量产生
 * 费用，既不加进合计，也不是「无法计价」。概览上同一批请求写的是「订阅额度
 * N 次」，这里用同一个说法。
 */
function Cost({ s }: { s: SessionView }) {
  const t = useText(sessionsText);
  const subscription = s.subscription_turns > 0 && (
    <Tip text={t.subscriptionTip}>
      <span className="text-muted-foreground">{t.subscriptionTurns(s.subscription_turns)}</span>
    </Tip>
  );
  if (s.priced_turns === 0) {
    // 全走订阅的会话没有金额可写，但也没有缺什么
    if (subscription && s.unpriced_turns === 0 && s.no_usage_turns === 0) return subscription;
    return (
      <>
        <Tip text={t.noPricedTurnsTip}><span className="text-muted-foreground">{t.unpriced}</span></Tip>
        {subscription && <Also>{subscription}</Also>}
      </>
    );
  }
  return (
    <>
      {s.cost_micros_estimated > 0 ? (
        // **估算不能冒充实测**：合计里有估算的部分，就要带着记号
        <Tip text={t.estimatedTip(usd(s.cost_micros_estimated))}>
          <span className="underline decoration-dotted underline-offset-2">~{usd(s.cost_micros)}</span>
        </Tip>
      ) : (
        usd(s.cost_micros)
      )}
      {s.unpriced_turns > 0 && (
        <Tip text={t.unpricedTurnsTip}>
          <span className="ml-1 text-muted-foreground">{t.unpricedTurns(s.unpriced_turns)}</span>
        </Tip>
      )}
      {s.no_usage_turns > 0 && (
        <Tip text={t.noUsageTurnsTip}>
          <span className="ml-1 text-muted-foreground">{t.noUsageTurns(s.no_usage_turns)}</span>
        </Tip>
      )}
      {subscription && <Also>{subscription}</Also>}
    </>
  );
}

/**
 * 订阅额度跟在金额后面时用「·」隔开，不用「+」：「+N 轮无法计价」说的是
 * 合计之外还有没算进来的费用，订阅那几轮没有这样的费用。
 */
function Also({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="mx-1 text-muted-foreground">·</span>
      {children}
    </>
  );
}

function when(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function dur(ms: number) {
  // 取文案要在调用的那一刻，不能提到模块级 —— 换了语言它不会跟着换
  const t = textOf(sessionsText);
  if (ms < 60_000) return t.seconds(Math.round(ms / 1000));
  if (ms < 3_600_000) return t.minutes(Math.round(ms / 60_000));
  return t.hours((ms / 3_600_000).toFixed(1));
}

function tokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

/** 一次会话的细节：上下文增长曲线 + 每轮的成本瀑布。 */
function Detail({ d, onClose }: { d: SessionDetail; onClose: () => void }) {
  const t = useText(sessionsText);
  const { session: s, turns } = d;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t.detailTitle(when(s.started_ms), s.turns, dur(s.ended_ms - s.started_ms))}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-1 tw-body text-muted-foreground">
          {t.detailUsage(
            s.models.join(t.modelSep),
            tokens(s.input_tokens),
            tokens(s.output_tokens),
            tokens(s.cache_read_tokens),
          )}
        </div>

        <Growth turns={turns} />
        <Waterfall turns={turns} />
      </DialogContent>
    </Dialog>
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
function Waterfall({ turns }: { turns: TurnView[] }) {
  const text = useText(sessionsText);
  const max = Math.max(1, ...turns.map((t) => t.cost_micros ?? 0));
  return (
    <section className="mt-4">
      <div className="tw-body text-muted-foreground">{text.waterfallTitle}</div>
      <ul className="mt-1 space-y-0.5">
        {turns.map((t, i) => (
          <li key={t.id} className="flex items-center gap-2 tw-label">
            <span className="w-6 text-right text-neutral-400">{i + 1}</span>
            <span className="w-14 text-muted-foreground">{t.model.replace(/^claude-/, "")}</span>
            <span className="h-2 flex-1 rounded bg-neutral-100 dark:bg-neutral-800">
              <span
                className="block h-2 rounded bg-neutral-400 dark:bg-neutral-500"
                style={{ width: `${((t.cost_micros ?? 0) / max) * 100}%` }}
              />
            </span>
            <span className="w-16 text-right">
              {/* **没有价格就说没有价格，不写 $0**；订阅那一轮也没有金额，但它不是没有价格 */}
              {t.billing === "subscription" ? (
                <span className="text-neutral-400">{text.turnSubscription}</span>
              ) : t.cost_micros == null ? (
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
