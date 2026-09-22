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
import { useText } from "@/i18n";
import { formatMultiplier } from "./labels";
import { NameChips } from "./parts";
import { priceSheetTableText } from "./PriceSheetTable.i18n";

/** 按默认价目表计价的上游：没选价目表、而且按量计费 */
export function defaultSheetUsers(ov: Overview): string[] {
  return ov.providers
    .filter((p) => !p.pricing && p.billing === "per-token")
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
  const t = useText(priceSheetTableText);
  const defaultItems: MenuItems = [
    { kind: "item", label: t.viewPrices, onSelect: onViewDefault },
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.name}</TableHead>
          <TableHead>{t.basis}</TableHead>
          <TableHead>{t.multiplier}</TableHead>
          <TableHead>{t.overrides}</TableHead>
          <TableHead>{t.usedBy}</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        <RowMenu items={defaultItems}>
          <TableRow onDoubleClick={onViewDefault} className="cursor-default">
            <TableCell className="py-2">
              <span className="font-medium">{t.defaultSheet}</span>
            </TableCell>
            <TableCell className="py-2">
              {t.litellm}
              {status && (
                <div className="tw-label tabular-nums text-muted-foreground">
                  {status.source === "empty" ? t.notLoaded : t.dataInfo(status.date, status.models)}
                </div>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell>
              <NameChips names={defaultSheetUsers(ov)} empty={t.notUsed} />
            </TableCell>
            <TableCell className="text-right">
              <RowMenuButton items={defaultItems} label={t.defaultActions} />
            </TableCell>
          </TableRow>
        </RowMenu>
        {ov.price_sheets.map((s) => {
          const items: MenuItems = [
            { kind: "item", label: t.edit, onSelect: () => onEdit(s.name) },
            { kind: "item", label: t.duplicate, onSelect: () => onDuplicate(s.name) },
            { kind: "sep" },
            {
              kind: "item",
              label: t.delete,
              onSelect: () => onRemove(s.name),
              danger: true,
            },
          ];
          return (
            <RowMenu key={s.name} items={items}>
              <TableRow onDoubleClick={() => onEdit(s.name)} className="cursor-default">
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{t.defaultSheet}</TableCell>
                <TableCell className="tabular-nums">× {formatMultiplier(s.multiplier)}</TableCell>
                <TableCell className="tabular-nums">{t.overrideCount(s.overrides)}</TableCell>
                <TableCell>
                  <NameChips names={s.used_by} empty={t.notUsed} />
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={t.actions(s.name)} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}
