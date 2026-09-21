import { Fragment } from "react";
import { useText } from "@/i18n";
import type { Overview } from "@/types";
import { accessText } from "./Access.i18n";
import { EditableCell } from "./EditableCell";

/**
 * 并发。
 *
 * **四个数是同一个闸门上的四处。**「单个上游」看起来该归上游页，但它不是
 * 给某一家设的，是「任何一家都不超过 N」—— 拆开之后没有一处说得清它们
 * 怎么相互作用。每把密钥自己的上限是另一回事，它按身份分配，在上面那张
 * 表的一列里。
 */
export function Limits({
  ov,
  configVersion,
}: {
  ov: Overview;
  configVersion: string | null;
}) {
  const t = useText(accessText);
  const l = ov.limits;
  if (!l) return null;
  const rows: [string, keyof typeof l, string][] = [
    [t.maxConcurrent, "max_concurrent", t.maxConcurrentWhat],
    [t.perProvider, "per_provider", t.perProviderWhat],
    [t.queueDepth, "queue_depth", t.queueDepthWhat],
    [t.queueTimeout, "queue_timeout_secs", t.queueTimeoutWhat],
  ];
  return (
    <section>
      <h2 className="tw-title font-semibold">{t.limitsTitle}</h2>
      <p className="mt-1 tw-body text-muted-foreground">{t.limitsIntro}</p>
      <dl className="mt-2 grid grid-cols-[auto_auto_1fr] items-baseline gap-x-4 gap-y-1 tw-body">
        {rows.map(([label, key, what]) => (
          <Fragment key={key}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono">
              <EditableCell
                value={String(l[key])}
                path={`/limits/${key}`}
                version={configVersion}
                numeric
              />
            </dd>
            <dd className="tw-label text-muted-foreground">{what}</dd>
          </Fragment>
        ))}
      </dl>
      <p className="mt-2 tw-label text-muted-foreground">{t.perKeyNote}</p>
    </section>
  );
}
