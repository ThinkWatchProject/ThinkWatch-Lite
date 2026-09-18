import { Badge } from "@/ui/badge";
import { Progress } from "@/ui/progress";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { resetIn } from "@/format";
import { usd, type Overview, type ProviderView } from "@/types";
import type { UpstreamStats } from "./api";
import { billingLabel, egressLabel, protocolLabel, quotaWindowLabel, shortUrl } from "./labels";

export interface UpstreamActions {
  edit: (name: string) => void;
  test: (name: string) => void;
  linkTest: (name: string) => void;
  speedTest: (name: string) => void;
  refreshModels: (name: string) => void;
  /** ChatGPT 账号上游：额度与重置卡 */
  account: (name: string) => void;
  toggle: (p: ProviderView) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
}

/**
 * 上游列表。**只读** —— 改任何东西都走对话框，行上没有就地编辑的控件。
 *
 * 双击行、行尾按钮、右键打开的是同一份操作。
 */
export function UpstreamTable({
  ov,
  stats,
  actions,
}: {
  ov: Overview;
  stats: UpstreamStats | null;
  actions: UpstreamActions;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>上游</TableHead>
          <TableHead className="text-right">模型</TableHead>
          {/* 订阅额度和按量计费是同一个问题的两种答案：还能用多少 */}
          <TableHead className="w-40">额度 / 计费</TableHead>
          <TableHead className="text-right">24 小时</TableHead>
          <TableHead className="text-right">首字节 P50</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {ov.providers.map((p) => {
          const items = menu(p, actions);
          return (
            <RowMenu key={p.name} items={items}>
              <TableRow
                data-row={p.name}
                onDoubleClick={() => actions.edit(p.name)}
                className="cursor-default"
              >
                <TableCell className="py-2">
                  {/*
                    **状态只在异常时出现。**每行都写一遍「正常」是噪声；熔断和停用
                    跟在名称后面，扫一遍列表就能看到。
                  */}
                  <div className="flex items-center gap-1.5">
                    <span className={p.disabled ? "font-medium text-muted-foreground" : "font-medium"}>
                      {p.name}
                    </span>
                    {p.trust === "official" && <Badge variant="secondary">官方端点</Badge>}
                    {p.disabled ? (
                      <Badge variant="outline">已停用</Badge>
                    ) : p.health === "open" ? (
                      <Badge variant="warning">熔断中</Badge>
                    ) : null}
                  </div>
                  {/*
                    协议、地址、出站方式是同一件事的三个部分：这一家在哪、怎么连。
                    地址可能很长（带路径的中转）：截断，悬停看全
                  */}
                  <div
                    className="max-w-96 truncate tw-label text-muted-foreground"
                    title={`${protocolLabel(p.protocol)} · ${p.base_url}${
                      p.proxy === "direct" ? "" : ` · 经 ${egressLabel(p.proxy)}`
                    }`}
                  >
                    {protocolLabel(p.protocol)} · {shortUrl(p.base_url)}
                    {/* 直连是默认，不用说 */}
                    {p.proxy !== "direct" && ` · 经 ${egressLabel(p.proxy)}`}
                  </div>
                </TableCell>
                <ModelsCell p={p} />
                <QuotaCell p={p} stats={stats} />
                <DayCell p={p} stats={stats} />
                <LatencyCell p={p} stats={stats} />
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={`${p.name} 的操作`} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

function menu(p: ProviderView, a: UpstreamActions): MenuItems {
  return [
    { kind: "item", label: "编辑…", onSelect: () => a.edit(p.name) },
    { kind: "item", label: "检测连接", onSelect: () => a.test(p.name) },
    { kind: "item", label: "链路测速", onSelect: () => a.linkTest(p.name) },
    { kind: "item", label: "推理测速…", onSelect: () => a.speedTest(p.name) },
    { kind: "item", label: "刷新模型列表", onSelect: () => a.refreshModels(p.name) },
    ...(p.protocol === "chatgpt"
      ? ([{ kind: "item", label: "额度与重置卡…", onSelect: () => a.account(p.name) }] as MenuItems)
      : []),
    { kind: "sep" },
    { kind: "item", label: p.disabled ? "启用" : "停用", onSelect: () => a.toggle(p) },
    { kind: "item", label: "在配置文件中定位", onSelect: () => a.locate(p.name) },
    { kind: "sep" },
    { kind: "item", label: "删除…", onSelect: () => a.remove(p.name), danger: true },
  ];
}

function ModelsCell({ p }: { p: ProviderView }) {
  const sub =
    p.model_source === "manual"
      ? "手动清单"
      : p.model_source === "none"
        ? "未获取"
        : p.models_only
          ? "指定范围"
          : null;
  return (
    <TableCell className="text-right tabular-nums">
      {/* 停用时 core 报 0 —— 那不是「没有模型」，状态一栏已经说了停用 */}
      {p.disabled || p.model_source === "none" ? "—" : p.model_count}
      {sub && <div className="tw-label text-muted-foreground">{sub}</div>}
    </TableCell>
  );
}

/**
 * 还剩多少可用。
 *
 * 订阅制上游的答案是额度条 —— 那是这一家「今天还能不能接着用」的唯一答案，
 * 而计费方式（订阅制）在额度条出现的那一刻已经不言自明。**上游没报过额度就
 * 退回说计费方式**：画一根 0% 的空条等于说「一点没用」，而事实是不知道。
 */
function QuotaCell({ p, stats }: { p: ProviderView; stats: UpstreamStats | null }) {
  const windows = stats?.quotas.find((q) => q.provider === p.name)?.windows ?? [];
  // 最紧张的那个窗口：先到的那条线决定什么时候用完
  const tight = windows.reduce<(typeof windows)[number] | null>(
    (a, w) => (!a || w.used_percent > a.used_percent ? w : a),
    null,
  );
  if (tight && !p.disabled) {
    const reset = resetIn(tight.reset_in_secs);
    return (
      <TableCell>
        <div className="flex items-baseline justify-between gap-2">
          <span className="tabular-nums">{Math.round(tight.used_percent)}%</span>
          <span className="tw-label text-muted-foreground">
            {reset ? `${quotaWindowLabel(tight.window)} · ${reset}` : quotaWindowLabel(tight.window)}
          </span>
        </div>
        <Progress
          value={tight.used_percent}
          className="mt-1"
          aria-label={`${quotaWindowLabel(tight.window)}额度`}
        />
      </TableCell>
    );
  }
  const billing = p.billing ?? p.billing_effective;
  return (
    <TableCell>
      <div
        className={billing === "free" || billing === "unknown" ? "text-muted-foreground" : undefined}
      >
        {billingLabel(billing)}
      </div>
      {billing === "per-token" && (
        <div className="tw-label text-muted-foreground">价目表 {p.pricing ?? "默认"}</div>
      )}
    </TableCell>
  );
}

/**
 * 一天用了多少：次数在上，花了多少在下。
 *
 * 分成两列时，看一行要左右扫两次才知道「这一家跑了多少、花了多少」—— 而这
 * 两个数只有放在一起才有意义。
 */
function DayCell({ p, stats }: { p: ProviderView; stats: UpstreamStats | null }) {
  const cost = stats?.costs.find((c) => c.name === p.name);
  if (!cost || cost.requests === 0) {
    return <TableCell className="text-right text-muted-foreground">—</TableCell>;
  }
  const billing = p.billing ?? p.billing_effective;
  return (
    <TableCell className="text-right tabular-nums">
      <div>{cost.requests.toLocaleString()} 次</div>
      <div className="tw-label text-muted-foreground">
        {billing === "subscription" ? (
          "订阅内"
        ) : billing === "unknown" ? (
          "费用未知"
        ) : (
          <>
            {usd(cost.cost_micros)}
            {cost.unpriced_requests > 0 && (
              <span className="text-warning"> · {cost.unpriced_requests} 次无法计价</span>
            )}
          </>
        )}
      </div>
    </TableCell>
  );
}

function LatencyCell({ p, stats }: { p: ProviderView; stats: UpstreamStats | null }) {
  const lat = stats?.latency.find((l) => l.model === p.name);
  return (
    <TableCell className="text-right tabular-nums">
      {lat && lat.samples > 0 ? `${lat.p50.toLocaleString()} ms` : "—"}
    </TableCell>
  );
}
