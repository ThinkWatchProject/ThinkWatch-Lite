import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import type { Overview, PricingStatus } from "@/types";
import { formatMultiplier } from "./labels";
import { NameChips } from "./parts";

/** 按默认价目表计价的上游：没选价目表、而且按量计费 */
export function defaultSheetUsers(ov: Overview): string[] {
  return ov.providers
    .filter((p) => !p.pricing && (p.billing ?? p.billing_effective) === "per-token")
    .map((p) => p.name);
}

export function PriceSheetTable({
  ov,
  status,
  onViewDefault,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  ov: Overview;
  status: PricingStatus | null;
  onViewDefault: () => void;
  onEdit: (name: string) => void;
  onDuplicate: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const defaultItems: MenuItems = [
    { kind: "item", label: "查看价格…", onSelect: onViewDefault },
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>定价依据</TableHead>
          <TableHead>倍率</TableHead>
          <TableHead>模型覆盖</TableHead>
          <TableHead>使用上游</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <RowMenu items={defaultItems}>
          <TableRow onDoubleClick={onViewDefault} className="cursor-default">
            <TableCell className="py-2">
              <span className="font-medium">默认价目表</span>
            </TableCell>
            <TableCell className="py-2">
              LiteLLM 公开价格
              {status && (
                <div className="tw-label tabular-nums text-muted-foreground">
                  {status.source === "empty"
                    ? "未加载"
                    : `数据日期 ${status.date} · ${status.models.toLocaleString()} 个模型`}
                </div>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell>
              <NameChips names={defaultSheetUsers(ov)} empty="未被使用" />
            </TableCell>
            <TableCell className="text-right">
              <RowMenuButton items={defaultItems} label="默认价目表的操作" />
            </TableCell>
          </TableRow>
        </RowMenu>
        {ov.price_sheets.map((s) => {
          const items: MenuItems = [
            { kind: "item", label: "编辑…", onSelect: () => onEdit(s.name) },
            { kind: "item", label: "复制…", onSelect: () => onDuplicate(s.name) },
            { kind: "sep" },
            {
              kind: "item",
              label: "删除…",
              onSelect: () => onRemove(s.name),
              danger: true,
            },
          ];
          return (
            <RowMenu key={s.name} items={items}>
              <TableRow onDoubleClick={() => onEdit(s.name)} className="cursor-default">
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>默认价目表</TableCell>
                <TableCell className="tabular-nums">× {formatMultiplier(s.multiplier)}</TableCell>
                <TableCell className="tabular-nums">{s.overrides} 项</TableCell>
                <TableCell>
                  <NameChips names={s.used_by} empty="未被使用" />
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={`${s.name} 的操作`} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}
