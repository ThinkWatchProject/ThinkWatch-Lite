import { useMemo, useState, type ReactNode } from "react";
import { call } from "@/control";
import { textOf, useText } from "@/i18n";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Collapsible, CollapsibleTrigger } from "@/ui/collapsible";
import { Segmented } from "@/ui/segmented";
import { Tip } from "@/ui/tip";
import { useNow } from "@/useNow";
import { prettyJson } from "@/prettyJson";
import { SourceDiff } from "@/plugins/parts";
import type { BodyView, RequestDetail } from "@/types";
import { missingWhy } from "../transcript";
import { requestDrawerText } from "./RequestDrawer.i18n";

/** 保留期限按天算，判断正文为什么不在用的时刻一小时更新一次就够 */
const HOUR_MS = 3_600_000;

/**
 * 正文不在时「说明」里那一句。
 *
 * 早于报文的保留期限（`retention.body_days`）的，说已超过保留期限；期限之内也没有的不说
 * 原因，只说未保留 —— WebSocket、本地应答的请求从来不存正文，总量超了从最早的一天删起，
 * 写盘跟不上时 core 宁可丢下。期限不知道（概览没取到）时也不说过了期限。和对话那一页
 * 同一个判断（`missingWhy`）。
 */
export function notSavedTip(at: number, bodyDays: number | null, now: number, which: "request" | "response"): string {
  const t = textOf(requestDrawerText);
  if (missingWhy(at, bodyDays, now) === "expired") return t.pastRetentionTip;
  return which === "request" ? t.requestNotKeptTip : t.responseNotKeptTip;
}

/** 正文不在：「未保存」，悬停说为什么（`notSavedTip`）。报文留几天看概览，和「重放」同一份 */
function NotSaved({ which, at }: { which: "request" | "response"; at: number }) {
  const t = useText(requestDrawerText);
  const ov = useResource("overview", () => call("Overview", null), { events: ["config_reloaded"] });
  const now = useNow(HOUR_MS);
  return (
    <p className="mt-1 text-muted-foreground">
      {t.notSaved}
      <Tip text={notSavedTip(at, ov.data?.retention.body_days ?? null, now, which)}>
        <span className="ml-1 underline decoration-dotted underline-offset-2">{t.details}</span>
      </Tip>
    </p>
  );
}

/**
 * 请求那一段。**插件改写过的请求有两份**：客户端发来的原样，和插件改写之后的
 * （`request_after_plugins`，同样替换过密钥）。默认看对比 —— 点开一条带「插件」标记的
 * 请求，要知道的就是它改了哪里；两份全文也都看得到。
 *
 * 改写后的那一份是**最后一跳发出去的**：故障转移过的写明是第几跳、发往哪儿。回答的那一跳
 * 收到的就是原样时（插件只改了先前那一跳）没有它，只看原样 —— 流量表上的标记照样在。
 */
export function RequestBody({ d }: { d: RequestDetail }) {
  const t = useText(requestDrawerText);
  const after = d.request_after_plugins;
  const original = d.request_body;
  const hops = d.row.routing?.attempts ?? [];
  const sentBy = hops.length > 1 ? t.afterPluginsSentBy(hops.length, hops[hops.length - 1]!.provider) : null;
  // 原始的那份过了保留期就没得比：直接看改写后的
  const [view, setView] = useState<"compare" | "original" | "after">(original ? "compare" : "after");
  const pretty = useMemo(
    () =>
      after && original
        ? {
            before: prettyJson(original.text, original.truncated) ?? original.text,
            after: prettyJson(after.text, after.truncated) ?? after.text,
          }
        : null,
    [after, original],
  );
  if (!after) return <Body b={original} title={t.request} which="request" at={d.row.at_ms} />;
  const switcher = (
    <Segmented<"compare" | "original" | "after">
      label={t.request}
      value={view}
      options={[
        { id: "compare", label: t.payloadViews.compare, disabled: !original },
        { id: "original", label: t.payloadViews.original },
        { id: "after", label: t.payloadViews.after },
      ]}
      onChange={setView}
    />
  );
  if (view === "compare" && pretty) {
    return (
      <section>
        <div className="flex items-center gap-2">
          <h3 className="tw-head text-foreground">{t.request}</h3>
          <span className="ml-auto">{switcher}</span>
        </div>
        {sentBy && <p className="mt-1 tw-label text-muted-foreground">{sentBy}</p>}
        <SourceDiff before={pretty.before} after={pretty.after} className="mt-2" />
      </section>
    );
  }
  return (
    <Body
      b={view === "after" ? after : original}
      title={t.request}
      which="request"
      at={d.row.at_ms}
      extra={switcher}
      note={view === "after" ? sentBy : null}
    />
  );
}

/**
 * 一段 body。
 *
 * **长的默认折叠。**Claude Code 的 system prompt 有几千 token，展开会淹没一切 ——
 * 而点开这个浮层是为了看**这一次**发生了什么。
 */
export function Body({
  b,
  title,
  which,
  at,
  pending = false,
  extra,
  note,
}: {
  b: BodyView | null;
  title: string;
  which: "request" | "response";
  /** 这条请求开始的时刻：正文不在时，按它说是不是过了保留期限 */
  at: number;
  /** 请求还在跑：没有它是因为还没到，不是过了保留期 */
  pending?: boolean;
  /** 标题行右端的东西（插件改写过的请求：看哪一份） */
  extra?: ReactNode;
  /** 标题下的一句（插件改写后的那一份是哪一跳发出的） */
  note?: ReactNode;
}) {
  const t = useText(requestDrawerText);
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => (b ? prettyJson(b.text, b.truncated) : null), [b]);
  if (!b) {
    return (
      <section>
        <div className="flex items-center gap-2">
          <h3 className="tw-head text-foreground">{title}</h3>
          {extra && <span className="ml-auto">{extra}</span>}
        </div>
        {pending ? <p className="mt-1 text-muted-foreground">{t.afterEnd}</p> : <NotSaved which={which} at={at} />}
      </section>
    );
  }
  // 折不折按原文算：排版加进来的空白不算内容
  const big = b.text.length > 2000;
  const text = pretty ?? b.text;
  const shown = open || !big ? text : text.slice(0, 2000);
  /*
    **`Collapsible` 而不是 `Accordion`。**请求和响应两段是各自独立的，要能同时展开
    对着看；Accordion 是「一组里只开一个」，那正好是这里不想要的行为。
  */
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <h3 className="tw-head text-foreground">{title}</h3>
        <span className="tw-label tw-num text-muted-foreground">
          {t.size(b.original_len)}
          {/* **截断了要说出来。**不说的话用户会以为请求本身就这么长 */}
          {b.truncated && ` · ${t.truncated}`}
        </span>
        {big && (
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className={cn("text-muted-foreground", !extra && "ml-auto")}>
              {open ? t.collapse : t.showAll}
            </Button>
          </CollapsibleTrigger>
        )}
        {extra && <span className={cn(!big && "ml-auto")}>{extra}</span>}
      </div>
      {note && <p className="mt-1 tw-label text-muted-foreground">{note}</p>}
      <BodyText
        text={shown}
        json={pretty != null}
        more={big && !open}
        className="mt-2 max-h-80 rounded-lg border border-border bg-surface px-3 py-2.5"
      />
    </Collapsible>
  );
}

/**
 * 一段等宽的 body 正文。JSON 在 `prettyJson` 里排好，这里管折行。
 *
 * **折行对齐到本行的缩进。**长字符串（system prompt、工具说明）一折行就回到最左边，
 * 缩进表达的层级就被冲散了。所以一行一个块，用 padding 加负的 text-indent 做悬挂
 * 缩进 —— 行首的空格还是文字，复制出去缩进不丢。
 *
 * **JSON 按词折，原文见字就断。**SSE 那种 `data: {…}` 按词折会在冒号后面断开，
 * 第一行只剩一个 `data:`。
 *
 * 会话的「对话」那一页也用它画工具的参数和结果，两处的等宽正文是同一个样子。
 */
export function BodyText({
  text,
  json,
  more = false,
  className,
}: {
  text: string;
  json: boolean;
  /** 折叠着，后面还有 */
  more?: boolean;
  className?: string;
}) {
  const lines = useMemo(() => text.split("\n"), [text]);
  return (
    <pre
      className={cn(
        "overflow-auto font-mono tw-label leading-relaxed whitespace-pre-wrap text-foreground",
        json ? "wrap-anywhere" : "break-all",
        className,
      )}
    >
      {lines.map((line, i) => {
        const indent = Math.max(0, line.search(/[^ ]/));
        return (
          <span
            key={i}
            className="block"
            style={indent ? { paddingLeft: `${indent}ch`, textIndent: `-${indent}ch` } : undefined}
          >
            {i < lines.length - 1 ? line + "\n" : line}
          </span>
        );
      })}
      {more && <span className="block text-muted-foreground">…</span>}
    </pre>
  );
}
