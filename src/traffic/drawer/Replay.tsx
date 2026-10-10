import { useMemo, useState } from "react";
import { call } from "@/control";
import { useText } from "@/i18n";
import { ms, traffic } from "@/format";
import { useResource } from "@/lib/resource";
import { Button } from "@/ui/button";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { notify } from "@/ui/notify";
import { ErrorState } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { quoteText } from "@/labels";
import { prettyJson } from "@/prettyJson";
import type { ReplayQuote, ReplayResult } from "@/types";
import { BodyText } from "./Payload";
import { requestDrawerText } from "./RequestDrawer.i18n";

/**
 * 眼前能拿去「确认发送」的那份报价：**报的是下拉框里此刻选着的那一家**，否则作废。
 *
 * 报价在路上的时候换了选择（或者上游列表刷新了、默认的那一家换了），回来的是上一家的
 * 报价。原来它照样显示出来，点「确认发送」发的却是此刻选着的那一家 —— 一家没报过价的。
 * 发送也按报价上的那一家发（`quote.provider`），两边对不上就要重新报价。导出给测试用。
 */
export function quoteFor(quote: ReplayQuote | null, selected: string): ReplayQuote | null {
  return quote !== null && quote.provider === selected ? quote : null;
}

/**
 * 把这条请求原样发给另一个上游。
 *
 * 用途只有一个，但它是这个工具最常被需要的那一个：**这条请求走中转慢或者失败了，
 * 同样一条发给官方会怎么样？**手工复现一个 Claude Code 的请求几乎不可能 —— 那是
 * 几十 KB 的 system prompt 加一堆工具定义，而任何一处不同都会让对比失去意义。
 * 记录里正好有原样的那一份。
 *
 * **它会产生费用**，所以和测速一样是三步：选上游 → 看报价 → 点确认。中间那一步不能
 * 省 —— 发出之前必须显示预估的费用，而不是发了才知道。报价和发送在路上时下拉框不能动，
 * 发的是报过价的那一家（`quoteFor`）。
 */
export function Replay({ id, originalProvider }: { id: number; originalProvider: string }) {
  const t = useText(requestDrawerText);
  // 上游列表。取不到就在这里说、给「重试」—— 原来只弹一个 toast，下拉框就一直灰着
  const ov = useResource("overview", () => call("Overview", null), { events: ["config_reloaded"] });
  const names = ov.data?.providers.map((p) => p.name) ?? [];
  /** 选中的那个。没动过就是默认的那个：**和原来那次不同的**上游 —— 重放的价值在对比 */
  const [picked, setPicked] = useState<string | null>(null);
  const provider =
    picked !== null && names.includes(picked)
      ? picked
      : (names.find((n) => n !== originalProvider) ?? names[0] ?? "");
  const [quote, setQuote] = useState<ReplayQuote | null>(null);
  /** 能拿去确认的那份：报的是此刻选着的那一家。别的那一家的作废 */
  const current = quoteFor(quote, provider);
  const [result, setResult] = useState<ReplayResult | null>(null);
  /** 哪一步在等：报价，还是发送 */
  const [busy, setBusy] = useState<"quote" | "run" | null>(null);
  // 重放的响应体只留开头两万字，截了也不说；截断的 parse 不了，就原样显示
  const pretty = useMemo(() => (result ? prettyJson(result.body, false) : null), [result]);

  async function ask() {
    setBusy("quote");
    setResult(null);
    try {
      setQuote(await call("ReplayQuote", { id, provider }));
    } catch (e) {
      notify.error(e);
      setQuote(null);
    } finally {
      setBusy(null);
    }
  }

  async function go() {
    if (!current) return;
    setBusy("run");
    try {
      // **发给报过价的那一家**，不是发送这一刻下拉框里选着的
      setResult(await call("ReplayRun", { id, provider: current.provider }));
      setQuote(null);
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {t.replayIntro((x) => <span className="font-medium text-foreground">{x}</span>)}
        <Tip text={t.asIsTip}>
          <span className="ml-1 underline decoration-dotted underline-offset-2">{t.asIs}</span>
        </Tip>
      </p>
      {ov.error !== undefined && !ov.data ? (
        <ErrorState
          compact
          title={t.upstreamsFailed}
          error={ov.error}
          onRetry={() => void ov.reload()}
          retrying={ov.loading}
        />
      ) : (
        <div className="flex items-center gap-2">
          <NativeSelect
            size="sm"
            value={provider}
            // 报价、发送在路上时不能换：换了的话，回来的报价和要发的不是同一家
            disabled={!ov.data || busy !== null}
            onChange={(e) => {
              setPicked(e.target.value);
              setQuote(null);
            }}
          >
            {names.map((n) => (
              <NativeSelectOption key={n} value={n}>
                {n}
                {n === originalProvider ? t.originalUpstream : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            pending={busy === "quote"}
            disabled={busy !== null || !provider}
            onClick={() => void ask()}
          >
            {t.estimateCost}
          </Button>
        </div>
      )}

      {current && (
        <div className="space-y-1 rounded-lg border border-border px-3 py-2.5 motion-fade">
          {/* **发出之前必须显示预估的费用**，而不是发了才知道 */}
          <p>{t.quote(<span className="font-medium">{current.provider}</span>, current.body_bytes, current.input_tokens)}</p>
          <p className="font-medium tw-num">{quoteText(current)}</p>
          {current.will_redact && <p className="text-muted-foreground">{t.willRedact}</p>}
          <p className="tw-label text-muted-foreground">{t.pricingDate(current.pricing_date)}</p>
          <div className="pt-2">
            <Button size="sm" pending={busy === "run"} disabled={busy !== null} onClick={() => void go()}>
              {t.confirmSend}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border px-3 pt-1 pb-3 motion-fade">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead />
                <TableHead className="text-right">{t.originalColumn(result.original.provider)}</TableHead>
                <TableHead className="text-right">{t.replayColumn(result.provider)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tw-num">
              <Cmp label={t.status} a={result.original.status} b={result.status} format={String} />
              <Cmp label={t.ttfb} a={result.original.ttfb_ms} b={result.ttfb_ms} format={ms} />
              <Cmp label={t.duration} a={result.original.duration_ms} b={result.duration_ms} format={ms} />
              {/* 从上游收到的响应体（解压之前）。原来那次是每一跳加起来，重放只有一跳 */}
              <Cmp label={t.download} a={result.original.received_bytes} b={result.bytes} format={traffic} />
            </TableBody>
          </Table>
          <BodyText
            text={pretty ?? result.body}
            json={pretty != null}
            className="mt-3 max-h-64 rounded-lg border border-border bg-surface px-3 py-2.5"
          />
        </div>
      )}
    </div>
  );
}

/** 对比表的一行。耗时按 `ms` 写、字节按 `traffic` 写，和流量表、时间线一样；状态码照原数 */
function Cmp({
  label,
  a,
  b,
  format = (n) => n.toLocaleString(),
}: {
  label: string;
  a: number | null | undefined;
  b: number;
  format?: (n: number) => string;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="text-muted-foreground">{label}</TableCell>
      {/* **原来那次可能没有这个数**（失败的请求没有耗时）。写「—」而不是 0 */}
      <TableCell className="text-right">{a == null ? "—" : format(a)}</TableCell>
      <TableCell className="text-right font-medium">{format(b)}</TableCell>
    </TableRow>
  );
}
