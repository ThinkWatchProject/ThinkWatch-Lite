import { useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { prettyJson } from "@/prettyJson";
import { clip } from "@/traffic/transcript";
import type { HitLocation, OutcomeDetail, SecurityEventView, SecurityOutcome } from "@/types";
import { Highlight, type Mark } from "./Highlight";
import { Code, matchingOf, partLabel, snapshotName } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { hitDetailText } from "./HitDetail.i18n";

/** 一开始列几处。其余的「展开全部」 */
const FIRST = 3;
/** 切断的工具调用的参数：先显示这么多 */
const ARGS = { chars: 800, lines: 14 };
/** 客户端收到的提示、回复：先显示这么多 */
const NOTICE = { chars: 400, lines: 6 };

/** 命中那一段的底色，和规则测试里标出来的同一套：会被切断、拒绝的红，会被删除的划掉，其余琥珀 */
function toneOf(action: SecurityOutcome): Mark["tone"] {
  return action === "cut" || action === "blocked" ? "bad" : action === "stripped" ? "strip" : "warn";
}

/** 详情里的链接：和正文同色，下划线淡一档 */
const LINK =
  "h-auto p-0 font-normal text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground [font-size:inherit]";

/**
 * 一次命中的详情：命中的每一处（在哪一段、JSON 路径、前后文，命中的那一段标出来）、
 * 命中那一刻的规则、具体做了什么，以及这次请求和它的会话。
 *
 * 安全日志里点开一行、请求详情「时间线」里点开一条防护记录，都是这一块。日志里横向
 * 宽，标签在左；请求详情的那一栏窄，`stacked` 时标签在上。
 *
 * **全部内容都是 core 脱敏过的**：前后文和存下来的报文用同一套脱敏，出站脱敏的命中
 * 是掩码后的值。这里原样显示，不再处理。
 *
 * `onOpenRequest` 不给就不画「请求」一行（请求详情里就是这一条请求）；会话那一行
 * 只在这次请求属于某次会话、`onOpenSession` 给了时才有。
 */
export function HitDetail({
  e,
  stacked = false,
  onOpenRequest,
  onOpenSession,
  className,
  id,
}: {
  e: SecurityEventView;
  stacked?: boolean;
  onOpenRequest?: (requestId: number) => void;
  onOpenSession?: (session: string) => void;
  className?: string;
  id?: string;
}) {
  const t = useText(hitDetailText);
  const lt = useText(securityLabelsText);
  const where = lt.directions[e.direction];
  const n = e.locations.length + e.more_locations;
  const sentModel = e.sent_model && e.sent_model !== e.model ? e.sent_model : null;
  return (
    <dl
      id={id}
      className={cn(
        stacked ? "flex flex-col gap-3" : "grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-5 gap-y-3",
        className,
      )}
    >
      {n > 0 && (
        <Field label={t.locations} stacked={stacked}>
          <p className="text-muted-foreground">{t.total(where, n)}</p>
          <Locations locations={e.locations} more={e.more_locations} tone={toneOf(e.action)} />
        </Field>
      )}
      <Field label={t.rule} stacked={stacked}>
        <RuleText e={e} />
      </Field>
      <Field label={t.outcome} stacked={stacked}>
        <OutcomeText d={e.outcome_detail} direction={e.direction} />
      </Field>
      {onOpenRequest && (
        <Field label={t.request} stacked={stacked}>
          <span className="flex flex-wrap items-baseline gap-x-1.5">
            <Button
              variant="link"
              className={cn(LINK, "tw-num")}
              aria-label={t.openRequest(e.request_id)}
              onClick={() => onOpenRequest(e.request_id)}
            >
              #{e.request_id}
            </Button>
            {sentModel && <span className="min-w-0 break-all text-muted-foreground">· {t.sentModel(sentModel)}</span>}
          </span>
        </Field>
      )}
      {e.session && onOpenSession && (
        <Field label={t.session} stacked={stacked}>
          {/* 包一层：这一格是纵向的 flex，直接放按钮会被拉满一行、字居中 */}
          <span>
            <Button variant="link" className={LINK} onClick={() => onOpenSession(e.session!)}>
              {t.openSession}
            </Button>
          </span>
        </Field>
      )}
    </dl>
  );
}

/** 一行「标签：内容」。`stacked` 时标签在上 */
function Field({ label, stacked, children }: { label: string; stacked: boolean; children: ReactNode }) {
  if (stacked)
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <dt className="tw-label text-muted-foreground">{label}</dt>
        <dd className="flex min-w-0 flex-col gap-1.5">{children}</dd>
      </div>
    );
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5">{children}</dd>
    </>
  );
}

/**
 * 命中的每一处。先列前三处，其余的「展开全部」；core 只给前 50 处，超出的写一句还有几处。
 */
function Locations({ locations, more, tone }: { locations: HitLocation[]; more: number; tone: Mark["tone"] }) {
  const t = useText(hitDetailText);
  const [all, setAll] = useState(false);
  const shown = all ? locations : locations.slice(0, FIRST);
  return (
    <>
      {shown.length > 0 && (
        <ol className="flex flex-col gap-2">
          {shown.map((l, i) => (
            // 同一段里的几处连在一起时，哪一段、路径只写一次
            <Location key={i} l={l} tone={tone} head={i === 0 || shown[i - 1]?.path !== l.path} />
          ))}
        </ol>
      )}
      {(locations.length > FIRST || more > 0) && (
        <div className="flex flex-wrap items-center gap-x-3">
          {locations.length > FIRST && (
            <Button
              variant="ghost"
              size="xs"
              className="-ml-2 text-muted-foreground"
              aria-expanded={all}
              onClick={() => setAll((a) => !a)}
            >
              {all ? t.collapse : t.showAll(locations.length)}
            </Button>
          )}
          {more > 0 && <span className="tw-label text-muted-foreground">{t.more(more)}</span>}
        </div>
      )}
    </>
  );
}

/** 一处：哪一段、JSON 路径（`head`），下面是前后文，命中的那一段标出来 */
function Location({ l, tone, head }: { l: HitLocation; tone: Mark["tone"]; head: boolean }) {
  const text = l.before + l.matched + l.after;
  const marks = useMemo<Mark[]>(
    () => [{ start: l.before.length, end: l.before.length + l.matched.length, tone }],
    [l.before.length, l.matched.length, tone],
  );
  return (
    <li className={cn("flex min-w-0 flex-col gap-1", !head && "-mt-1")}>
      {head && (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 tw-label">
          <span className="font-medium text-foreground/80">{partLabel(l)}</span>
          <span className="min-w-0 font-mono break-all text-muted-foreground">{l.path}</span>
        </div>
      )}
      <div className="rounded-md border border-border bg-background px-2.5 py-1.5">
        <Highlight text={text} marks={marks} small />
      </div>
    </li>
  );
}

/**
 * 命中那一刻的规则。自定义规则写出原样的写法和匹配方式；内置规则写名字和定义它的那一版
 * core —— 内置规则随版本变，同名的规则换了版本可能认得不一样。
 */
function RuleText({ e }: { e: SecurityEventView }) {
  const t = useText(hitDetailText);
  const lt = useText(securityLabelsText);
  const s = e.rule_snapshot;
  const mode = matchingOf(e);
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="font-medium">{snapshotName(e)}</span>
        {s.builtin ? (
          <span className="text-muted-foreground">· {t.builtinOf(s.core_version)}</span>
        ) : (
          <>
            <Badge variant="outline">{lt.custom}</Badge>
            {mode && <span className="text-muted-foreground">· {lt.matching[mode]}</span>}
          </>
        )}
      </span>
      {!s.builtin && s.pattern != null && <MonoBox text={s.pattern} />}
    </>
  );
}

/** 具体做了什么 */
function OutcomeText({ d, direction }: { d: OutcomeDetail; direction: SecurityEventView["direction"] }) {
  const t = useText(hitDetailText);
  switch (d.action) {
    case "recorded":
      return <span className="text-muted-foreground">{t.recorded[direction]}</span>;
    case "replaced":
      return (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-muted-foreground">{t.replacedWith}</span>
          {d.placeholders.map((p) => (
            <Code key={p}>{p}</Code>
          ))}
        </span>
      );
    case "cut":
      return (
        <>
          <span className="text-muted-foreground">{t.cutCall(d.tool)}</span>
          <Folded text={prettyJson(d.arguments, d.truncated) ?? d.arguments} limit={ARGS} />
          {d.truncated && <span className="tw-label text-muted-foreground">{t.truncated}</span>}
          <span className="mt-1 tw-label text-muted-foreground">{t.clientNotice}</span>
          <Folded text={d.client_notice} limit={NOTICE} prose />
        </>
      );
    case "blocked":
      return (
        <>
          <span className="text-muted-foreground">{t.notSent}</span>
          <span className="mt-1 tw-label text-muted-foreground">{t.clientReply}</span>
          <Folded text={d.client_notice} limit={NOTICE} prose />
        </>
      );
    case "stripped":
      return <span className="text-muted-foreground">{t.stripped(d.segments)}</span>;
  }
}

/** 等宽的一框：原样的空白和换行，长的折行 */
function MonoBox({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        "rounded-md border border-border bg-background px-2.5 py-1.5 font-mono tw-label leading-relaxed break-all whitespace-pre-wrap text-foreground",
        className,
      )}
    >
      {text}
    </pre>
  );
}

/**
 * 可能很长的一段：先显示开头，「展开全部」看整段。`prose` 是一句话（客户端收到的提示），
 * 用正文字体；否则是等宽的参数。
 */
function Folded({ text, limit, prose = false }: { text: string; limit: { chars: number; lines: number }; prose?: boolean }) {
  const t = useText(hitDetailText);
  const [all, setAll] = useState(false);
  const head = useMemo(() => clip(text, limit), [text, limit]);
  const cut = head !== null && !all;
  const shown = cut ? `${head}\n…` : text;
  return (
    <div className="flex min-w-0 flex-col items-start gap-0.5">
      {prose ? (
        <p className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 break-words whitespace-pre-wrap">
          {shown}
        </p>
      ) : (
        <MonoBox text={shown} className="w-full" />
      )}
      {head !== null && (
        <Button
          variant="ghost"
          size="xs"
          className="-ml-2 text-muted-foreground"
          aria-expanded={all}
          onClick={() => setAll((a) => !a)}
        >
          {all ? t.collapse : t.showAllText}
        </Button>
      )}
    </div>
  );
}
