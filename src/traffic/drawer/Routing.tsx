import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { ms } from "@/format";
import { IconDenied } from "@/ui/icons";
import { UpstreamLogo } from "@/ui/logos";
import { StatusLabel } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { attemptText, deniedHopText, targetLabel } from "@/labels";
import { routingFacts, skippedHop, type RoutingNote } from "@/requestRouting";
import type { AttemptUsage, HistoryRow, PluginRunView } from "@/types";
import { routingModels, type HopModel } from "../modelVia";
import { useViaConfig } from "../useModelVia";
import { Row, Rows } from "./parts";
import { requestDrawerText } from "./RequestDrawer.i18n";

/**
 * 路由：走的哪条路由、哪条规则决定了去向、经过的策略组、改写了参数的规则、拒绝了它的
 * 规则和理由，然后是尝试链。全是 core 记下的（`RoutingView` 和失败的那一句），排法在
 * `routingFacts`。
 *
 * 别名、指定模型两行和尝试链里每一跳的模型名为什么是那样，是拿记录对着现在的别名表和路由
 * 看出来的（`routingModels`）：对不上就不写那一行，悬停只说发出的是什么。
 */
export function Routing({ r, plugins, running }: { r: HistoryRow; plugins: PluginRunView[]; running: boolean }) {
  const t = useText(requestDrawerText);
  const f = routingFacts(r, running);
  const m = routingModels(r, plugins, useViaConfig());
  // 只有本地应答的没有：它没到规则那一层
  if (!f) return <p className="text-muted-foreground">{t.noRouting}</p>;
  const note = f.note && noteText(f.note, t);
  return (
    <div className="space-y-4">
      {/* **「命中第 4 条」远不如「命中『带缓存的必须走官方』」有用** */}
      <Rows>
        <Row label={t.route} value={f.route} />
        <Row
          label={t.matchedRule}
          value={
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <span>{f.rule}</span>
              {/* 决定去向的这一条就是拒绝：选定上游之前就被拒绝了 */}
              {f.ruleDenied && <Denied>{t.denied}</Denied>}
            </span>
          }
        />
        {f.group && <Row label={t.viaGroup} value={targetLabel(f.group)} />}
        {/* 模型那一列写的是客户端的名称：是别名、或者规则指定了模型，这里说一声 */}
        {m.alias && (
          <Row
            label={t.alias}
            value={
              <span className="inline-flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono">{m.alias}</span>
                <span className="text-muted-foreground">{t.aliasNote}</span>
              </span>
            }
          />
        )}
        {m.pinnedBy && <Row label={t.pinnedModel} value={t.pinnedBy(m.pinnedBy)} />}
        {/* 按求值的顺序：先是选定上游之前的，再是每一跳之后的 */}
        {f.rewrittenBy.length > 0 && <Row label={t.rewrittenBy} value={f.rewrittenBy.join(t.listSep)} />}
        {f.continuity && (
          <Row
            label={t.continuity}
            value={
              <span className="flex flex-col gap-0.5">
                {f.continuity.heldRoute && <span>{t.heldRoute}</span>}
                {f.continuity.stayed === "turn" && <span>{t.stayedTurn}</span>}
                {f.continuity.stayed === "cache" && <span>{t.stayedCache}</span>}
              </span>
            }
          />
        )}
        {f.deniedBy && <Row label={t.deniedBy} value={<Denied>{f.deniedBy}</Denied>} />}
        {f.reason && (
          <Row label={t.reason} value={"text" in f.reason ? f.reason.text : coreText(f.reason.msg)} />
        )}
      </Rows>
      <section>
        <h3 className="mb-2 tw-head text-foreground">{t.attempts}</h3>
        {f.hops.length > 0 && (
          <ol className="overflow-hidden rounded-lg border border-border">
            {f.hops.map(({ attempt: a, denied }, i) => {
              const outcome = attemptText(a);
              // 没有发给这个上游的一跳：被规则拒绝，或者它满着、换了下一家
              const unsent = denied || skippedHop(a);
              return (
                <li key={`${a.provider}-${i}`} className="border-t border-border px-3 py-2 first:border-t-0">
                  <div className="flex items-center gap-3">
                    <span className="w-4 shrink-0 tw-num text-muted-foreground">{i + 1}</span>
                    <span
                      className={cn("flex min-w-0 items-center gap-1.5 font-medium", unsent && "text-muted-foreground")}
                    >
                      <UpstreamLogo name={a.provider} className="opacity-70" />
                      <span className="truncate">{a.provider}</span>
                    </span>
                    {/* 这一跳发出的模型名：有一跳改了名、或者用了别名、指定模型时每一跳都写，
                        费用也按它算 */}
                    {m.show && m.hops[i] && <SentModel hop={m.hops[i]} provider={a.provider} />}
                    {denied ? (
                      // 选定上游之后的规则在这一跳拒绝了它：没有发给这个上游，不是上游的失败
                      <Denied className="min-w-0 flex-1">
                        <span className="truncate">{deniedHopText(f.deniedBy ?? "")}</span>
                      </Denied>
                    ) : (
                      /* **失败的原因要留着** —— 一条说「试过 A → B → C」的链和一条还说清
                         每一跳为什么失败的链，排查价值差得远。短名（无响应超时、并发已满）悬停
                         是 core 的原话 */
                      // 手动中止的那一跳不是故障：灰的，和取消一样
                      <StatusLabel
                        tone={outcome.ok ? "ok" : outcome.idle ? "idle" : "warn"}
                        muted={outcome.ok || outcome.idle}
                        className="min-w-0 flex-1"
                      >
                        {outcome.tip ? (
                          <Tip text={outcome.tip}>
                            <span className="underline decoration-dotted underline-offset-2">{outcome.text}</span>
                          </Tip>
                        ) : (
                          outcome.text
                        )}
                      </StatusLabel>
                    )}
                    {/* 等空位的时间不算在这一跳的耗时里，另写一项 */}
                    {a.queued_ms != null && a.queued_ms > 0 && (
                      <span className="shrink-0 tw-label tw-num text-muted-foreground">
                        {t.queued(seconds(a.queued_ms))}
                      </span>
                    )}
                    {/* 没有发出的那一跳没有耗时可言 */}
                    <span className="shrink-0 tw-num text-muted-foreground">{unsent ? "—" : ms(a.ms)}</span>
                  </div>
                  {/* 放弃了的这一跳（无响应超时）上游可能已经按输入收了钱：不在这个请求的费用里 */}
                  {a.usage && <AbandonedUsage usage={a.usage} />}
                </li>
              );
            })}
          </ol>
        )}
        {/*
          **用户能看见故障转移在替他工作，这是信任的来源**。一个静默切换过的请求和一次就成
          的请求，在他眼里应该是不同的。尝试链是空的时候，这一句说为什么是空的
        */}
        {note && <p className={cn("text-muted-foreground", f.hops.length > 0 && "mt-2")}>{note}</p>}
      </section>
    </div>
  );
}

/**
 * 放弃了的一跳（无响应超时）上游可能已经收了钱的输入，写在那一跳下面一行。上游在流开头
 * 报了的写它报的几种 token；没报的是网关估的输入，写「约」。**输出不知道**，不写。
 *
 * 这部分不进这个请求的费用：上游收没收、收了多少，网关看不到。悬停说这一点
 */
function AbandonedUsage({ usage: u }: { usage: AttemptUsage }) {
  const t = useText(requestDrawerText);
  const parts = u.estimated
    ? [t.abandonedEstimate(u.input.toLocaleString())]
    : [
        `${t.input} ${u.input.toLocaleString()}`,
        ...(u.cache_read > 0 ? [`${t.cacheReads} ${u.cache_read.toLocaleString()}`] : []),
        ...(u.cache_write > 0 ? [`${t.cacheWrites} ${u.cache_write.toLocaleString()}`] : []),
      ];
  return (
    // 和上游名对齐：序号那一格 16px 加间距 12px
    <p className="mt-0.5 pl-7 tw-label text-muted-foreground">
      {parts.join(" · ")} ·{" "}
      <Tip text={t.mayBeBilledTip}>
        <span className="underline decoration-dotted underline-offset-2">{t.mayBeBilled}</span>
      </Tip>
    </p>
  );
}

/** 排队等了多久：不到 10 秒的留一位小数，最少写 0.1 */
function seconds(ms: number): string {
  const s = ms / 1000;
  return String(s < 10 ? Math.max(0.1, Math.round(s * 10) / 10) : Math.round(s));
}

/**
 * 尝试链里一跳发出的模型名。和客户端写的不同时带虚线下划线，悬停按原因说（别名、规则改名、
 * 指定模型、插件）；原因对不上现在的配置时只说发出的是什么。
 */
function SentModel({ hop, provider }: { hop: HopModel; provider: string }) {
  const t = useText(requestDrawerText);
  const cls = "min-w-0 max-w-[40%] shrink truncate font-mono tw-label text-muted-foreground";
  if (!hop.changed) return <span className={cls}>{hop.sent}</span>;
  const tip =
    hop.via === "alias"
      ? t.sentByAlias(provider, hop.sent)
      : hop.via === "pinned"
        ? t.sentPinned(provider, hop.sent)
        : hop.via === "rule"
          ? t.sentModel(hop.sent)
          : hop.via === "plugin"
            ? t.sentByPlugin(hop.sent)
            : t.sentOther(hop.sent);
  return (
    <Tip text={tip}>
      <span className={cn(cls, "underline decoration-dotted underline-offset-2")}>{hop.sent}</span>
    </Tip>
  );
}

/** 拒绝：禁止符号加字，红色。和路由图上「拒绝」那个节点同一个图形 */
function Denied({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-destructive", className)}>
      <IconDenied aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** 尝试链下面那一句（见 `RoutingNote`）。只说字面上成立的事：被拒绝的那一跳不算切换成功 */
function noteText(n: RoutingNote, t: (typeof requestDrawerText)["zh"]): string {
  switch (n.kind) {
    case "failover":
      return t.failover(n.failed);
    case "switched":
      return t.switched(n.count);
    case "limited":
      return t.limited;
    case "busy":
      return n.tried > 0 ? t.busyAfterTries(n.tried) : t.busy;
    case "failover_denied":
      return t.failoverDenied(n.failed, n.rule);
    case "denied_after_pick":
      return t.deniedAfterPick(n.rule);
    case "denied_before_pick":
      return t.deniedBeforePick(n.rule);
    case "unavailable":
      return t.unavailable;
    case "pending":
      return t.routingPending;
    case "none":
      return t.noAttempts;
  }
}
