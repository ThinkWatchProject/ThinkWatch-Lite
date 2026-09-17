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
import type { L1Result, ProxyView } from "@/types";
import { proxyKindLabel } from "./labels";
import { NameChips, StatusDot } from "./parts";

/** 一个代理最近一次检测的结果。`running` = 正在检测 */
export type ProxyCheck = { running: true } | { running: false; result: L1Result };

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
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>地址</TableHead>
          <TableHead>认证</TableHead>
          <TableHead>使用上游</TableHead>
          <TableHead>连通性</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {proxies.map((x) => {
          const items: MenuItems = [
            { kind: "item", label: "编辑…", onSelect: () => onEdit(x.name) },
            { kind: "item", label: "检测代理", onSelect: () => onTest(x.name) },
            { kind: "sep" },
            { kind: "item", label: "删除…", onSelect: () => onRemove(x.name), danger: true },
          ];
          return (
            <RowMenu key={x.name} items={items}>
              <TableRow onDoubleClick={() => onEdit(x.name)} className="cursor-default">
                <TableCell className="font-mono font-medium">{x.name}</TableCell>
                <TableCell>{proxyKindLabel(x.kind)}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{x.addr}</TableCell>
                <TableCell className={x.has_auth ? "" : "text-muted-foreground"}>
                  {x.has_auth ? "用户名与密码" : "无"}
                </TableCell>
                <TableCell>
                  <NameChips names={x.used_by} empty="未被使用" />
                </TableCell>
                <TableCell>
                  <Connectivity check={checks[x.name]} />
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={`${x.name} 的操作`} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Connectivity({ check }: { check: ProxyCheck | undefined }) {
  if (!check) return <span className="text-muted-foreground">未检测</span>;
  if (check.running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Spinner />
        检测中
      </span>
    );
  }
  const r = check.result;
  if (!r.ok) {
    return (
      <span title={r.error ?? undefined}>
        <StatusDot tone="bad">无法连接</StatusDot>
      </span>
    );
  }
  return <StatusDot tone="ok">{r.total_ms.toLocaleString()} ms</StatusDot>;
}
