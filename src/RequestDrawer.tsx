import { useEffect, useMemo, useState } from "react";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import {
  usd,
  type BodyView,
  type Overview,
  type ReplayQuote,
  type ReplayResult,
  type RequestDetail,
} from "./types";
import { Button } from "@/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Collapsible, CollapsibleTrigger } from "@/ui/collapsible";
import { XIcon } from "lucide-react";
import { priceSourceDetail } from "./upstreams/labels";
import { attemptText, formatLabel, quoteText, targetLabel } from "./labels";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { requestDrawerText } from "./RequestDrawer.i18n";
import { prettyJson } from "./prettyJson";
import { coreText } from "@/i18n/core.i18n";
import { errorText } from "@/i18n/core.i18n";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";

type Tab = "timeline" | "routing" | "payload" | "usage" | "replay";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}

/**
 * 一段 body。
 *
 * **system prompt 默认折叠。**Claude Code 的 system prompt 有几千 token，
 * 展开会淹没一切 —— 而用户点开这个抽屉是为了看**这一次**发生了什么
 * （详情抽屉）。
 */
function Body({ b, title }: { b: BodyView | null; title: string }) {
  const t = useText(requestDrawerText);
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => (b ? prettyJson(b.text, b.truncated) : null), [b]);
  if (!b) {
    return (
      <div>
        <div className="tw-body font-medium">{title}</div>
        <p className="mt-1 tw-body text-muted-foreground">
          {t.notSaved}
          <Tip text={t.notSavedTip}>
            <span className="ml-1 underline decoration-dotted underline-offset-2">{t.details}</span>
          </Tip>
        </p>
      </div>
    );
  }
  // 折不折按原文算：排版加进来的空白不算内容
  const big = b.text.length > 2000;
  const text = pretty ?? b.text;
  const shown = open || !big ? text : text.slice(0, 2000);
  /*
    **`Collapsible` 而不是 `Accordion`。**请求和响应两段是各自独立的,
    要能同时展开对着看;Accordion 是「一组里只开一个」,那正好是这里
    不想要的行为。
  */
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-baseline gap-2">
        <span className="tw-body font-medium">{title}</span>
        <span className="tw-body text-neutral-400">
          {t.size(b.original_len)}
          {/* **截断了要说出来。**不说的话用户会以为请求本身就这么长 */}
          {b.truncated && ` · ${t.truncated}`}
        </span>
        {big && (
          <CollapsibleTrigger asChild>
            <Button variant="link" size="xs" className="ml-auto">
              {open ? t.collapse : t.showAll}
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      <BodyText
        text={shown}
        json={pretty != null}
        more={big && !open}
        className="mt-1 max-h-80 rounded-md bg-neutral-100 p-2 dark:bg-neutral-900"
      />
    </Collapsible>
  );
}

/**
 * 一段等宽的 body 正文。JSON 在 `prettyJson` 里排好，这里管折行。
 *
 * **折行对齐到本行的缩进。**长字符串（system prompt、工具说明）一折行就
 * 回到最左边，缩进表达的层级就被冲散了。所以一行一个块，用 padding 加
 * 负的 text-indent 做悬挂缩进 —— 行首的空格还是文字，复制出去缩进不丢。
 *
 * **JSON 按词折，原文见字就断。**SSE 那种 `data: {…}` 按词折会在冒号后面
 * 断开，第一行只剩一个 `data:`。
 */
function BodyText({
  text,
  json,
  more = false,
  className,
}: {
  text: string;
  json: boolean;
  /** 折叠着，后面还有 */
  more?: boolean;
  className?: string;
}) {
  const lines = useMemo(() => text.split("\n"), [text]);
  return (
    <pre
      className={cn(
        "overflow-auto font-mono tw-label leading-relaxed whitespace-pre-wrap",
        json ? "wrap-anywhere" : "break-all",
        className,
      )}
    >
      {lines.map((line, i) => {
        const indent = Math.max(0, line.search(/[^ ]/));
        return (
          <span
            key={i}
            className="block"
            style={indent ? { paddingLeft: `${indent}ch`, textIndent: `-${indent}ch` } : undefined}
          >
            {i < lines.length - 1 ? line + "\n" : line}
          </span>
        );
      })}
      {more && <span className="block">…</span>}
    </pre>
  );
}

export default function RequestDrawer({
  id,
  onClose,
  /**
   * 当成分栏里的一列渲染，而不是浮在右边。
   *
   * **排查要来回对照。**覆盖式抽屉的问题是：看详情的时候看不到列表，
   * 而「这一条和上一条比慢在哪」恰恰要同时看见两边。抓包工具全是主从
   * 分栏，理由就是这个。
   *
   * 浮层模式留着给窄窗口 —— 1100px 拆成两栏之后列表只剩 600px，
   * 再窄就两边都用不了。
   */
  inline = false,
}: {
  id: number;
  onClose: () => void;
  inline?: boolean;
}) {
  const t = useText(requestDrawerText);
  const common = useText(commonText);
  const [d, setD] = useState<RequestDetail | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const x = await invoke<RequestDetail>("request_detail", { id });
        if (alive) {
          setD(x);
        }
      } catch (e) {
        if (alive) toast.error(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const r = d?.row;

  /*
    **两种壳,一份内容。**分栏时它是右边那一列(排查要来回对照,看详情
    的时候得同时看见列表);窄窗口时它浮在右边。

    浮的那一半原来是手写的 `fixed inset-y-0 right-0` —— 缺的和另外那几个
    浮层一样:Esc 关不掉、Tab 会走到背景里、焦点不回到那一行。`Sheet` 就是
    干这个的,而嵌入那一半它管不着,所以壳分两种、内容只写一遍。
  */
  const body = (
    <>
      {/*
        **「关闭」两个字被折成了两行。**那不是设计，是 flex 里没人声明
        自己不能收缩：标题一长，浏览器就去挤按钮，而按钮挤无可挤就换行。
        标题截断、按钮 shrink-0 + nowrap，两条缺一不可。
      */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="truncate tw-head font-semibold">{r?.model || t.requestNo(id)}</span>
        {r && (
          <span className="shrink-0 whitespace-nowrap tw-label text-muted-foreground">
            {new Date(r.at_ms).toLocaleTimeString()}
          </span>
        )}
        <span className="flex-1" />
        {/*
          **关闭按钮在 header 这一行里，不用 Sheet 自带的那个。**
          自带的是 `absolute top-3 right-3` 的 28px 方块，跨到 y=40，而
          这条 header 是 `py-2`、底边线在 y=37 —— 那个 × 正好压在线上。
          放进这一行之后它跟着基线走，两种壳也共用同一个。
        */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={common.close}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>

      

      {d && r && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* 换成 Tabs 之后左右方向键能在标签间走 —— 这是手写那版没有的 */}
          <TabsList className="mx-4 my-2">
            <TabsTrigger value="timeline">{t.tabTimeline}</TabsTrigger>
            <TabsTrigger value="routing">{t.tabRouting}</TabsTrigger>
            <TabsTrigger value="payload">{t.tabPayload}</TabsTrigger>
            <TabsTrigger value="usage">{t.tabUsage}</TabsTrigger>
            <TabsTrigger value="replay">{t.tabReplay}</TabsTrigger>
          </TabsList>

          <div className="min-h-0 flex-1 overflow-auto p-4 tw-body">
            <TabsContent value="replay">
              <Replay id={id} originalProvider={r.provider} />
            </TabsContent>
            <TabsContent value="timeline">
              <div className="space-y-1">
                {/* **TTFT 放在最显眼的位置。**对 AI 来说它才是体感的
                    一切 —— 一眼看出慢在网络还是慢在模型 */}
                <Row
                  label={t.ttfb}
                  value={
                    r.ttfb_ms != null ? (
                      <span className="tw-head">{r.ttfb_ms}ms</span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row label={t.totalTime} value={r.duration_ms != null ? `${r.duration_ms}ms` : "—"} />
                <Row
                  label={t.generationTime}
                  value={
                    r.duration_ms != null && r.ttfb_ms != null
                      ? `${r.duration_ms - r.ttfb_ms}ms`
                      : "—"
                  }
                />
                <Row label={t.upstream} value={r.local ? t.answeredLocally : r.provider} />
                <Row label={t.client} value={r.client} />
                <Row label={t.path} value={<span className="font-mono">{r.path}</span>} />
                {/* **转了就要看得见，丢了字段更要看得见** —— 「扩展思考开了却没
                    生效」在客户端那头无从查起 */}
                {r.translated && (
                  <>
                    <Row
                      label={t.conversion}
                      value={
                        // 格式名整体换行，不从单词中间断开
                        <>
                          <span className="whitespace-nowrap">{formatLabel(r.translated.from)}</span>
                          {" → "}
                          <span className="whitespace-nowrap">{formatLabel(r.translated.to)}</span>
                        </>
                      }
                    />
                    {r.translated.dropped.length > 0 && (
                      <Row
                        label={t.dropped}
                        value={
                          <span className="text-amber-700 dark:text-amber-400">
                            {/* 一个字段整体换行，不从路径中间断开 */}
                            {r.translated.dropped.map((f, i) => (
                              <span key={f}>
                                {i > 0 && t.listSep}
                                <span className="font-mono whitespace-nowrap">{f}</span>
                              </span>
                            ))}
                            <Tip text={t.droppedTip}>
                              <span className="ml-1 whitespace-nowrap underline decoration-dotted underline-offset-2">{t.details}</span>
                            </Tip>
                          </span>
                        }
                      />
                    )}
                  </>
                )}
                <Row
                  label={t.status}
                  value={
                    r.error ? (
                      <span className="text-red-600 dark:text-red-400">{coreText(r.error)}</span>
                    ) : r.cancelled ? (
                      // 不是失败，不标红：上游没有出错，是客户端先断开了
                      <span>{r.status ?? "—"} · {t.cancelled}</span>
                    ) : (
                      (r.status ?? "—")
                    )
                  }
                />
                <Row label={t.bytes} value={r.bytes?.toLocaleString() ?? "—"} />
              </div>
            </TabsContent>

            <TabsContent value="routing">
              {r.routing ? (
                <div className="space-y-3">
                  {/* **「命中第 4 条」远不如「命中『带缓存的必须走官方』」
                      有用** */}
                  <div className="space-y-1">
                    <Row label={t.matchedRule} value={r.routing.rule} />
                    {r.routing.group && <Row label={t.viaGroup} value={targetLabel(r.routing.group)} />}
                  </div>
                  <div>
                    <div className="tw-body font-medium">{t.attempts}</div>
                    <ol className="mt-1 space-y-1">
                      {r.routing.attempts.map((a, i) => {
                        const outcome = attemptText(a);
                        return (
                        <li
                          key={`${a.provider}-${i}`}
                          className="flex items-baseline gap-3 rounded border border-border px-2 py-1"
                        >
                          <span className="w-4 shrink-0 text-neutral-400">{i + 1}</span>
                          <span className="font-medium">{a.provider}</span>
                          {/* **失败的原因要留着** —— 一条说「试过 A → B →
                              C」的链和一条还说清每一跳为什么失败的链，
                              排查价值差得远 */}
                          <span
                            className={
                              outcome.ok
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-700 dark:text-amber-400"
                            }
                          >
                            {outcome.text}
                          </span>
                          <span className="ml-auto text-muted-foreground">{a.ms}ms</span>
                        </li>
                        );
                      })}
                    </ol>
                    {r.routing.attempts.length > 1 && (
                      // **用户能看见故障转移在替他工作，这是信任的来源**。
                      // 一个静默切换过的请求和一个一次就成的
                      // 请求，在他眼里应该是不同的。
                      <p className="mt-1.5 text-muted-foreground">
                        {t.failover(r.routing.attempts.length - 1)}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {t.noRouting}
                  <Tip text={t.noRoutingTip}>
                    <span className="ml-1 underline decoration-dotted underline-offset-2">{t.possibleCauses}</span>
                  </Tip>
                </p>
              )}
            </TabsContent>

            <TabsContent value="payload">
              <div className="space-y-4">
                <Body b={d.request_body} title={t.request} />
                <Body b={d.response_body} title={t.response} />
              </div>
            </TabsContent>

            <TabsContent value="usage">
              <div className="space-y-1">
                {r.input_tokens == null && r.cancelled ? (
                  // 这时候不能说「上游没有报用量」—— 它还没来得及报，客户端就走了
                  <p className="text-muted-foreground">{t.cancelledBeforeUsage}</p>
                ) : r.input_tokens == null && r.error ? (
                  // 失败的请求没有用量，**不是上游吞掉了它** —— 请求没走到那一步
                  <p className="text-muted-foreground">{t.failedBeforeUsage}</p>
                ) : r.input_tokens == null ? (
                  // **没有 usage 不是「用了 0」**
                  <p className="text-muted-foreground">
                    {t.noUsage}
                    <Tip text={t.noUsageTip}>
                      <span className="ml-1 underline decoration-dotted underline-offset-2">{t.details}</span>
                    </Tip>
                  </p>
                ) : (
                  <>
                    <Row label={t.input} value={r.input_tokens.toLocaleString()} />
                    <Row label={t.output} value={(r.output_tokens ?? 0).toLocaleString()} />
                    <Row label={t.cacheReads} value={(r.cache_read_tokens ?? 0).toLocaleString()} />
                    <Row label={t.cacheWrites} value={(r.cache_write_tokens ?? 0).toLocaleString()} />
                    <Row
                      label={t.cost}
                      value={
                        r.billing === "subscription" ? (
                          // 「订阅制」而不是 $0.00 —— 消耗的是额度，不是金额
                          <span className="text-muted-foreground">{t.subscription}</span>
                        ) : r.billing === "free" ? (
                          <span className="text-muted-foreground">{usd(0)} · {t.free}</span>
                        ) : r.billing === "unknown" ? (
                          <span className="text-muted-foreground">{t.billingUnknown}</span>
                        ) : r.cost_micros == null ? (
                          // 「没有价格」和「费用为 0」是两件事
                          <span className="text-muted-foreground">{t.unpriced}</span>
                        ) : r.cost_estimated && r.cancelled ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            ~{usd(r.cost_micros)} · {t.estimatedCancelled}
                          </span>
                        ) : r.cost_estimated && r.error ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            ~{usd(r.cost_micros)} · {t.estimatedInterrupted}
                          </span>
                        ) : r.cost_estimated ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            ~{usd(r.cost_micros)} · {t.estimated}
                          </span>
                        ) : (
                          usd(r.cost_micros)
                        )
                      }
                    />
                    {r.price_source && (
                      <Row label={t.priceSource} value={priceSourceDetail(r.price_source)} />
                    )}
                  </>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </>
  );

  if (inline) {
    return (
      <div className="flex h-full min-w-0 flex-col border-l border-border bg-neutral-50 dark:bg-neutral-950">
        {body}
      </div>
    );
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        /*
          **宽度要带 `data-[side=right]:` 前缀。**组件自己那条
          `data-[side=right]:w-3/4 sm:max-w-sm` 是属性选择器，普通的
          `w-[…]` 压不过它 —— 这个抽屉一直是 384px，而不是写着的 38rem。
        */
        className="flex flex-col p-0 data-[side=right]:w-[min(38rem,90vw)] data-[side=right]:sm:max-w-none"
        /*
          **打开时别把焦点放在关闭按钮上。**Radix 默认聚焦第一个可聚焦
          元素，也就是那个 ×，于是一打开就有个高亮方框套在「关闭」上 ——
          看起来像是在提示你关掉它。改成聚焦面板本身：焦点仍然在陷阱
          里（Tab 走不出去、Esc 照样关），只是不落在某个按钮上。
        */
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {/* 标题在上面那个 header 里,这里只是读屏软件要的那一句 */}
        <SheetHeader className="sr-only">
          <SheetTitle>{t.title}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}


/**
 * 把这条请求原样发给另一个上游（M6+）。
 *
 * 用途只有一个，但它是这个工具最常被需要的那一个：**这条请求走中转慢
 * 或者失败了，同样一条发给官方会怎么样？**手工复现一个 Claude Code 的
 * 请求几乎不可能 —— 那是几十 KB 的 system prompt 加一堆工具定义，而任何
 * 一处不同都会让对比失去意义。我们手里正好有原样的那一份。
 *
 * **它花钱**，所以和 L3 测速一样是三步：选上游 → 看报价 → 点确认。
 * 中间那一步不能省 —— 触发前必须显示预估消耗，而不是点了才知道。
 */
function Replay({ id, originalProvider }: { id: number; originalProvider: string }) {
  const t = useText(requestDrawerText);
  const [ov, setOv] = useState<Overview | null>(null);
  const [provider, setProvider] = useState("");
  const [quote, setQuote] = useState<ReplayQuote | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [busy, setBusy] = useState(false);
  // 重放的响应体只留开头两万字，截了也不说；截断的 parse 不了，就原样显示
  const pretty = useMemo(() => (result ? prettyJson(result.body, false) : null), [result]);

  useEffect(() => {
    void (async () => {
      try {
        const o = await invoke<Overview>("overview");
        setOv(o);
        // 默认选一个**和原来那次不同的**上游 —— 重放的价值在对比
        setProvider(o.providers.find((p) => p.name !== originalProvider)?.name ?? o.providers[0]?.name ?? "");
      } catch (e) {
        toast.error(errorText(e));
      }
    })();
  }, [originalProvider]);

  async function ask() {
    setBusy(true);
    setResult(null);
    try {
      setQuote(await invoke<ReplayQuote>("replay_quote", { id, provider }));
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(errorText(e));
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }

  async function go() {
    setBusy(true);
    try {
      setResult(await invoke<ReplayResult>("replay_run", { id, provider }));
      setQuote(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">
        {t.replayIntro((x) => <span className="font-medium">{x}</span>)}
        <Tip text={t.asIsTip}>
          <span className="ml-1 underline decoration-dotted underline-offset-2">{t.asIs}</span>
        </Tip>
      </p>
      <div className="flex items-center gap-2">
        <NativeSelect
          size="sm"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setQuote(null);
          }}
        >
          {ov?.providers.map((p) => (
            <NativeSelectOption key={p.name} value={p.name}>
              {p.name}
              {p.name === originalProvider ? t.originalUpstream : ""}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void ask()}
          disabled={busy || !provider}
        >
          {t.estimateCost}
        </Button>
      </div>

      {quote && (
        <div className="rounded border border-border p-3">
          {/* **触发前必须显示预估消耗**，而不是点了才知道 */}
          <div>
            {t.quote(
              <span className="font-medium">{quote.provider}</span>,
              quote.body_bytes,
              quote.input_tokens,
            )}
          </div>
          <div className="mt-1">{quoteText(quote)}</div>
          {quote.will_redact && (
            <div className="mt-1 text-muted-foreground">
              {t.willRedact}
            </div>
          )}
          <div className="mt-1 text-muted-foreground">{t.pricingDate(quote.pricing_date)}</div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => void go()}
            disabled={busy}
          >
            {busy && <Spinner />}
              {t.confirmSend}
          </Button>
        </div>
      )}

      {result && (
        <div className="rounded border border-border p-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-normal"></TableHead>
                <TableHead className="text-right font-normal">{t.originalColumn(result.original.provider)}</TableHead>
                <TableHead className="text-right font-normal">{t.replayColumn(result.provider)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Cmp label={t.status} a={result.original.status} b={result.status} />
              <Cmp label={t.ttfb} a={result.original.ttfb_ms} b={result.ttfb_ms} unit="ms" />
              <Cmp label={t.duration} a={result.original.duration_ms} b={result.duration_ms} unit="ms" />
              <Cmp label={t.bytes} a={result.original.bytes} b={result.bytes} />
            </TableBody>
          </Table>
          <BodyText
            text={pretty ?? result.body}
            json={pretty != null}
            className="mt-2 max-h-64 rounded bg-neutral-50 p-2 dark:bg-neutral-950"
          />
        </div>
      )}
    </div>
  );
}

function Cmp({
  label,
  a,
  b,
  unit = "",
}: {
  label: string;
  a: number | null | undefined;
  b: number;
  unit?: string;
}) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      {/* **原来那次可能没有这个数**（失败的请求没有耗时）。写「—」而不是 0 */}
      <TableCell className="text-right">{a == null ? "—" : `${a}${unit}`}</TableCell>
      <TableCell className="text-right font-medium">
        {b}
        {unit}
      </TableCell>
    </TableRow>
  );
}
