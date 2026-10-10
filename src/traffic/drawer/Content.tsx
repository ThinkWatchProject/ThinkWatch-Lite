import { useMemo, useRef, useState } from "react";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/ui/checkbox";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import type { Msg, RequestDetail } from "@/types";
import { Pill } from "../Conversation";
import { contentText } from "./Content.i18n";
import { dialectOf } from "./dialect";
import type { LiveContent } from "./live";
import { Parsed } from "./Parsed";
import { Raw } from "./Raw";
import { requestDrawerText } from "./RequestDrawer.i18n";
import { fromDetail, fromLive, landed } from "./wireModel";

export type ContentView = "parsed" | "raw";

/**
 * 「内容」看哪一种。**在这个窗口里记着**：换一条请求看，还是上一次选的那一种。第一次按格式认不
 * 认得出：认得出看解析，认不出看原始报文
 */
let lastView: ContentView | null = null;

export function useContentView(): [ContentView | null, (v: ContentView) => void] {
  const [view, setView] = useState<ContentView | null>(lastView);
  return [
    view,
    (v) => {
      lastView = v;
      setView(v);
    },
  ];
}

/**
 * 请求详情的「内容」：**解析**（按对话读出来）和**原始报文**（报文原样，客户端一侧、上游一侧）。
 *
 * 在跑的请求看的是实时内容（`live`），一边收一边长；请求结束、存下的那一份取回来之后换成存下的
 * —— 两种整理成同一个样子（`wireModel`），换的那一下画面不跳。存下的那一份还没落盘（请求刚
 * 结束的那几毫秒）时接着画实时收到的。
 */
export function Content({
  d,
  live,
  view: chosen,
  onView,
}: {
  d: RequestDetail;
  live: LiveContent | null;
  view: ContentView | null;
  onView: (v: ContentView) => void;
}) {
  const t = useText(contentText);
  const r = useText(requestDrawerText);
  const running = d.in_flight;
  const dialect = dialectOf(d.row.path, d.row.translated?.from);
  const view: ContentView = chosen ?? (dialect ? "parsed" : "raw");
  const fromStream = live !== null && live.order.length > 0 && (running || !landed(d));
  const version = live?.version ?? 0;
  const model = useMemo(
    () => (fromStream && live ? fromLive(live, d) : fromDetail(d)),
    // `version`：实时的那一份是就地改的
    [fromStream, live, version, d],
  );
  const streaming = running && live !== null && !live.closed;
  /**
   * 订阅不上、或者中途断了，而请求还在跑（已经结束的不算：去取存下的就是了）。说一句原因，
   * 下面照取到的画
   */
  const liveError =
    running && live?.error !== undefined && (live.error as Msg | null)?.code !== "control.request_not_running"
      ? errorText(live.error)
      : null;

  const [side, setSide] = useState<"client" | "upstream">("client");
  const hasUpstream = model.upstream.length > 0;
  const shownSide = hasUpstream ? side : "client";
  /** 上游一侧看哪一跳：没选过是回答的那一跳（最后一跳） */
  const [picked, setPicked] = useState<number | null>(null);
  const hop = model.upstream.find((u) => u.attempt === picked) ?? model.upstream[model.upstream.length - 1];
  const shown = shownSide === "upstream" && hop ? hop : model.client;
  /** 看着的那一段回答还在长：「跟随最新」只在这时有意义 */
  const growing = shown.response.body.kind === "body" && shown.response.body.body.growing;

  // 跟随最新：开着时回答那一框停在最底下。往上翻就停，翻回最底下接着跟；手动关掉的不自己接上
  const [follow, setFollow] = useState(true);
  const pausedByScroll = useRef(false);
  const onUserScroll = (atEnd: boolean) => {
    if (!streaming) return;
    if (!atEnd && follow) {
      pausedByScroll.current = true;
      setFollow(false);
    } else if (atEnd && !follow && pausedByScroll.current) {
      pausedByScroll.current = false;
      setFollow(true);
    }
  };

  const plugin =
    shownSide === "upstream" && hop?.serving && model.afterPlugins && d.request_body
      ? {
          original: d.request_body,
          after: model.afterPlugins,
          sentBy:
            model.upstream.length > 1 || (d.row.routing?.attempts.length ?? 0) > 1
              ? r.afterPluginsSentBy(hop.attempt, hop.provider ?? "")
              : null,
        }
      : null;

  return (
    <div className={cn("flex flex-col gap-3", view === "raw" && "h-full min-h-[28rem]")}>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<ContentView>
          label={t.viewsLabel}
          value={view}
          options={[
            { id: "parsed", label: t.views.parsed },
            { id: "raw", label: t.views.raw },
          ]}
          onChange={onView}
        />
        {view === "raw" && hasUpstream && (
          <Segmented<"client" | "upstream">
            label={t.sidesLabel}
            value={shownSide}
            options={[
              { id: "client", label: t.sides.client },
              { id: "upstream", label: t.sides.upstream },
            ]}
            onChange={setSide}
          />
        )}
        <span className="flex-1" />
        {view === "raw" && streaming && growing && (
          <label className="flex h-7 cursor-pointer items-center gap-2 text-muted-foreground select-none">
            <Checkbox
              checked={follow}
              onCheckedChange={(v) => {
                pausedByScroll.current = false;
                setFollow(v === true);
              }}
            />
            {t.follow}
          </label>
        )}
        {streaming && (
          <StatusLabel tone="pending" muted className="tw-label">
            {t.live}
          </StatusLabel>
        )}
      </div>

      {liveError && (
        <div>
          <Pill tone="error">{t.liveFailed(liveError)}</Pill>
        </div>
      )}

      {view === "parsed" ? (
        <Parsed
          request={model.client.request}
          response={model.client.response}
          dialect={dialect}
          d={d}
          end={fromStream ? (live?.end ?? null) : null}
        />
      ) : (
        <Raw
          key={shownSide === "upstream" ? `up:${hop?.attempt}` : "client"}
          side={shown}
          at={d.row.at_ms}
          pending={running}
          follow={follow && streaming}
          onUserScroll={onUserScroll}
          plugin={plugin}
          picker={
            shownSide === "upstream" && model.upstream.length > 1 && hop ? (
              <div className="flex items-center gap-2">
                <span className="tw-label text-muted-foreground">{t.attemptsLabel}</span>
                <Segmented<string>
                  label={t.attemptsLabel}
                  value={String(hop.attempt)}
                  options={model.upstream.map((u) => ({
                    id: String(u.attempt),
                    label: r.attemptGroup(u.attempt, u.provider),
                  }))}
                  onChange={(v) => setPicked(Number(v))}
                />
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
}
