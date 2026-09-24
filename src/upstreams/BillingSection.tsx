import { CircleAlertIcon, PencilIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Segmented } from "@/ui/segmented";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { useText } from "@/i18n";
import type { Overview, ResolvedPrice } from "@/types";
import { billingSectionText } from "./BillingSection.i18n";
import { BILLINGS, PRICE_COLUMNS, perMillion, priceSourceLabel } from "./labels";
import { Boxed, FormItem, Note, UpstreamChips } from "./parts";
import type { UpstreamForm } from "./upstreamForm";

/** 「新建价目表…」在下拉里的占位值。名称首尾不能有空白，不会和真实名称重复 */
const NEW_SHEET = " new-sheet";

export function BillingSection({
  form,
  set,
  ov,
  originalName,
  models,
  prices,
  onNewSheet,
  onEditSheet,
  onPriceModels,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  ov: Overview;
  /** 编辑时原来的名称。算「使用此价目表的上游」要把它换成表单里的名字 */
  originalName: string | null;
  /** 启用范围内的模型 */
  models: string[];
  prices: Record<string, ResolvedPrice>;
  onNewSheet: () => void;
  onEditSheet: (name: string) => void;
  /** 为无法计价的模型设置价格：已选自定义价目表就在其中覆盖，否则新建一张 */
  onPriceModels: (models: string[]) => void;
}) {
  const t = useText(billingSectionText);
  const perToken = form.billing === "per-token";
  const unpriced = models.filter((m) => prices[m] && !prices[m].price);
  const sheet = ov.price_sheets.find((s) => s.name === form.pricing);
  const users = sheet
    ? [
        ...new Set([
          ...sheet.used_by.filter((u) => u !== originalName),
          form.name || t.newUpstream,
        ]),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormItem label={t.billing} desc={BILLINGS.find((b) => b.id === form.billing)?.desc}>
          <Segmented
            label={t.billing}
            value={form.billing}
            options={BILLINGS.map((b) => ({ id: b.id, label: b.label }))}
            onChange={(billing) => set({ billing })}
          />
        </FormItem>
        {/* 不计费时价目表用不上，整个藏起来，而不是摆一个灰掉的下拉 */}
        {perToken && (
          <FormItem label={t.sheet} htmlFor="up-sheet">
            <NativeSelect
              id="up-sheet"
              className="w-full"
              value={form.pricing}
              onChange={(e) =>
                e.target.value === NEW_SHEET ? onNewSheet() : set({ pricing: e.target.value })
              }
            >
              <NativeSelectOption value="">{t.defaultSheet}</NativeSelectOption>
              {ov.price_sheets.map((s) => (
                <NativeSelectOption key={s.name} value={s.name}>
                  {s.name}
                </NativeSelectOption>
              ))}
              {form.pricing && !sheet && (
                <NativeSelectOption value={form.pricing}>{form.pricing}</NativeSelectOption>
              )}
              <NativeSelectOption value={NEW_SHEET}>{t.newSheet}</NativeSelectOption>
            </NativeSelect>
          </FormItem>
        )}
      </div>

      {perToken && sheet && (
        <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
          <span className="shrink-0 tw-label text-muted-foreground">{t.usedBy}</span>
          <UpstreamChips names={users} providers={ov.providers} empty="" />
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onEditSheet(sheet.name)}>
            <PencilIcon />
            {t.editSheet}
          </Button>
        </div>
      )}

      {perToken && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="tw-body font-medium">{t.effective}</span>
            <div className="flex-1" />
            <span className="tw-label text-muted-foreground">{t.unit}</span>
          </div>
          {models.length === 0 ? (
            <Note>{t.empty}</Note>
          ) : (
            <Boxed className="max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.model}</TableHead>
                    {PRICE_COLUMNS.map((c) => (
                      <TableHead key={c.key} className="text-right">
                        {c.label}
                      </TableHead>
                    ))}
                    <TableHead>{t.source}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {models.map((m) => {
                    const r = prices[m];
                    return (
                      <TableRow key={m}>
                        <TableCell className="font-mono">{m}</TableCell>
                        {PRICE_COLUMNS.map((c) => (
                          <TableCell key={c.key} className="text-right tw-num">
                            {perMillion(r?.price?.[c.key])}
                          </TableCell>
                        ))}
                        <TableCell className={r?.price ? "text-muted-foreground" : "text-warning"}>
                          {r ? priceSourceLabel(r.source) : "—"}
                          {r?.estimated && t.estimated}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Boxed>
          )}
          {unpriced.length > 0 && (
            <div className="flex items-center gap-2 tw-label text-warning">
              <CircleAlertIcon className="size-3.5 shrink-0" />
              <span>{t.unpriced(unpriced.length)}</span>
              <div className="flex-1" />
              <Button variant="outline" size="xs" onClick={() => onPriceModels(unpriced)}>
                {t.setPrices}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
