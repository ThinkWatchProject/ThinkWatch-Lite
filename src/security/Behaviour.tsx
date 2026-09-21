import { Alert, AlertDescription } from "@/ui/alert";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { driftLabel } from "@/labels";
import type { BaselineResponse } from "@/types";
import { securityText } from "@/Security.i18n";

/**
 * 上游行为基线（防线三）。
 *
 * > 某个中转站用了三个月一直正常，某天开始返回大量 bash 调用 ——
 * > 这是统计异常，值得告警。
 *
 * **报数字，不报结论。**「最近 24 小时 40%，之前 30 天 3%（样本
 * 120 / 4,200）」比「检测到异常」有用得多 —— 后者用户没法验证，也没法
 * 判断该不该管。样本不够的时候这一块什么都不说。
 */
export function Behaviour({ b }: { b: BaselineResponse }) {
  const t = useText(securityText);
  if (b.unavailable) {
    // **「不是没发现，是没看」**要说出来
    return (
      <section>
        <h2 className="mb-1 tw-head font-medium">{t.behavior}</h2>
        <p className="tw-body text-muted-foreground">
          {t.unobserved}
          <Tip text={t.cannotCompareTip}>
            <span className="ml-1 underline decoration-dotted underline-offset-2">
              {t.cannotCompare}
            </span>
          </Tip>
        </p>
      </section>
    );
  }
  const withDrift = b.providers.filter((p) => p.drifts.length > 0);
  const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
  return (
    <section>
      <h2 className="mb-1 tw-head font-medium">{t.behavior}</h2>
      <p className="mb-2 tw-body text-muted-foreground">
        {t.period(b.recent_hours, b.baseline_days)}
        <Tip text={t.sampleRuleTip}>
          <span className="ml-1 underline decoration-dotted underline-offset-2">
            {t.sampleRule}
          </span>
        </Tip>
      </p>
      {withDrift.length === 0 ? (
        // 没风险的时候要说「安全」，而不是让这一块消失
        <Alert variant="default" className="px-3 py-2">
          <AlertDescription>
            ✓ {t.steady}
            {b.providers.length > 0 && (
              <span className="ml-1 text-emerald-700 dark:text-emerald-400">
                {t.compared(b.providers.map((p) => p.provider))}
              </span>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <ul className="space-y-2">
          {withDrift.map((p) => (
            <li
              key={p.provider}
              className="rounded border border-amber-200 bg-amber-50 px-3 py-2 tw-body dark:border-amber-900 dark:bg-amber-950"
            >
              <div className="font-medium">{t.changed(p.provider)}</div>
              {p.drifts.map((d) => (
                <div key={d.metric} className="mt-1">
                  {t.metric(driftLabel(d.metric))}
                  <span className="font-medium">{pct(d.recent)}</span>
                  <span className="text-muted-foreground">
                    {t.before(pct(d.baseline))}
                    {/* **样本量必须一起给** —— 没有它，比率是个没法判断
                        可信度的数字 */}
                    {t.samples(d.recent_n, d.baseline_n)}
                  </span>
                </div>
              ))}
              {/* 数过形状的和总数不同时要说清楚 */}
              {p.recent_inspected < p.recent_total && (
                <div className="mt-1 text-muted-foreground">
                  {t.inspected(p.recent_inspected, p.recent_total)}
                  <Tip text={t.uninspectedTip}>
                    <span className="ml-1 underline decoration-dotted underline-offset-2">
                      {t.uninspected}
                    </span>
                  </Tip>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
