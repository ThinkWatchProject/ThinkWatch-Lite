import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { StatusLabel } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import type { L1Result, ProviderView, ProxyFault, ProxyView } from "@/types";
import { useText } from "@/i18n";
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
 */
export function ProxyTable({
  proxies,
  providers,
  checks,
  onEdit,
  onTest,
  onRemove,
}: {
  proxies: ProxyView[];
  /** 「使用上游」一列画标志要用 */
  providers: ProviderView[];
  checks: Record<string, ProxyCheck>;
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
                <TableCell className="py-2">
                  <div className="font-medium">{x.name}</div>
                  <div className="tw-label text-muted-foreground">
                    {proxyKindLabel(x.kind)} · <span className="font-mono">{x.addr}</span>
                    {x.has_auth && ` · ${t.withAuth}`}
                  </div>
                </TableCell>
                <TableCell>
                  <UpstreamChips names={x.used_by} providers={providers} empty={t.notUsed} />
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
      {t.ms(r.total_ms)}
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
