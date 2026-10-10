import { ms, traffic } from "@/format";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { rangeText } from "@/ui/range.i18n";
import { Skeleton } from "@/ui/skeleton";
import { StatusLabel } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import type { L1Result, ProviderView, ProxyFault, ProxyView } from "@/types";
import { useText } from "@/i18n";
import type { UpstreamStats } from "./api";
import { egressOf, type Io } from "./data";
import { l1ErrorText, proxyFaultText, proxyKindLabel } from "./labels";
import { UpstreamChips, keepInRow, openRow } from "./parts";
import { proxyTableText } from "./ProxyTable.i18n";

/** 一个代理最近一次手动检测的结果。`running` = 正在检测；`at` = 什么时候测完的 */
export type ProxyCheck = { running: true } | { running: false; result: L1Result; at: number };

/**
 * 出站代理列表。**只读**：单击一行（或 Enter）编辑，行尾按钮和右键是同一份操作。
 *
 * 和上游表一样，名字下面一行说它是什么、在哪（类型 · 地址 · 是否认证）。这三样
 * 原来各占一列，最小窗口里七列放不下，行尾菜单被挤到视野外。
 *
 * 「流量 · 24 小时」是经过这个代理的上传加下载，悬停看 7 天、30 天：按流量计费的代理
 * 拿它对账。
 */
export function ProxyTable({
  proxies,
  providers,
  checks,
  egress,
  onEdit,
  onTest,
  onRemove,
}: {
  proxies: ProxyView[];
  /** 「使用上游」一列画标志要用 */
  providers: ProviderView[];
  checks: Record<string, ProxyCheck>;
  /** 按出口分的流量（`UpstreamStats.egress`）。统计还没到是 `undefined` */
  egress: UpstreamStats["egress"] | undefined;
  onEdit: (name: string) => void;
  onTest: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const t = useText(proxyTableText);
  const shown = usePresentList(proxies, (x) => x.name);
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t.proxy}</TableHead>
          <TableHead>{t.usedBy}</TableHead>
          <TableHead className="text-right">{t.traffic}</TableHead>
          <TableHead>{t.connectivity}</TableHead>
          <TableHead className="w-9">
            <span className="sr-only">{t.actionsColumn}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map(({ item: x, key, presence }) => {
          const items: MenuItems = [
            { kind: "item", label: t.edit, onSelect: () => onEdit(x.name) },
            { kind: "item", label: t.check, onSelect: () => onTest(x.name) },
            { kind: "sep" },
            { kind: "item", label: t.delete, onSelect: () => onRemove(x.name), danger: true },
          ];
          return (
            <RowMenu key={key} items={items}>
              <TableRow {...openRow(() => onEdit(x.name), rowMotion(presence))}>
                {/* 窄窗口里只有这一列收得动：名字下面那一行在「 · 」处折行，别的列和行尾菜单
                    留在视野里 */}
                <TableCell className="py-2 whitespace-normal">
                  <div className="font-medium">{x.name}</div>
                  <div className="tw-label text-muted-foreground">
                    {proxyKindLabel(x.kind)} · <span className="font-mono">{x.addr}</span>
                    {x.auth && ` · ${t.withAuth}`}
                  </div>
                </TableCell>
                <TableCell>
                  <UpstreamChips names={x.used_by} providers={providers} empty={t.notUsed} />
                </TableCell>
                <TableCell className="text-right">
                  <TrafficCell
                    windows={egress && [egressOf(egress[0], x.name), egressOf(egress[1], x.name), egressOf(egress[2], x.name)]}
                  />
                </TableCell>
                <TableCell>
                  <Connectivity check={checks[x.name]} fault={x.unreachable} />
                </TableCell>
                <TableCell className="text-right" {...keepInRow}>
                  <RowMenuButton items={items} label={t.actions(x.name)} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * 经过这个代理的流量：24 小时的上传加下载，下面一行分开写，悬停看 7 天、30 天。
 *
 * 24 小时里没有流量写「—」（多半是没有上游用它）；更早有的话悬停照样能看。**取不到写的
 * 也是「—」，但悬停说取不到** —— 一个说「没有」，一个说「不知道」。
 */
function TrafficCell({ windows }: { windows: [Io | null, Io | null, Io | null] | undefined }) {
  const t = useText(proxyTableText);
  const rt = useText(rangeText);
  if (!windows)
    return (
      <div className="flex flex-col items-end gap-1.5">
        <Skeleton className="h-3 w-12 rounded-sm" />
        <Skeleton className="h-2.5 w-20 rounded-sm" />
      </div>
    );
  const [day] = windows;
  const sum = (io: Io | null) => (io ? io.sent + io.received : 0);
  if (day === null)
    return (
      <Tip text={t.trafficUnavailable}>
        <span className="text-muted-foreground">—</span>
      </Tip>
    );
  const labels = [rt.preset["1d"], rt.preset["7d"], rt.preset["30d"]];
  const tip = (
    <div className="flex flex-col gap-0.5">
      <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        {windows.map((io, i) => (
          <div key={labels[i]} className="contents">
            <span className="text-background/60">{labels[i]}</span>
            <span className="text-right font-medium tw-num">{io ? traffic(sum(io)) : t.unavailableShort}</span>
          </div>
        ))}
      </div>
      <p className="mt-0.5 text-background/60">{t.trafficNote}</p>
    </div>
  );
  if (sum(day) === 0) {
    // 更早的流量也没有：就是没用过，没有可看的
    if (windows.every((io) => io !== null && sum(io) === 0)) return <span className="text-muted-foreground">—</span>;
    return (
      <Tip text={tip}>
        <span className="text-muted-foreground underline decoration-dotted underline-offset-2">—</span>
      </Tip>
    );
  }
  return (
    <div className="flex flex-col items-end">
      <Tip text={tip}>
        <span className="underline decoration-dotted underline-offset-2 tw-num">{traffic(sum(day))}</span>
      </Tip>
      <span className="tw-label text-muted-foreground tw-num whitespace-nowrap">
        {t.trafficSplit(traffic(day.sent), traffic(day.received))}
      </span>
    </div>
  );
}

/**
 * 通不通。**两个来源，哪个新用哪个**：用户手动测的，和网关转发失败之后自己检出来的。
 * 网关检出不通的时候，列上不能还挂着一小时前手动测出的「通」。
 */
function Connectivity({
  check,
  fault,
}: {
  check: ProxyCheck | undefined;
  fault: ProxyFault | null | undefined;
}) {
  const t = useText(proxyTableText);
  if (check?.running) {
    return (
      <StatusLabel tone="pending" muted>
        {t.checking}
      </StatusLabel>
    );
  }
  if (fault && (!check || fault.at_ms > check.at)) {
    return <Unreachable reason={proxyFaultText(fault)} />;
  }
  if (!check) {
    return (
      <StatusLabel tone="idle" muted>
        {t.notChecked}
      </StatusLabel>
    );
  }
  const r = check.result;
  if (!r.ok) return <Unreachable reason={l1ErrorText(r)} />;
  return (
    <StatusLabel tone="ok" muted className="tw-num">
      {ms(r.total_ms)}
    </StatusLabel>
  );
}

function Unreachable({ reason }: { reason: string }) {
  const t = useText(proxyTableText);
  return (
    <Tip text={reason}>
      <span className="inline-flex">
        <StatusLabel tone="error">{t.unreachable}</StatusLabel>
      </span>
    </Tip>
  );
}
