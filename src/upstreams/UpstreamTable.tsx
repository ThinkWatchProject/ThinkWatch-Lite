import { Badge } from "@/ui/badge";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { usd, type Overview, type ProviderView } from "@/types";
import type { UpstreamStats } from "./api";
import { billingSummary, egressLabel, protocolLabel, quotaWindowLabel, shortUrl } from "./labels";

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
          <TableHead>名称</TableHead>
          <TableHead className="text-right">模型</TableHead>
          <TableHead>出站</TableHead>
          <TableHead>计费</TableHead>
          <TableHead className="text-right">24 小时请求</TableHead>
          <TableHead className="text-right">24 小时费用</TableHead>
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
                  {/* 地址可能很长（带路径的中转）：截断，悬停看全 */}
                  <div
                    className="max-w-80 truncate tw-label text-muted-foreground"
                    title={`${protocolLabel(p.protocol)} · ${p.base_url}`}
                  >
                    {protocolLabel(p.protocol)} · {shortUrl(p.base_url)}
                    {p.oauth && " · OAuth"}
                  </div>
                </TableCell>
                <ModelsCell p={p} />
                <TableCell>
                  <span
                    className={
                      p.proxy === "direct" || p.proxy === "system"
                        ? "text-muted-foreground"
                        : "font-mono"
                    }
                  >
                    {egressLabel(p.proxy)}
                  </span>
                </TableCell>
                <BillingCell p={p} stats={stats} />
                <StatsCells p={p} stats={stats} />
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

function BillingCell({ p, stats }: { p: ProviderView; stats: UpstreamStats | null }) {
  const quota = stats?.quotas.find((q) => q.provider === p.name);
  // 最紧张的那个窗口
  const tight = quota?.windows.reduce<(typeof quota.windows)[number] | null>(
    (a, w) => (!a || w.used_percent > a.used_percent ? w : a),
    null,
  );
  return (
    <TableCell>
      {billingSummary(p)}
      {tight && (
        <div className="tw-label text-muted-foreground">
          {quotaWindowLabel(tight.window)}额度已用 {Math.round(tight.used_percent)}%
        </div>
      )}
    </TableCell>
  );
}

function StatsCells({ p, stats }: { p: ProviderView; stats: UpstreamStats | null }) {
  const cost = stats?.costs.find((c) => c.name === p.name);
  const lat = stats?.latency.find((l) => l.model === p.name);
  const billing = p.billing ?? p.billing_effective;
  const money = (() => {
    if (!cost || cost.requests === 0) return <span className="text-muted-foreground">—</span>;
    if (billing === "subscription") return <span className="text-muted-foreground">订阅</span>;
    if (billing === "unknown") return <span className="text-muted-foreground">未知</span>;
    return (
      <>
        {usd(cost.cost_micros)}
        {cost.unpriced_requests > 0 && (
          <div className="tw-label text-warning">{cost.unpriced_requests} 次无法计价</div>
        )}
      </>
    );
  })();
  return (
    <>
      <TableCell className="text-right tabular-nums">
        {cost && cost.requests > 0 ? cost.requests.toLocaleString() : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{money}</TableCell>
      <TableCell className="text-right tabular-nums">
        {lat && lat.samples > 0 ? `${lat.p50.toLocaleString()} ms` : "—"}
      </TableCell>
    </>
  );
}
