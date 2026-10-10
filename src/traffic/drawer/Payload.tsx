import { useMemo } from "react";
import { call } from "@/control";
import { textOf, useText } from "@/i18n";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { Tip } from "@/ui/tip";
import { useNow } from "@/useNow";
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
export function NotSaved({ which, at }: { which: "request" | "response"; at: number }) {
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
