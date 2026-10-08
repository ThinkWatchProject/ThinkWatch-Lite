import { useText } from "@/i18n";
import { Tip } from "@/ui/tip";
import { priceSourceDetail } from "@/upstreams/labels";
import type { HistoryRow } from "@/types";
import { CostText, Row, Rows } from "./parts";
import { requestDrawerText } from "./RequestDrawer.i18n";

/**
 * 用量：几种 token、费用、价格来源。**没有用量、没有价格、估算，各说各的。**
 *
 * 三种输入各带一个色块，和概览的缓存构成条、会话详情的每轮输入同一套颜色。
 */
export function Usage({ r, running }: { r: HistoryRow; running: boolean }) {
  const t = useText(requestDrawerText);
  if (running) {
    // 用量在结局里才到，费用在落库时才算
    return <p className="text-muted-foreground">{t.usagePending}</p>;
  }
  if (r.input_tokens == null) {
    return (
      <p className="text-muted-foreground">
        {r.cancelled ? (
          // 这时候不能说「上游没有报用量」—— 它还没来得及报，客户端就走了
          t.cancelledBeforeUsage
        ) : r.error ? (
          // 失败的请求没有用量，**不是上游吞掉了它** —— 请求没走到那一步
          t.failedBeforeUsage
        ) : (
          // **没有 usage 不是「用了 0」**
          <>
            {t.noUsage}
            <Tip text={t.noUsageTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">{t.details}</span>
            </Tip>
          </>
        )}
      </p>
    );
  }
  const read = r.cache_read_tokens ?? 0;
  const write = r.cache_write_tokens ?? 0;
  const prompt = r.input_tokens + read + write;
  return (
    <div className="space-y-4">
      {prompt > 0 && (
        <div
          role="img"
          aria-label={t.inputMix(read.toLocaleString(), r.input_tokens.toLocaleString(), write.toLocaleString())}
          className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
        >
          {read > 0 && <span className="motion-bar bg-cache-hit" style={{ width: `${(read / prompt) * 100}%` }} />}
          {r.input_tokens > 0 && (
            <span className="motion-bar bg-cache-plain" style={{ width: `${(r.input_tokens / prompt) * 100}%` }} />
          )}
          {write > 0 && <span className="motion-bar bg-cache-write" style={{ width: `${(write / prompt) * 100}%` }} />}
        </div>
      )}
      <Rows className="tw-num">
        <Row label={t.cacheReads} swatch="bg-cache-hit" value={read.toLocaleString()} />
        <Row label={t.input} swatch="bg-cache-plain" value={r.input_tokens.toLocaleString()} />
        <Row label={t.cacheWrites} swatch="bg-cache-write" value={write.toLocaleString()} />
        <Row label={t.output} value={(r.output_tokens ?? 0).toLocaleString()} />
        {/* 费用另起一段：上面是用了多少，这里是按什么价钱算出多少 */}
        <div aria-hidden className="col-span-2 my-1.5 border-t border-border" />
        <Row label={t.cost} value={<CostText r={r} running={false} />} />
        {r.price_source && <Row label={t.priceSource} value={priceSourceDetail(r.price_source)} />}
      </Rows>
    </div>
  );
}
