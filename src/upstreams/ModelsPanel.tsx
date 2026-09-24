import { type ReactNode, useMemo, useState } from "react";
import { ChevronRightIcon, CircleAlertIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/resource";
import { Button } from "@/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { StatusLabel } from "@/ui/status-dot";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ModelRow, ProviderModelsView, ProviderView } from "@/types";
import { api } from "./api";
import { contextWindow, coreText, errorText, perMillion } from "./labels";
import { modelsPanelText } from "./ModelsPanel.i18n";

/** 列表长过这个数才给筛选框。十来个一眼就扫完了 */
const FILTER_FROM = 10;

/**
 * 点开「模型」一格看到的东西：这一家有哪些模型，是怎么知道的，没拿到的话
 * 原因和下一步。
 *
 * **只读，改动在编辑对话框里做** —— 启用范围、手动清单都要一次保存一个
 * 配置版本，和上游其余设置走同一条路。这里给的是去那儿的入口。
 *
 * 清单按上游缓存（`upstream-models:<名字>`）：再点开一次先画上一次的，后台再读。
 * 概览里这一家的获取状态一变（开始问了、问完了）就重读 —— 开着面板等它问完，
 * 也能看到结果。读的是 core 记下的答案，不联网。
 */
export function ModelsPanel({
  p,
  perToken,
  onEdit,
}: {
  p: ProviderView;
  /** 按量计费：列出单价。别的计费方式不按单价算费用，列了也没意义 */
  perToken: boolean;
  /** 打开编辑对话框的「模型」一节 */
  onEdit: () => void;
}) {
  const t = useText(modelsPanelText);
  const c = useText(commonText);
  const r = useResource(`upstream-models:${p.name}`, () => api.providerModels(p.name), {
    deps: [p.model_checked_at_ms, p.model_fetching, p.model_count],
  });
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showOff, setShowOff] = useState(false);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      r.mutate(await api.refreshProviderModels(p.name));
    } catch (e) {
      setRefreshError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  const view = r.data;
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
  const why = error ? coreText(error) : null;
  const readError = refreshError ?? (r.error !== undefined && !view ? errorText(r.error) : null);

  return (
    <div className="flex max-h-[min(30rem,var(--radix-popover-content-available-height))] flex-col">
      <div className="flex items-start gap-2 border-b px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="tw-body font-medium">{t.title}</div>
          <div className="tw-label text-muted-foreground">
            {view ? summary(source, models.length, on.length, view) : <Skeleton className="mt-1 h-2.5 w-28 rounded-sm" />}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t.refetch}
          title={t.refetch}
          aria-busy={fetching || undefined}
          disabled={fetching}
          onClick={() => void refresh()}
        >
          {fetching ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>

      {readError ? (
        <Problem
          text={readError}
          action={
            <Button size="xs" variant="outline" pending={r.loading} onClick={() => void r.reload()}>
              {c.retry}
            </Button>
          }
        />
      ) : !view ? (
        <RowsSkeleton />
      ) : source === "none" && (status === "pending" || fetching) ? (
        <div className="px-3 py-4">
          <StatusLabel tone="pending" muted>
            {t.fetching}
          </StatusLabel>
        </div>
      ) : (
        <>
          {/* 没从上游拿到清单：说原因，指出下一步。手动清单顶上时照样说 */}
          {status === "failed" && (
            <Problem
              title={t.failed}
              text={why ?? t.unreachable}
              action={
                <>
                  <Button size="xs" variant="outline" pending={refreshing} disabled={fetching} onClick={() => void refresh()}>
                    {c.retry}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={onEdit}>
                    {t.editUpstream}
                  </Button>
                </>
              }
              after={source === "manual" ? t.usingManual(models.length) : null}
            />
          )}
          {status === "no_list" && source === "none" && (
            <Problem
              text={t.noList(why ?? t.noListReason)}
              muted
              action={
                <Button size="xs" variant="outline" onClick={onEdit}>
                  {t.fillManual}
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
                      placeholder={t.filter}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </InputGroup>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5 motion-fade">
                {shownOn.map((m) => (
                  <Row key={m.id} m={m} perToken={perToken} />
                ))}
                {off.length > 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-expanded={showOff || q !== ""}
                      onClick={() => setShowOff((v) => !v)}
                      className="mt-1 w-full justify-start gap-1 px-1.5 font-normal text-muted-foreground"
                    >
                      <ChevronRightIcon
                        className={cn(
                          "size-3.5 transition-transform duration-(--motion-fast)",
                          (showOff || q !== "") && "rotate-90",
                        )}
                      />
                      {t.notEnabled(off.length)}
                    </Button>
                    {(showOff || q !== "") &&
                      shownOff.map((m) => <Row key={m.id} m={m} perToken={perToken} />)}
                  </>
                )}
                {q !== "" && shownOn.length + shownOff.length === 0 && (
                  <p className="px-1.5 py-2 tw-label text-muted-foreground">{t.noMatch}</p>
                )}
              </div>
              <div className="border-t px-1.5 py-1.5">
                <Button size="xs" variant="ghost" className="w-full justify-start" onClick={onEdit}>
                  {source === "manual" ? t.editManual : t.editScope}
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
function summary(source: string, total: number, enabled: number, view: ProviderModelsView): string {
  const t = textOf(modelsPanelText);
  const count = enabled === total ? t.countAll(total) : t.countSome(total, enabled);
  if (source === "discovered") {
    return view.checked_at_ms ? t.listedAt(count, clock(view.checked_at_ms)) : t.listed(count);
  }
  if (source === "manual") return t.manual(count);
  // 没拿到清单：那个时间是问的时间，不是拿到的时间
  return view.checked_at_ms ? t.lastTry(clock(view.checked_at_ms)) : t.notFetched;
}

function Row({ m, perToken }: { m: ModelRow; perToken: boolean }) {
  const t = useText(modelsPanelText);
  const price =
    perToken && m.price
      ? `$${perMillion(m.price.input)} / $${perMillion(m.price.output)}${m.estimated ? t.estimated : ""}`
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
        <span className="shrink-0 tw-num tw-label text-muted-foreground" title={t.priceTitle}>
          {price}
        </span>
      )}
      <span className="w-10 shrink-0 text-right tw-num tw-label text-muted-foreground" title={t.context}>
        {m.context_window ? contextWindow(m.context_window) : ""}
      </span>
    </div>
  );
}

/** 清单还没读到：几行和模型行一样高的占位 */
function RowsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-1 px-3 py-2.5">
      {[72, 56, 64, 44].map((w, i) => (
        <div key={i} className="flex h-6 items-center justify-between gap-3" style={{ opacity: 1 - i * 0.18 }}>
          <Skeleton className="h-2.5 rounded-sm" style={{ width: `${w}%` }} />
          <Skeleton className="h-2.5 w-8 rounded-sm" />
        </div>
      ))}
    </div>
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
    <div className="flex flex-col gap-2 px-3 py-2.5 motion-fade">
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
