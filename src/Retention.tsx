import { Fragment } from "react";
import { useText } from "@/i18n";
import type { Overview } from "@/types";
import { EditableCell } from "./access/EditableCell";
import { retentionText } from "./Retention.i18n";

/**
 * 日志留多久。
 *
 * **两个期限，因为两样东西的代价差三个数量级。**一条正文几十 KB，忙一天
 * 就是几百 MB；一行记录（时刻、模型、用量、金额）几百字节，留一个季度
 * 也不过几十 MB。合成一个期限，要么早早丢掉「上个月花了多少」，要么让
 * 磁盘替正文买单。
 *
 * **总量上限旁边要写现在占了多少。**「2 GB」这个数字，用户没法判断松还是
 * 紧 —— 除非同时看得见当下的占用。
 */
export function RetentionSection({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const t = useText(retentionText);
  const r = ov.retention;
  // 老 core 没有这一段。**整节不画，而不是画一排空格子**
  if (!r) return null;

  const rows: [string, string, string, string][] = [
    [t.bodyDays, String(r.body_days), "/retention/body_days", t.bodyDaysWhat],
    [t.rowDays, String(r.row_days), "/retention/row_days", t.rowDaysWhat],
    [
      t.bodyMax,
      String(r.body_max_bytes),
      "/retention/body_max_bytes",
      t.bodyMaxWhat(gib(r.body_max_bytes)),
    ],
  ];

  return (
    <section>
      <h2 className="tw-title font-semibold">{t.title}</h2>
      <p className="mt-1 tw-body text-muted-foreground">{t.intro}</p>
      <dl className="mt-2 grid grid-cols-[auto_auto_1fr] items-baseline gap-x-4 gap-y-1 tw-body">
        {rows.map(([label, value, path, what]) => (
          <Fragment key={path}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono">
              <EditableCell
                value={value}
                path={path}
                version={configVersion}
                numeric
              />
            </dd>
            <dd className="tw-label text-muted-foreground">{what}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="mt-2 tw-label text-muted-foreground">
        {t.usedNow(bytes(r.body_bytes_now), gib(r.body_max_bytes))}
      </p>
    </section>
  );
}

/** 上限写成 GiB —— 配置里是字节，而人读的是「几个 G」 */
function gib(n: number): string {
  const g = n / (1024 * 1024 * 1024);
  return g >= 10 || Number.isInteger(g) ? String(Math.round(g)) : g.toFixed(1);
}

function bytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${gib(n)} GB`;
  if (n >= 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
