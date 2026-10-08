import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { size, tokens as tokenPair } from "@/format";
import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { KeyLabel } from "@/KeyLabel";
import { appLabel, formatLabel, notSentText } from "@/labels";
import { notSent } from "@/requestRouting";
import { ActionBadge, byCodepoints, EventDetail, ruleName, whereOf } from "@/security/labels";
import { pluginName } from "@/plugins/defaults";
import { pluginLabelsText } from "@/plugins/labels.i18n";
import { cpuMs } from "@/plugins/model";
import { OutcomeOf, PluginText } from "@/plugins/parts";
import type { AttemptView, PluginRunView, RequestDetail } from "@/types";
import { Elapsed } from "../cells";
import { CostText, ms, Row, Rows, Stat, type DrawerState } from "./parts";
import { requestDrawerText } from "./RequestDrawer.i18n";

/**
 * 时间线：首 token、总耗时、生成速度、token、费用五个数，一条「等首 token / 生成」的
 * 比例条，下面是这一条的身份和经过（上游、密钥、路径、转换、防护、状态、字节）。
 *
 * **TTFT 放在最显眼的位置。**对 AI 来说它才是体感的一切 —— 一眼看出慢在排队、读输入
 * 还是慢在生成。比例条回答的是同一件事：灰的那段是在等，蓝的那段是在生成。首字节
 * （响应头到的时刻）在下面的明细里：流式响应的响应头一般马上就回，它说的是连没连上。
 *
 * 非流式的没有首 token（整段一起到），也就没有速度和比例条。
 */
export function Timeline({ d, state }: { d: RequestDetail; state: DrawerState }) {
  const t = useText(requestDrawerText);
  const r = d.row;
  const running = state === "in_flight";
  const sent = notSent(r);
  const prompt =
    r.input_tokens != null ? r.input_tokens + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0) : undefined;
  const gen = r.duration_ms != null && r.ttft_ms != null ? r.duration_ms - r.ttft_ms : null;
  return (
    <div>
      <dl className="grid grid-cols-5 overflow-hidden rounded-lg border border-border">
        <Stat label={t.ttft} value={r.ttft_ms != null ? <AnimatedNumber value={r.ttft_ms} format={ms} /> : "—"} muted={r.ttft_ms == null} />
        {/* 还在跑的，总耗时是到现在为止跑了多久，每秒走一格；和流量表那一格同一个写法 */}
        <Stat
          label={t.totalTime}
          value={
            r.duration_ms != null ? (
              <AnimatedNumber value={r.duration_ms} format={ms} />
            ) : running ? (
              <Elapsed at={r.at_ms} />
            ) : (
              "—"
            )
          }
          muted={r.duration_ms == null}
        />
        <Stat
          label={t.speed}
          value={r.tokens_per_sec != null ? t.speedValue(r.tokens_per_sec.toLocaleString()) : "—"}
          muted={r.tokens_per_sec == null}
        />
        <Stat label={t.tokens} value={tokenPair(prompt, r.output_tokens ?? undefined)} muted={prompt == null} />
        <Stat label={t.cost} value={<CostText r={r} running={running} short />} muted={r.cost_micros == null} />
      </dl>
      {r.duration_ms != null && r.ttft_ms != null && r.duration_ms > 0 && gen !== null && (
        <TimingBar ttft={r.ttft_ms} gen={Math.max(0, gen)} />
      )}

      <Rows className="mt-4">
        <Row label={t.generationTime} value={gen !== null ? ms(gen) : running ? t.inProgress : "—"} />
        <Row label={t.ttfb} value={r.ttfb_ms != null ? ms(r.ttfb_ms) : "—"} />
        <Row
          label={t.upstream}
          value={
            r.local ? (
              t.answeredLocally
            ) : sent ? (
              notSentText(sent)
            ) : r.routing?.denied_by ? (
              // 选定上游之后被规则拒绝：这一行记在要去的那个上游上，但没有发给它
              <>
                {r.provider}
                <span className="text-muted-foreground">{t.notSentSuffix}</span>
              </>
            ) : (
              r.provider || "—"
            )
          }
        />
        {/* 密钥是身份；应用是按请求头推测的，能伪造；来源是这条连接对面的
            地址，只有非本机来的才有 */}
        <Row label={t.client} value={<KeyLabel name={r.client} masked={r.key_masked} />} />
        {r.client_hint && (
          <Row
            label={t.app}
            value={
              <>
                {appLabel(r.client_hint)}
                <span className="text-muted-foreground">{t.guessed}</span>
              </>
            }
          />
        )}
        {r.peer && <Row label={t.peer} value={<span className="font-mono">{r.peer}</span>} />}
        <Row label={t.path} value={<span className="font-mono">{r.path}</span>} />
        {/* **转了就要看得见，丢了字段更要看得见** —— 「扩展思考开了却没
            生效」在客户端那头无从查起 */}
        {r.translated && (
          <>
            <Row
              label={t.conversion}
              value={
                // 格式名整体换行，不从单词中间断开
                <>
                  <span className="whitespace-nowrap">{formatLabel(r.translated.from)}</span>
                  {" → "}
                  <span className="whitespace-nowrap">{formatLabel(r.translated.to)}</span>
                </>
              }
            />
            {r.translated.dropped.length > 0 && (
              <Row
                label={t.dropped}
                value={
                  <span className="text-warning">
                    {/* 一个字段整体换行，不从路径中间断开 */}
                    {r.translated.dropped.map((f, i) => (
                      <span key={f}>
                        {i > 0 && t.listSep}
                        <span className="font-mono whitespace-nowrap">{f}</span>
                      </span>
                    ))}
                    <Tip text={t.droppedTip}>
                      <span className="ml-1 whitespace-nowrap underline decoration-dotted underline-offset-2">
                        {t.details}
                      </span>
                    </Tip>
                  </span>
                }
              />
            )}
          </>
        )}
        {/* DeepSeek Harness 每个请求都带着整段对话（单次最多 8 MiB）。**带了就要看得见**：
            它不进模型输入，只有 DeepSeek 收，发给别家之前网关去掉了 */}
        {r.session_log_bytes != null && (
          <Row
            label={t.sessionLog}
            value={
              <>
                <span className="tw-num">{size(r.session_log_bytes)}</span>
                {/* 英文按词换行：这一格为路径设了 break-all */}
                <span className="block break-normal tw-label text-muted-foreground">{t.sessionLogNote}</span>
              </>
            }
          />
        )}
        {/* 这次请求在各项防护上的全部命中：哪条规则、什么值、做了什么 */}
        {r.security && r.security.length > 0 && (
          <Row
            label={t.security}
            value={
              <span className="flex flex-col gap-1">
                {r.security.map((e) => (
                  <span key={e.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span>{ruleName(e.guard, e.rule, e.custom)}</span>
                    {whereOf(e) && <span className="text-muted-foreground">· {whereOf(e)}</span>}
                    <span className="tw-label text-muted-foreground">
                      <EventDetail e={e} codepoints={byCodepoints(e)} />
                    </span>
                    <ActionBadge action={e.action} />
                  </span>
                ))}
              </span>
            }
          />
        )}
        {/* 这次请求上跑过的插件：哪一个、请求还是回答、结果、CPU 时间、出错的原因；试过不止
            一跳的按跳分组 */}
        {d.plugins.length > 0 && (
          <Row label={t.plugins} value={<PluginRuns runs={d.plugins} attempts={r.routing?.attempts ?? []} />} />
        )}
        <Row
          label={t.status}
          value={
            r.error ? (
              <span className="text-destructive">{coreText(r.error)}</span>
            ) : r.cancelled ? (
              // 不是失败，不标红：上游没有出错，是客户端先断开了
              <span>
                {r.status ?? "—"} · {t.cancelled}
              </span>
            ) : running ? (
              // 响应头到了就有状态码，流还在往下走
              r.status != null ? `${r.status} · ${t.inProgress}` : t.inProgress
            ) : (
              (r.status ?? "—")
            )
          }
        />
        <Row label={t.bytes} value={r.bytes?.toLocaleString() ?? "—"} />
      </Rows>
    </div>
  );
}

/**
 * 首 token 和生成的比例。**只画两段，不画刻度**：数字在上面那一排里，这里只要一眼看出
 * 时间花在哪一头。生成那段不到 1% 时也留 2px，免得看起来像没有生成。
 */
function TimingBar({ ttft, gen }: { ttft: number; gen: number }) {
  const t = useText(requestDrawerText);
  const total = Math.max(1, ttft + gen);
  return (
    <div className="mt-3">
      <div
        role="img"
        aria-label={t.timingLabel(ms(ttft), ms(gen))}
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
      >
        <span className="motion-bar rounded-l-full bg-chart-3" style={{ width: `${(ttft / total) * 100}%` }} />
        <span className="motion-bar min-w-0.5 flex-1 rounded-r-full bg-chart-1" />
      </div>
      <div className="mt-1.5 flex items-center gap-4 tw-label text-muted-foreground">
        <Swatch className="bg-chart-3">{t.waiting}</Swatch>
        <Swatch className="bg-chart-1">{t.generating}</Swatch>
      </div>
    </div>
  );
}

function Swatch({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 rounded-[2px]", className)} />
      {children}
    </span>
  );
}

/**
 * 这次请求上每一次插件运行，按运行的顺序。**插件的名字和报错是插件写的**，只按纯文本画
 * （报错是 core 的一句话，按码说，里面嵌着的插件写的字照样只是字）。
 *
 * 请求钩子每发往一个上游跑一次（故障转移换了上游就多一组），回答钩子跑在回答的那一跳上。
 * **试过不止一跳的按跳分组**，组头是第几跳、发往哪个上游，和「路由」页的尝试链对得上。
 */
function PluginRuns({ runs, attempts }: { runs: PluginRunView[]; attempts: AttemptView[] }) {
  const t = useText(requestDrawerText);
  const lt = useText(pluginLabelsText);
  const groups = new Map<number, PluginRunView[]>();
  for (const run of runs) groups.set(run.attempt, [...(groups.get(run.attempt) ?? []), run]);
  const lines = (list: PluginRunView[]) =>
    list.map((run, i) => {
      const cpu = cpuMs(run.cpu_us);
      return (
        <span key={i} className="flex flex-col">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <PluginText text={pluginName(run.plugin_id, run.plugin_name)} />
            <span className="text-muted-foreground">· {lt.hooks[run.hook] ?? run.hook}</span>
            <OutcomeOf outcome={run.outcome} />
            <span className="tw-label tw-num text-muted-foreground">{cpu ? lt.cpu(cpu) : lt.lessThanMs}</span>
          </span>
          {run.error && (
            <span className="tw-label break-words text-destructive">
              <PluginText text={coreText(run.error, run.plugin_id)} />
            </span>
          )}
        </span>
      );
    });
  if (attempts.length <= 1 && groups.size <= 1) return <span className="flex flex-col gap-1">{lines(runs)}</span>;
  return (
    <span className="flex flex-col gap-2">
      {[...groups.entries()]
        .sort(([a], [b]) => a - b)
        .map(([attempt, list]) => (
          <span key={attempt} data-attempt={attempt} className="flex flex-col gap-1">
            <span className="tw-label text-muted-foreground">
              {t.attemptGroup(attempt + 1, attempts[attempt]?.provider ?? null)}
            </span>
            {lines(list)}
          </span>
        ))}
    </span>
  );
}
