import type { Resource } from "@/lib/resource";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { when } from "@/format";
import type { Overview, PricingStatus } from "@/types";
import { useText } from "@/i18n";
import { formatMultiplier } from "./labels";
import { UpstreamChips, keepInRow, openRow } from "./parts";
import { priceSheetTableText } from "./PriceSheetTable.i18n";

/** 按默认价目表计价的上游：没选价目表、而且按量计费 */
export function defaultSheetUsers(ov: Overview): string[] {
  return ov.providers
    .filter((p) => !p.pricing && p.billing === "per-token")
    .map((p) => p.name);
}

/**
 * 价目表列表：第一行是默认价目表（联网拉取的公开价格，只读），其后是自定义价目表。
 * 单击一行打开它：默认价目表是查看，自定义的是编辑。
 */
export function PriceSheetTable({
  ov,
  status,
  onViewDefault,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  ov: Overview;
  status: Resource<PricingStatus>;
  onViewDefault: () => void;
  onEdit: (name: string) => void;
  onDuplicate: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const t = useText(priceSheetTableText);
  const defaultItems: MenuItems = [{ kind: "item", label: t.viewPrices, onSelect: onViewDefault }];
  const shown = usePresentList(ov.price_sheets, (s) => s.name);
  const s = status.data;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t.name}</TableHead>
          <TableHead>{t.basis}</TableHead>
          <TableHead>{t.multiplier}</TableHead>
          <TableHead>{t.overrides}</TableHead>
          <TableHead>{t.usedBy}</TableHead>
          <TableHead className="w-9">
            <span className="sr-only">{t.actionsColumn}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <RowMenu items={defaultItems}>
          <TableRow {...openRow(onViewDefault)}>
            <TableCell className="py-2">
              <span className="font-medium">{t.defaultSheet}</span>
            </TableCell>
            {/* 这一格的小字最长（数据日期、模型数、最近检查）：窗口窄时折行，不把整张表撑出横向滚动 */}
            <TableCell className="py-2 whitespace-normal">
              {t.litellm}
              <div className="tw-label tw-num text-muted-foreground">
                {s ? (
                  s.source === "empty" ? (
                    t.notLoaded
                  ) : (
                    <>
                      {t.dataInfo(s.date, s.models)}
                      {s.checked_at_ms != null && ` · ${t.lastChecked(when(s.checked_at_ms))}`}
                    </>
                  )
                ) : status.loading ? (
                  <Skeleton className="mt-1 h-2.5 w-44 rounded-sm" />
                ) : (
                  "—"
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell className="text-muted-foreground">—</TableCell>
            <TableCell>
              <UpstreamChips names={defaultSheetUsers(ov)} providers={ov.providers} empty={t.notUsed} />
            </TableCell>
            <TableCell className="text-right" {...keepInRow}>
              <RowMenuButton items={defaultItems} label={t.defaultActions} />
            </TableCell>
          </TableRow>
        </RowMenu>
        {shown.map(({ item: sheet, key, presence }) => {
          const items: MenuItems = [
            { kind: "item", label: t.edit, onSelect: () => onEdit(sheet.name) },
            { kind: "item", label: t.duplicate, onSelect: () => onDuplicate(sheet.name) },
            { kind: "sep" },
            { kind: "item", label: t.delete, onSelect: () => onRemove(sheet.name), danger: true },
          ];
          return (
            <RowMenu key={key} items={items}>
              <TableRow {...openRow(() => onEdit(sheet.name), rowMotion(presence))}>
                <TableCell className="font-medium">{sheet.name}</TableCell>
                <TableCell>{t.defaultSheet}</TableCell>
                <TableCell className="tw-num">× {formatMultiplier(sheet.multiplier)}</TableCell>
                <TableCell className="tw-num">{t.overrideCount(sheet.overrides)}</TableCell>
                <TableCell>
                  <UpstreamChips names={sheet.used_by} providers={ov.providers} empty={t.notUsed} />
                </TableCell>
                <TableCell className="text-right" {...keepInRow}>
                  <RowMenuButton items={items} label={t.actions(sheet.name)} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}
