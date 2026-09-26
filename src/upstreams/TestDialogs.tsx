import { useEffect, useMemo, useState } from "react";
import { ActivityIcon, ZapIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Skeleton } from "@/ui/skeleton";
import { TableSkeleton } from "@/ui/states";
import { StatusLabel } from "@/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import {
  usd,
  type L1Result,
  type Overview,
  type ProviderTestResult,
  type SpeedQuote,
  type SpeedResult,
} from "@/types";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import { api } from "./api";
import { TestLine } from "./ConnectionSection";
import {
  billingSummary,
  egressLabel,
  errorText,
  l1ErrorText,
  l1SkipText,
  l1StageLabel,
  plain,
  skipLabel,
} from "./labels";
import { Boxed, DialogError, FormItem, Note, VendorTile } from "./parts";
import { testDialogsText } from "./TestDialogs.i18n";
import { formFromView, toInput } from "./upstreamForm";

/** 行菜单里的「检测连接」：用已保存的配置检测一次 */
export function TestConnectionDialog({
  ov,
  name,
  onClose,
}: {
  ov: Overview;
  name: string;
  onClose: () => void;
}) {
  const t = useText(testDialogsText);
  const common = useText(commonText);
  const p = ov.providers.find((x) => x.name === name);
  const [result, setResult] = useState<ProviderTestResult | null>(null);

  useEffect(() => {
    if (!p) return;
    let alive = true;
    api
      .testProvider({ provider: toInput(formFromView(p)), current: p.name })
      .then((r) => alive && setResult(r))
      .catch(
        (e) =>
          alive &&
          setResult({ ok: false, protocol: null, latency_ms: 0, models: { kind: "empty" }, error: plain(errorText(e)) }),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.connection.title}</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-foreground">{name}</span> · {t.connection.desc}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-10 items-center rounded-lg border border-border px-3 py-2.5">
          {result ? (
            <TestLine result={result} bordered={false} />
          ) : (
            <StatusLabel tone="pending" muted>
              {t.connection.checking}
            </StatusLabel>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 链路测速：DNS、TCP、TLS 各阶段耗时。只握手，不产生费用 */
export function LinkTestDialog({
  ov,
  provider,
  onClose,
}: {
  ov: Overview;
  /** null = 全部上游 */
  provider: string | null;
  onClose: () => void;
}) {
  const t = useText(testDialogsText);
  const common = useText(commonText);
  const [results, setResults] = useState<L1Result[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResults(await api.linkTest(provider));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.link.title}</DialogTitle>
          <DialogDescription>
            {provider ? (
              <>
                <span className="font-mono text-foreground">{provider}</span> ·{" "}
              </>
            ) : (
              `${t.link.allUpstreams} · `
            )}
            {t.link.desc}
          </DialogDescription>
        </DialogHeader>
        <DialogError error={error} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {results == null ? (
            error ? null : (
              <Boxed>
                <TableSkeleton rows={Math.max(1, provider ? 1 : ov.providers.length)} cols={4} />
              </Boxed>
            )
          ) : results.length === 0 ? (
            <Note>{t.link.empty}</Note>
          ) : (
            <Boxed>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.upstream}</TableHead>
                    <TableHead>{t.link.via}</TableHead>
                    <TableHead>{t.link.stages}</TableHead>
                    <TableHead className="text-right">{t.total}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.target} className="motion-fade">
                      <TableCell className="align-top">
                        <UpstreamName ov={ov} name={r.target} />
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground">
                        {r.via ? egressLabel(r.via) : t.link.direct}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        {r.ok ? (
                          <span className="tw-num">
                            {r.segments.map((s) => `${l1StageLabel(s.stage)} ${s.ms} ms`).join(" · ")}
                          </span>
                        ) : (
                          <span className="text-destructive">{l1ErrorText(r)}</span>
                        )}
                        {(r.skipped ?? []).map((s) => (
                          <div key={`${s.stage.step}-${s.stage.peer}`} className="tw-label text-muted-foreground">
                            {l1SkipText(s)}
                          </div>
                        ))}
                      </TableCell>
                      <TableCell className="text-right align-top tw-num">
                        {r.ok ? `${r.total_ms.toLocaleString()} ms` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Boxed>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common.close}
          </Button>
          <Button onClick={run} pending={running}>
            {!running && <ActivityIcon />}
            {t.link.again}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 推理测速：向所选上游各发送一次推理请求，测量首 token 时间。
 *
 * **按量计费。**开始之前必须先把费用预估摆出来 —— 预估和执行是两个接口，
 * 中间隔着用户点下「开始测速」。
 */
export function SpeedTestDialog({
  ov,
  preselect,
  onClose,
}: {
  ov: Overview;
  /** 从某一行打开时只勾选那一家；从页头打开时勾选全部启用的上游 */
  preselect: string | null;
  onClose: () => void;
}) {
  const t = useText(testDialogsText);
  const common = useText(commonText);
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(preselect ? [preselect] : ov.providers.filter((p) => !p.disabled).map((p) => p.name)),
  );
  const [quote, setQuote] = useState<SpeedQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [results, setResults] = useState<SpeedResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 可选的模型：各上游启用范围内的模型并起来。**停用的上游也算** —— 启用
  // 之前先测一次正是测速的用途
  useEffect(() => {
    let alive = true;
    Promise.all(
      ov.providers.map((p) =>
        api
          .providerModels(p.name)
          .then((v) => ({ name: p.name, ids: v.models.filter((m) => m.enabled).map((m) => m.id) }))
          .catch(() => ({ name: p.name, ids: [] as string[] })),
      ),
    ).then((lists) => {
      if (!alive) return;
      const all = [...new Set(lists.flatMap((l) => l.ids))].sort();
      // 默认选勾选的上游里能被最多家测到的模型 —— 测速的意义在于横向比较
      const picked = lists.filter((l) => chosen.has(l.name));
      const count = (m: string) => picked.filter((l) => l.ids.includes(m)).length;
      const best = [...all].sort((a, b) => count(b) - count(a))[0] ?? "";
      setModels(all);
      setModel((m) => m || best);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 报价覆盖全部上游：列表里每一家都要说清会不会被测、要花多少
  useEffect(() => {
    if (!model) return;
    let alive = true;
    setQuoting(true);
    api
      .speedQuote(model, [])
      .then((q) => alive && setQuote(q))
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setQuoting(false));
    return () => {
      alive = false;
    };
  }, [model]);

  const items = useMemo(() => quote?.items ?? [], [quote]);
  const runnable = items.filter((i) => chosen.has(i.provider) && !i.skipped);
  // 合计交给 core：只把选中的这几家再问一次
  const [selectedQuote, setSelectedQuote] = useState<SpeedQuote | null>(null);
  const runnableKey = runnable.map((i) => i.provider).join("\n");
  useEffect(() => {
    if (!model || runnable.length === 0) {
      setSelectedQuote(null);
      return;
    }
    let alive = true;
    api
      .speedQuote(
        model,
        runnable.map((i) => i.provider),
      )
      .then((q) => alive && setSelectedQuote(q))
      .catch(() => alive && setSelectedQuote(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, runnableKey]);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResults(await api.speedRun(model, runnable.map((i) => i.provider)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{t.speed.title}</DialogTitle>
          <DialogDescription>{t.speed.desc}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
          <FormItem label={t.speed.model} htmlFor="speed-model">
            {models == null ? (
              <Skeleton role="status" aria-label={t.speed.loadingModels} className="h-8 w-full rounded-lg" />
            ) : models.length === 0 ? (
              <Note>{t.speed.noModels}</Note>
            ) : (
              <NativeSelect
                id="speed-model"
                className="w-full font-mono"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setResults(null);
                }}
              >
                {models.map((m) => (
                  <NativeSelectOption key={m} value={m}>
                    {m}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormItem>

          <FormItem label={t.speed.upstreams}>
            <Boxed>
              {ov.providers.map((p) => {
                const item = items.find((i) => i.provider === p.name);
                const skipped = item?.skipped;
                return (
                  <label
                    key={p.name}
                    className="flex h-9 items-center gap-2.5 border-b border-border px-3 last:border-b-0 has-[:disabled]:opacity-50"
                  >
                    <Checkbox
                      checked={chosen.has(p.name) && !skipped}
                      disabled={!!skipped}
                      onCheckedChange={(v) =>
                        setChosen((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(p.name);
                          else n.delete(p.name);
                          return n;
                        })
                      }
                    />
                    <VendorTile name={p.name} baseUrl={p.base_url} protocol={p.protocol} size="sm" />
                    <span className="font-mono">{p.name}</span>
                    <div className="flex-1" />
                    <span className="tw-label text-muted-foreground">
                      {skipped ? skipLabel(skipped) : billingSummary(p)}
                    </span>
                  </label>
                );
              })}
            </Boxed>
          </FormItem>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="tw-body font-medium">{t.speed.estimate}</span>
              {quoting && (
                <StatusLabel tone="pending" muted className="tw-label">
                  {t.speed.quoting}
                </StatusLabel>
              )}
              <div className="flex-1" />
              {quote && <span className="tw-label text-muted-foreground">{t.speed.pricingDate(quote.pricing_date)}</span>}
            </div>
            <Boxed>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.upstream}</TableHead>
                    <TableHead className="text-right">{t.speed.inputTokens}</TableHead>
                    <TableHead className="text-right">{t.speed.maxOutput}</TableHead>
                    <TableHead className="text-right">{t.speed.estimatedCost}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runnable.map((i) => (
                    <TableRow key={i.provider}>
                      <TableCell>
                        <UpstreamName ov={ov} name={i.provider} />
                      </TableCell>
                      <TableCell className="text-right tw-num">{i.input_tokens}</TableCell>
                      <TableCell className="text-right tw-num">
                        {i.max_output_tokens ?? (
                          <span className="text-muted-foreground">{t.speed.noLimit}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tw-num">
                        {i.cost_micros != null ? (
                          usd(i.cost_micros)
                        ) : (
                          // 上限报不出来的那种上游（ChatGPT 账号）不是「未定价」，
                          // 是回答有多长由模型决定
                          <span className="text-muted-foreground">
                            {i.max_output_tokens == null ? t.speed.byUsage : t.speed.uncalculable}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {runnable.length > 0 && (
                    <TableRow>
                      <TableCell className="font-medium">
                        {t.total}
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right font-medium tw-num">
                        {selectedQuote?.total_micros != null
                          ? usd(selectedQuote.total_micros)
                          : t.speed.totalUncalculable}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {runnable.length === 0 && (
                <p className="px-3 py-4 text-center tw-body text-muted-foreground">{t.speed.noneSelected}</p>
              )}
            </Boxed>
          </div>

          {results && (
            <div className="flex flex-col gap-2">
              <span className="tw-body font-medium">{t.speed.results}</span>
              <Boxed>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.upstream}</TableHead>
                      <TableHead className="text-right">{t.speed.firstToken}</TableHead>
                      <TableHead className="text-right">{t.speed.totalTime}</TableHead>
                      <TableHead className="text-right">{t.speed.tokens}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.provider} className="motion-fade">
                        <TableCell>
                          <UpstreamName ov={ov} name={r.provider} />
                          {!r.ok && r.error && (
                            <div className="pl-7 tw-label whitespace-normal text-destructive">{coreText(r.error)}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right tw-num">
                          {r.ttft_ms != null ? `${r.ttft_ms.toLocaleString()} ms` : "—"}
                        </TableCell>
                        <TableCell className="text-right tw-num">
                          {r.ok ? `${r.total_ms.toLocaleString()} ms` : "—"}
                        </TableCell>
                        <TableCell className="text-right tw-num">
                          {r.input_tokens != null && r.output_tokens != null
                            ? `${r.input_tokens} → ${r.output_tokens}`
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Boxed>
            </div>
          )}
        </div>

        <DialogError error={error} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {results ? common.close : common.cancel}
          </Button>
          <Button onClick={run} pending={running} disabled={runnable.length === 0 || !model}>
            {!running && <ZapIcon />}
            {results ? t.speed.again : t.speed.start}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 测速结果表里的上游：标志加名字 */
function UpstreamName({ ov, name }: { ov: Overview; name: string }) {
  const p = ov.providers.find((x) => x.name === name);
  return (
    <span className="inline-flex items-center gap-2">
      <VendorTile name={name} baseUrl={p?.base_url} protocol={p?.protocol} size="sm" />
      <span className="font-mono">{name}</span>
    </span>
  );
}
