import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Spinner } from "@/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import type { L1Result, ProxyFault, ProxyView } from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { l1ErrorText, proxyFaultText, proxyKindLabel } from "./labels";
import { NameChips, StatusDot } from "./parts";
import { proxyTableText } from "./ProxyTable.i18n";

/** 一个代理最近一次手动检测的结果。`running` = 正在检测；`at` = 什么时候测完的 */
export type ProxyCheck = { running: true } | { running: false; result: L1Result; at: number };

export function ProxyTable({
  proxies,
  checks,
  onEdit,
  onTest,
  onRemove,
}: {
  proxies: ProxyView[];
  checks: Record<string, ProxyCheck>;
  onEdit: (name: string) => void;
  onTest: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const t = useText(proxyTableText);
  const common = useText(commonText);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.name}</TableHead>
          <TableHead>{t.kind}</TableHead>
          <TableHead>{t.address}</TableHead>
          <TableHead>{t.auth}</TableHead>
          <TableHead>{t.usedBy}</TableHead>
          <TableHead>{t.connectivity}</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {proxies.map((x) => {
          const items: MenuItems = [
            { kind: "item", label: t.edit, onSelect: () => onEdit(x.name) },
            { kind: "item", label: t.check, onSelect: () => onTest(x.name) },
            { kind: "sep" },
            { kind: "item", label: t.delete, onSelect: () => onRemove(x.name), danger: true },
          ];
          return (
            <RowMenu key={x.name} items={items}>
              <TableRow onDoubleClick={() => onEdit(x.name)} className="cursor-default">
                <TableCell className="font-mono font-medium">{x.name}</TableCell>
                <TableCell>{proxyKindLabel(x.kind)}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{x.addr}</TableCell>
                <TableCell className={x.has_auth ? "" : "text-muted-foreground"}>
                  {x.has_auth ? t.userPass : common.none}
                </TableCell>
                <TableCell>
                  <NameChips names={x.used_by} empty={t.notUsed} />
                </TableCell>
                <TableCell>
                  <Connectivity check={checks[x.name]} fault={x.unreachable} />
                </TableCell>
                <TableCell className="text-right">
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
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Spinner />
        {t.checking}
      </span>
    );
  }
  if (fault && (!check || fault.at_ms > check.at)) {
    return (
      <span title={proxyFaultText(fault)}>
        <StatusDot tone="bad">{t.unreachable}</StatusDot>
      </span>
    );
  }
  if (!check) return <span className="text-muted-foreground">{t.notChecked}</span>;
  const r = check.result;
  if (!r.ok) {
    return (
      <span title={l1ErrorText(r)}>
        <StatusDot tone="bad">{t.unreachable}</StatusDot>
      </span>
    );
  }
  return <StatusDot tone="ok">{r.total_ms.toLocaleString()} ms</StatusDot>;
}
