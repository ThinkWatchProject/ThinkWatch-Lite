import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { Resource } from "@/lib/resource";
import { Badge } from "@/ui/badge";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { resetAt } from "@/format";
import { useNow } from "@/useNow";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { usd, type ChatgptUsage, type ProviderView, type QuotaWindow } from "@/types";
import type { UpstreamStats } from "./api";
import { slotsByUpstream, type Slot } from "./data";
import {
  billingLabel,
  egressLabel,
  modelFace,
  planLabel,
  protocolLabel,
  quotaWindowLabel,
  shortUrl,
} from "./labels";
import { labelsText } from "./labels.i18n";
import { ModelsPanel } from "./ModelsPanel";
import { ProviderTile, keepInRow, openRow } from "./parts";
import { QUOTA_FULL, QuotaBar } from "./QuotaBar";
import { SPARKLINE_WIDTH, Sparkline } from "./Sparkline";
import { upstreamTableText } from "./UpstreamTable.i18n";

export interface UpstreamActions {
  edit: (name: string) => void;
  test: (name: string) => void;
  linkTest: (name: string) => void;
  speedTest: (name: string) => void;
  refreshModels: (name: string) => void;
  /** 打开编辑对话框的「模型」一节：启用范围、手动清单 */
  editModels: (name: string) => void;
  /** ChatGPT 账号上游：编辑对话框的「账号」一节（额度与重置卡） */
  account: (name: string) => void;
  /** 流量页，只看经这个上游的请求 */
  traffic: (name: string) => void;
  toggle: (p: ProviderView) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
}

/**
 * 上游列表。**只读** —— 改任何东西都走对话框，行上没有就地编辑的控件。
 *
 * 单击一行（或 Enter）打开它的编辑对话框；行尾按钮和右键打开的是同一份操作。
 *
 * 五列是定过的（lite#46）：上游、模型、额度 / 计费、24 小时、首字节 P50。「24 小时」
 * 一格里多了一条按小时的走势：请求在一天里怎么分布、失败落在哪几个小时，一眼看得出，
 * 数字留给右边和悬停。窗口窄到放不下时走势先让位（容器查询），数字照常在。
 */
export function UpstreamTable({
  providers,
  stats,
  since,
  accounts,
  inFlight,
  refreshing,
  focus,
  actions,
}: {
  providers: ProviderView[];
  stats: Resource<UpstreamStats>;
  /** 走势第一格的起点（对齐到整点） */
  since: number;
  /** 账号类上游问来的账号信息，按上游名。还没问到的就没有 */
  accounts: Record<string, ChatgptUsage>;
  /** 此刻每个上游在途的请求数 */
  inFlight: ReadonlyMap<string, number>;
  /** 正在手动刷新模型清单的上游 */
  refreshing: ReadonlySet<string>;
  /** 从别的页定位到的那一行：滚进视野、亮一下。`at` 让同一个名字再定位一次也生效 */
  focus: { name: string; at: number } | null;
  actions: UpstreamActions;
}) {
  const t = useText(upstreamTableText);
  // 额度的「多久后重置」随时间走：重画就行，不用再问 core
  const now = useNow();
  const shown = usePresentList(providers, (p) => p.name);
  const slots = useMemo(() => slotsByUpstream(stats.data?.buckets, since), [stats.data, since]);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    document
      .querySelector(`tr[data-row="${CSS.escape(focus.name)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    setFlash(focus.name);
    // 和 `motion-row-in` 一样长：亮一下就退
    const h = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(h);
  }, [focus]);
  return (
    // 容器查询：表格那一栏窄了（默认窗口里约 860px，最窄约 580px），走势先收起来
    <div className="@container">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full">{t.upstream}</TableHead>
            <TableHead className="text-right">{t.models}</TableHead>
            {/* 订阅额度和按量计费是同一个问题的两种答案：还能用多少 */}
            <TableHead className="w-40">{t.quota}</TableHead>
            <TableHead className="text-right">{t.day}</TableHead>
            <TableHead className="text-right">{t.ttfb}</TableHead>
            <TableHead className="w-9">
              <span className="sr-only">{t.actionsColumn}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(({ item: p, key, presence }) => {
            const items = menu(p, actions);
            return (
              <RowMenu key={key} items={items}>
                <TableRow
                  data-row={p.name}
                  {...openRow(() => actions.edit(p.name), rowMotion(flash === p.name ? "enter" : presence))}
                >
                  <NameCell
                    p={p}
                    account={accounts[p.name]}
                    live={(inFlight.get(p.name) ?? 0) > 0 && !p.disabled}
                    liveCount={inFlight.get(p.name) ?? 0}
                  />
                  <ModelsCell
                    p={p}
                    busy={refreshing.has(p.name)}
                    onEdit={() => actions.editModels(p.name)}
                  />
                  <QuotaCell p={p} stats={stats} now={now} />
                  <DayCell p={p} stats={stats} slots={slots.get(p.name)} />
                  <LatencyCell p={p} stats={stats} />
                  <TableCell className="text-right" {...keepInRow}>
                    <RowMenuButton items={items} label={t.actions(p.name)} />
                  </TableCell>
                </TableRow>
              </RowMenu>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function menu(p: ProviderView, a: UpstreamActions): MenuItems {
  const t = textOf(upstreamTableText);
  const c = textOf(commonText);
  return [
    { kind: "item", label: `${c.edit}…`, onSelect: () => a.edit(p.name) },
    { kind: "item", label: t.check, onSelect: () => a.test(p.name) },
    { kind: "item", label: t.linkTest, onSelect: () => a.linkTest(p.name) },
    { kind: "item", label: t.speedTest, onSelect: () => a.speedTest(p.name) },
    { kind: "item", label: t.refreshModels, onSelect: () => a.refreshModels(p.name) },
    ...(p.protocol === "chatgpt"
      ? ([{ kind: "item", label: t.account, onSelect: () => a.account(p.name) }] as MenuItems)
      : []),
    { kind: "item", label: t.traffic, onSelect: () => a.traffic(p.name) },
    { kind: "sep" },
    { kind: "item", label: p.disabled ? t.enable : t.disable, onSelect: () => a.toggle(p) },
    { kind: "item", label: t.locate, onSelect: () => a.locate(p.name) },
    { kind: "sep" },
    { kind: "item", label: `${c.delete}…`, onSelect: () => a.remove(p.name), danger: true },
  ];
}

/**
 * 这一行的状态。**只在异常时出现**：每行都写一遍「正常」是噪声。
 *
 * 熔断看不见凭据的问题（4xx 不算失败，凭据坏掉的上游永远不会熔断），所以凭据被拒、
 * 登录失效要自己说。几件同时成立时说最要紧的那一件，其余在悬停里。
 */
export function problemsOf(p: ProviderView): { tone: StatusTone; label: string; tip: string }[] {
  const t = textOf(upstreamTableText);
  if (p.disabled) return [{ tone: "idle", label: t.disabled, tip: t.disabledTip }];
  const out: { tone: StatusTone; label: string; tip: string }[] = [];
  if (p.oauth?.needs_login) out.push({ tone: "error", label: t.needsLogin, tip: t.needsLoginTip });
  if (p.auth_rejected != null)
    out.push({ tone: "error", label: t.authRejected, tip: t.authRejectedTip(p.auth_rejected) });
  if (p.health === "open") out.push({ tone: "error", label: t.circuitOpen, tip: t.circuitOpenTip });
  return out;
}

/**
 * 名称一格：标志、名字、套餐与状态，下面一行是协议、地址、出站方式 —— 这一家
 * 在哪、怎么连。地址可能很长（带路径的中转）：截断，悬停看全。
 */
function NameCell({
  p,
  account,
  live,
  liveCount,
}: {
  p: ProviderView;
  account?: ChatgptUsage;
  live: boolean;
  liveCount: number;
}) {
  const t = useText(upstreamTableText);
  const problems = problemsOf(p);
  const problem = problems[0];
  const plan = planLabel(account?.plan);
  const tile = <ProviderTile p={p} muted={p.disabled} live={live} />;
  return (
    <TableCell className="max-w-0 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        {live ? (
          <Tip text={t.inFlight(liveCount)}>
            <span className="inline-flex">{tile}</span>
          </Tip>
        ) : (
          tile
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate font-medium", p.disabled && "text-muted-foreground")}>{p.name}</span>
            {/* 订阅类账号：套餐决定了额度有多大，和名字放在一起看 */}
            {plan && <Badge variant="outline">{plan}</Badge>}
            {problem && (
              <Tip
                text={
                  <div className="flex max-w-72 flex-col gap-1">
                    {problems.map((x) => (
                      <p key={x.label}>{x.tip}</p>
                    ))}
                  </div>
                }
              >
                <span className="shrink-0">
                  <StatusLabel tone={problem.tone} muted={problem.tone === "idle"}>
                    {problem.label}
                  </StatusLabel>
                </span>
              </Tip>
            )}
          </div>
          <Where p={p} account={account} />
        </div>
      </div>
    </TableCell>
  );
}

/**
 * 这一家在哪、怎么连。
 *
 * 账号类上游的地址永远是同一个，**写出来一行废话** —— 那一格留给邮箱：登了两个
 * 账号时，它是唯一能分辨哪行是哪个的东西。
 */
function Where({ p, account }: { p: ProviderView; account?: ChatgptUsage }) {
  const t = useText(upstreamTableText);
  const isAccount = p.protocol === "chatgpt";
  const where = isAccount ? (account?.email ?? null) : shortUrl(p.base_url);
  // 直连是默认，不用说
  const egress = p.proxy === "direct" ? "" : ` · ${t.via(egressLabel(p.proxy))}`;
  const full = [protocolLabel(p.protocol), isAccount ? account?.email : p.base_url].filter(Boolean).join(" · ");
  return (
    <div className="truncate tw-label text-muted-foreground" title={`${full}${egress}`}>
      {protocolLabel(p.protocol)}
      {where && ` · ${where}`}
      {egress}
    </div>
  );
}

/**
 * 有多少个模型，以及都有哪些。
 *
 * **整格是一个按钮，什么状态都能点开** —— 数目单独回答不了「要的那个模型在不在
 * 里面」，而没拿到清单时，点开要能看到原因和下一步。停用的上游不提供模型。
 */
function ModelsCell({ p, busy, onEdit }: { p: ProviderView; busy: boolean; onEdit: () => void }) {
  const t = useText(upstreamTableText);
  const l = useText(labelsText);
  const [open, setOpen] = useState(false);
  if (p.disabled) {
    return <TableCell className="text-right text-muted-foreground">—</TableCell>;
  }
  const face = modelFace(p);
  const fetching = busy || p.model_fetching || face.note === l.models.fetching;
  return (
    <TableCell className="text-right" {...keepInRow}>
      <Popover open={open} onOpenChange={setOpen}>
        {/*
          悬停时整块变底色，不画下划线 —— 鼠标正好压在字的下方，一条紧贴
          基线的线它自己就把它挡了
        */}
        <PopoverTrigger
          aria-label={t.modelsOf(p.name)}
          className="-my-1 -mr-2 inline-flex min-w-12 flex-col items-end rounded-md px-2 py-1 transition-colors duration-(--motion-fast) hover:bg-muted focus-visible:bg-muted focus-visible:outline-none aria-expanded:bg-muted"
        >
          <span className="inline-flex items-center gap-1.5 tw-num">
            {fetching && <Spinner className="size-3 text-muted-foreground" />}
            {face.count ?? "—"}
          </span>
          {face.note && (
            <span className={cn("tw-label", face.warn ? "text-warning" : "text-muted-foreground")}>
              {face.note}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 gap-0 p-0">
          <ModelsPanel
            p={p}
            perToken={p.billing === "per-token"}
            onEdit={() => {
              setOpen(false);
              onEdit();
            }}
          />
        </PopoverContent>
      </Popover>
    </TableCell>
  );
}

/**
 * 还剩多少可用。
 *
 * 报过额度的上游，答案是额度条 —— 那是这一家「今天还能不能接着用」的唯一答案，
 * 画的是**最紧张的那个窗口**，其余窗口在悬停里。**没报过额度就退回说计费方式**：
 * 画一根 0% 的空条等于说「一点没用」，而事实是不知道。
 */
function QuotaCell({ p, stats, now }: { p: ProviderView; stats: Resource<UpstreamStats>; now: number }) {
  const t = useText(upstreamTableText);
  // **过了重置时刻的窗口不算数**：手上的百分比是重置之前的，下一个请求才会带来
  // 新的。拿它画一根满格的条，说的是一件已经不成立的事
  const windows = (stats.data?.quotas.find((q) => q.provider === p.name)?.windows ?? []).filter(
    (w) => w.resets_at_ms == null || w.resets_at_ms > now,
  );
  // 最紧张的那个窗口：先到的那条线决定什么时候用完
  const tight = windows.reduce<QuotaWindow | null>(
    (a, w) => (!a || w.used_percent > a.used_percent ? w : a),
    null,
  );
  if (tight && !p.disabled) {
    const reset = resetAt(tight.resets_at_ms, now);
    const used = Math.round(tight.used_percent);
    return (
      <TableCell>
        <Tip text={<QuotaTip windows={windows} now={now} />}>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              {/* **要说清楚这个数是用掉的还是剩下的**：一根填了一半的条，两种读法都成立 */}
              <span className={cn("tw-num", used >= QUOTA_FULL && "text-destructive")}>{t.used(used)}</span>
              <span className="truncate tw-label text-muted-foreground">
                {reset ? `${quotaWindowLabel(tight.window)} · ${reset}` : quotaWindowLabel(tight.window)}
              </span>
            </div>
            <QuotaBar percent={tight.used_percent} label={t.quotaOf(quotaWindowLabel(tight.window))} className="mt-1" />
          </div>
        </Tip>
      </TableCell>
    );
  }
  const billing = p.billing;
  return (
    <TableCell>
      <div className={billing === "free" || p.disabled ? "text-muted-foreground" : undefined}>
        {billingLabel(billing)}
      </div>
      {billing === "per-token" && (
        <div className="truncate tw-label text-muted-foreground">{t.sheet(p.pricing ?? t.defaultSheet)}</div>
      )}
    </TableCell>
  );
}

/** 悬停在额度上：每个窗口一行 */
function QuotaTip({ windows, now }: { windows: QuotaWindow[]; now: number }) {
  const t = useText(upstreamTableText);
  return (
    <div className="flex flex-col gap-0.5">
      {windows.map((w) => {
        const reset = resetAt(w.resets_at_ms, now);
        return (
          <div key={w.window}>
            {t.windowLine(quotaWindowLabel(w.window), Math.round(w.used_percent), reset)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 一天用了多少：左边是按小时的走势，右边次数在上、费用在下。
 *
 * 次数和费用分成两列时，看一行要左右扫两次才知道「这一家跑了多少、费用多少」——
 * 而这两个数只有放在一起才有意义。走势里失败的那一截是红的；失败多少、成功率、
 * 无法计价的次数在悬停里。
 */
function DayCell({
  p,
  stats,
  slots,
}: {
  p: ProviderView;
  stats: Resource<UpstreamStats>;
  slots: Slot[] | undefined;
}) {
  const t = useText(upstreamTableText);
  if (stats.data === undefined) {
    return (
      <TableCell className="text-right">
        {stats.loading ? (
          // 和读到之后一样宽：走势的位置先占上，数字到了列宽不跳
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 rounded-sm @max-[50rem]:hidden" style={{ width: SPARKLINE_WIDTH }} />
            <CellSkeleton />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    );
  }
  const cost = stats.data.costs.find((c) => c.name === p.name);
  if (!cost || cost.requests === 0) {
    return <TableCell className="text-right text-muted-foreground">—</TableCell>;
  }
  const failed = slots?.reduce((n, s) => n + s.failed, 0) ?? 0;
  const tip = (
    <div className="flex flex-col gap-0.5 tw-num">
      <div>{t.dayRequests(cost.requests)}</div>
      <div>
        {failed > 0 ? t.dayFailed(failed, (1 - failed / cost.requests) * 100) : t.dayNoFailures}
      </div>
      <div>{t.dayCost(usd(cost.cost_micros))}</div>
      {cost.unpriced_requests > 0 && <div>{t.unpricedTip(cost.unpriced_requests)}</div>}
    </div>
  );
  return (
    <TableCell className="text-right">
      <Tip text={tip}>
        {/*
          走势贴左、数字贴右，撑满这一格：各行的走势左边对齐、数字右边对齐，
          不随「201 次」「7 次」的宽窄左右错开
        */}
        <div className="flex items-center justify-between gap-3">
          {slots && <Sparkline slots={slots} className="@max-[50rem]:hidden" />}
          <div className="flex min-w-14 flex-col items-end">
            <AnimatedNumber value={cost.requests} format={(n) => t.requests(Math.round(n))} />
            <span className="tw-label tw-num text-muted-foreground">
              <AnimatedNumber value={cost.cost_micros} format={(n) => usd(Math.round(n))} />
              {cost.unpriced_requests > 0 && <span className="text-warning"> · {t.unpriced(cost.unpriced_requests)}</span>}
            </span>
          </div>
        </div>
      </Tip>
    </TableCell>
  );
}

/** 首字节 P50。P95 与样本数在悬停里：「800 ms」是 3 个样本还是 300 个，含义完全不同 */
function LatencyCell({ p, stats }: { p: ProviderView; stats: Resource<UpstreamStats> }) {
  const t = useText(upstreamTableText);
  if (stats.data === undefined) {
    return (
      <TableCell className="text-right">
        {stats.loading ? <CellSkeleton short /> : <span className="text-muted-foreground">—</span>}
      </TableCell>
    );
  }
  const lat = stats.data.latency.find((l) => l.model === p.name);
  if (!lat || lat.samples === 0) {
    return <TableCell className="text-right text-muted-foreground">—</TableCell>;
  }
  return (
    <TableCell className="text-right">
      <Tip text={t.latencyTip(lat.p95, lat.samples)}>
        <span className="tw-num">{t.ms(lat.p50)}</span>
      </Tip>
    </TableCell>
  );
}

/** 统计还没到时，一格里的占位：两行，和数字的位置一样 */
function CellSkeleton({ short = false }: { short?: boolean }) {
  return (
    <div className={cn("flex flex-col items-end gap-1.5", !short && "min-w-14")}>
      <Skeleton className={cn("h-3 rounded-sm", short ? "w-12" : "w-16")} />
      {!short && <Skeleton className="h-2.5 w-10 rounded-sm" />}
    </div>
  );
}
