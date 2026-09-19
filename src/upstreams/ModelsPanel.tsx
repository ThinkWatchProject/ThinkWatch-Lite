import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, CircleAlertIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Spinner } from "@/ui/spinner";
import type { ModelRow, ProviderModelsView, ProviderView } from "@/types";
import { api } from "./api";
import { contextWindow, errorText, perMillion } from "./labels";

/** 列表长过这个数才给筛选框。十来个一眼就扫完了 */
const FILTER_FROM = 10;

/**
 * 点开「模型」一格看到的东西：这一家有哪些模型，是怎么知道的，没拿到的话
 * 为什么、该做什么。
 *
 * **只读，改动在编辑对话框里做** —— 启用范围、手动清单都要一次保存一个
 * 配置版本，和上游其余设置走同一条路。这里给的是去那儿的入口。
 */
export function ModelsPanel({
  p,
  perToken,
  onEdit,
}: {
  p: ProviderView;
  /** 按量计费：列出单价。别的计费方式不按单价算钱，列了也没意义 */
  perToken: boolean;
  /** 打开编辑对话框的「模型」一节 */
  onEdit: () => void;
}) {
  const [view, setView] = useState<ProviderModelsView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [showOff, setShowOff] = useState(false);

  // 概览里这一家的获取状态一变（开始问了、问完了）就重读：打开着面板等它问完，
  // 也能看到结果。读的是 core 记下的答案，不联网
  useEffect(() => {
    let alive = true;
    api
      .providerModels(p.name)
      .then((v) => {
        if (!alive) return;
        setView(v);
        setFailed(null);
      })
      .catch((e) => alive && setFailed(errorText(e)));
    return () => {
      alive = false;
    };
  }, [p.name, p.model_checked_at_ms, p.model_fetching, p.model_count]);

  async function refresh() {
    setRefreshing(true);
    try {
      setView(await api.refreshProviderModels(p.name));
      setFailed(null);
    } catch (e) {
      setFailed(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  const fetching = refreshing || (view?.fetching ?? p.model_fetching);
  const models = view?.models ?? [];
  const q = query.trim().toLowerCase();
  const match = (m: ModelRow) => q === "" || m.id.toLowerCase().includes(q);
  const on = useMemo(() => models.filter((m) => m.enabled), [models]);
  const off = useMemo(() => models.filter((m) => !m.enabled), [models]);
  const shownOn = on.filter(match);
  const shownOff = off.filter(match);

  const status = view?.status ?? p.model_status;
  const source = view?.source ?? p.model_source;
  const error = view?.error ?? p.model_error;

  return (
    <div className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] flex-col">
      <div className="flex items-start gap-2 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="tw-body font-medium">模型</div>
          <div className="tw-label text-muted-foreground">{summary(source, models.length, on.length, view)}</div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="重新获取模型列表"
          title="重新获取模型列表"
          disabled={fetching}
          onClick={() => void refresh()}
        >
          {fetching ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>

      {failed ? (
        <Problem text={failed} />
      ) : !view ? (
        <Waiting text="正在读取" />
      ) : source === "none" && (status === "pending" || fetching) ? (
        <Waiting text="正在获取模型列表" />
      ) : (
        <>
          {/* 没从上游拿到清单：说为什么，指出该做什么。手动清单顶上时照样说 */}
          {status === "failed" && (
            <Problem
              title="获取失败"
              text={error ?? "未能连接上游。"}
              action={
                <>
                  <Button size="xs" variant="outline" disabled={fetching} onClick={() => void refresh()}>
                    重试
                  </Button>
                  <Button size="xs" variant="ghost" onClick={onEdit}>
                    编辑上游…
                  </Button>
                </>
              }
              after={source === "manual" ? `暂用手动清单中的 ${models.length} 个模型。` : null}
            />
          )}
          {status === "no_list" && source === "none" && (
            <Problem
              text={`${error ?? "上游未提供模型列表"}。可填写手动清单，列出此上游提供的模型。`}
              muted
              action={
                <Button size="xs" variant="outline" onClick={onEdit}>
                  填写手动清单…
                </Button>
              }
            />
          )}

          {models.length > 0 && (
            <>
              {models.length > FILTER_FROM && (
                <div className="px-3 pt-2.5">
                  <InputGroup className="h-7">
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      placeholder="筛选模型"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </InputGroup>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
                {shownOn.map((m) => (
                  <Row key={m.id} m={m} perToken={perToken} />
                ))}
                {off.length > 0 && (
                  <>
                    <button
                      type="button"
                      aria-expanded={showOff || q !== ""}
                      onClick={() => setShowOff((v) => !v)}
                      className="mt-1 flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left tw-label text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ChevronRightIcon
                        className={cn("size-3.5 transition-transform", (showOff || q !== "") && "rotate-90")}
                      />
                      不在启用范围内 {off.length} 个
                    </button>
                    {(showOff || q !== "") &&
                      shownOff.map((m) => <Row key={m.id} m={m} perToken={perToken} />)}
                  </>
                )}
                {q !== "" && shownOn.length + shownOff.length === 0 && (
                  <p className="px-1.5 py-2 tw-label text-muted-foreground">无匹配的模型</p>
                )}
              </div>
              <div className="border-t px-1.5 py-1.5">
                <Button size="xs" variant="ghost" className="w-full justify-start" onClick={onEdit}>
                  {source === "manual" ? "编辑手动清单与启用范围…" : "调整启用范围…"}
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 标题下那一行：多少个、从哪儿来、什么时候问的 */
function summary(source: string, total: number, enabled: number, view: ProviderModelsView | null): string {
  if (!view) return "";
  const count = enabled === total ? `${total} 个` : `${total} 个，已启用 ${enabled} 个`;
  if (source === "discovered") {
    return view.checked_at_ms ? `上游列出 ${count} · ${clock(view.checked_at_ms)} 获取` : `上游列出 ${count}`;
  }
  if (source === "manual") return `手动清单 ${count}`;
  // 没拿到清单：那个时间是问的时间，不是拿到的时间
  return view.checked_at_ms ? `最近一次尝试 ${clock(view.checked_at_ms)}` : "尚未获取";
}

function Row({ m, perToken }: { m: ModelRow; perToken: boolean }) {
  const price =
    perToken && m.price
      ? `$${perMillion(m.price.input)} / $${perMillion(m.price.output)}${m.estimated ? "（估）" : ""}`
      : null;
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 rounded-md px-1.5 py-1",
        !m.enabled && "text-muted-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono tw-label" title={m.id}>
        {m.id}
      </span>
      {price && (
        <span
          className="shrink-0 tabular-nums tw-label text-muted-foreground"
          title="输入 / 输出，美元每百万 tokens"
        >
          {price}
        </span>
      )}
      <span className="w-10 shrink-0 text-right tabular-nums tw-label text-muted-foreground" title="上下文窗口">
        {m.context_window ? contextWindow(m.context_window) : ""}
      </span>
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 px-3 py-4 tw-body text-muted-foreground">
      <Spinner />
      {text}
    </p>
  );
}

function Problem({
  title,
  text,
  action,
  after,
  muted = false,
}: {
  title?: string;
  text: string;
  action?: ReactNode;
  after?: string | null;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5">
      <div className={cn("flex items-start gap-2 tw-label", muted ? "text-muted-foreground" : "text-warning")}>
        {!muted && <CircleAlertIcon className="mt-px size-3.5 shrink-0" />}
        <div className="min-w-0">
          {title && <div className="font-medium">{title}</div>}
          <div className="break-words">{text}</div>
        </div>
      </div>
      {action && <div className="flex gap-1.5">{action}</div>}
      {after && <p className="tw-label text-muted-foreground">{after}</p>}
    </div>
  );
}

/** 今天只写时刻，别的日子带上月日 */
function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}
