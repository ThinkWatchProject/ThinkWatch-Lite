import { useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

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
  const [open, setOpen] = useState(false);
  if (!b) {
    return (
      <div>
        <div className="tw-body font-medium">{title}</div>
        <p className="mt-1 tw-body text-muted-foreground">
          没有存下来
          <Tip text="两种可能：磁盘快满时只记摘要，或者这条记录已经过了保留期。">
            <span className="ml-1 underline decoration-dotted underline-offset-2">为什么</span>
          </Tip>
        </p>
      </div>
    );
  }
  const big = b.text.length > 2000;
  const shown = open || !big ? b.text : b.text.slice(0, 2000);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="tw-body font-medium">{title}</span>
        <span className="tw-body text-neutral-400">
          {b.original_len.toLocaleString()} 字节
          {/* **截断了要说出来。**不说的话用户会以为请求本身就这么长 */}
          {b.truncated && " · 只存了开头"}
        </span>
        {big && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto tw-body text-muted-foreground underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {open ? "折叠" : "展开全部"}
          </button>
        )}
      </div>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-neutral-100 p-2 font-mono tw-label leading-relaxed break-all whitespace-pre-wrap dark:bg-neutral-900">
        {shown}
        {big && !open && "\n…"}
      </pre>
    </div>
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
  const [d, setD] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("timeline");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Tauri 的 invoke 用字符串 reject，不是 Error
        const x = await invoke<RequestDetail>("request_detail", { id });
        if (alive) {
          setD(x);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(typeof e === "string" ? e : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const r = d?.row;

  return (
    <div
      className={
        inline
          ? "flex h-full min-w-0 flex-col border-l border-border bg-neutral-50 dark:bg-neutral-950"
          : "fixed inset-y-0 right-0 z-20 flex w-[min(38rem,90vw)] flex-col border-l border-border bg-white shadow-xl dark:bg-neutral-950"
      }
    >
      {/*
        **「关闭」两个字被折成了两行。**那不是设计，是 flex 里没人声明
        自己不能收缩：标题一长，浏览器就去挤按钮，而按钮挤无可挤就换行。
        标题截断、按钮 shrink-0 + nowrap，两条缺一不可。
      */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="truncate tw-head font-semibold">{r?.model || `第 ${id} 号请求`}</span>
        {r && (
          <span className="shrink-0 whitespace-nowrap tw-label text-muted-foreground">
            {new Date(r.at_ms).toLocaleTimeString()}
          </span>
        )}
        <span className="flex-1" />
        {/* 「录制」不是一个新功能，这一条请求本来就在存储里 */}
        <SaveFixture id={id} />
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 whitespace-nowrap"
          onClick={onClose}
        >
          关闭
        </Button>
      </header>

      {error && (
        <p className="m-4 rounded-md border border-amber-200 bg-amber-50 p-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      )}

      {d && r && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* 换成 Tabs 之后左右方向键能在标签间走 —— 这是手写那版没有的 */}
          <TabsList className="mx-4 my-2">
            <TabsTrigger value="timeline">时间线</TabsTrigger>
            <TabsTrigger value="routing">路由</TabsTrigger>
            <TabsTrigger value="payload">内容</TabsTrigger>
            <TabsTrigger value="usage">用量</TabsTrigger>
            <TabsTrigger value="replay">重放</TabsTrigger>
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
                  label="首字节"
                  value={
                    r.ttfb_ms != null ? (
                      <span className="tw-head">{r.ttfb_ms}ms</span>
                    ) : (
                      "—"
                    )
                  }
                />
                <Row label="总耗时" value={r.duration_ms != null ? `${r.duration_ms}ms` : "—"} />
                <Row
                  label="生成用时"
                  value={
                    r.duration_ms != null && r.ttfb_ms != null
                      ? `${r.duration_ms - r.ttfb_ms}ms`
                      : "—"
                  }
                />
                <Row label="上游" value={r.local ? "本地应答" : r.provider} />
                <Row label="客户端" value={r.client} />
                <Row label="路径" value={<span className="font-mono">{r.path}</span>} />
                <Row
                  label="状态"
                  value={
                    r.error ? (
                      <span className="text-red-600 dark:text-red-400">{r.error}</span>
                    ) : (
                      (r.status ?? "—")
                    )
                  }
                />
                <Row label="字节" value={r.bytes?.toLocaleString() ?? "—"} />
              </div>
            </TabsContent>

            <TabsContent value="routing">
              {r.routing ? (
                <div className="space-y-3">
                  {/* **「命中第 4 条」远不如「命中『带缓存的必须走官方』」
                      有用** */}
                  <div className="space-y-1">
                    <Row label="命中规则" value={r.routing.rule} />
                    {r.routing.group && <Row label="经过策略组" value={r.routing.group} />}
                  </div>
                  <div>
                    <div className="tw-body font-medium">尝试链</div>
                    <ol className="mt-1 space-y-1">
                      {r.routing.attempts.map((a, i) => (
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
                              a.outcome === "成功"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-700 dark:text-amber-400"
                            }
                          >
                            {a.outcome}
                          </span>
                          <span className="ml-auto text-muted-foreground">{a.ms}ms</span>
                        </li>
                      ))}
                    </ol>
                    {r.routing.attempts.length > 1 && (
                      // **用户能看见故障转移在替他工作，这是信任的来源**。
                      // 一个静默切换过的请求和一个一次就成的
                      // 请求，在他眼里应该是不同的。
                      <p className="mt-1.5 text-muted-foreground">
                        发生了故障转移：前 {r.routing.attempts.length - 1} 家失败，自动换到了下一家。
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  这条没有路由信息
                  <Tip text="要么是本地应答的（根本没到上游），要么是这个功能上线之前记下的。">
                    <span className="ml-1 underline decoration-dotted underline-offset-2">两种可能</span>
                  </Tip>
                </p>
              )}
            </TabsContent>

            <TabsContent value="payload">
              <div className="space-y-4">
                <Body b={d.request_body} title="请求" />
                <Body b={d.response_body} title="响应" />
                <p className="text-neutral-400">
                  这两段已脱敏：像密钥的内容都打了码。
                </p>
              </div>
            </TabsContent>

            <TabsContent value="usage">
              <div className="space-y-1">
                {r.input_tokens == null ? (
                  // **没有 usage 不是「用了 0」**
                  <p className="text-muted-foreground">
                    这家上游没有报用量
                    <Tip text="有些上游会吞掉响应里的 usage 字段。没有它就无法得知这次调用消耗了多少，也就算不出成本。">
                      <span className="ml-1 underline decoration-dotted underline-offset-2">为什么</span>
                    </Tip>
                  </p>
                ) : (
                  <>
                    <Row label="输入" value={r.input_tokens.toLocaleString()} />
                    <Row label="输出" value={(r.output_tokens ?? 0).toLocaleString()} />
                    <Row label="缓存读" value={(r.cache_read_tokens ?? 0).toLocaleString()} />
                    <Row label="缓存写" value={(r.cache_write_tokens ?? 0).toLocaleString()} />
                    <Row
                      label="花费"
                      value={
                        r.billing === "subscription" ? (
                          // 「订阅」而不是 $0.00
                          <span className="text-muted-foreground">
                            订阅 —— 这家是订阅制，这笔账不在金额这个维度上
                          </span>
                        ) : r.cost_micros == null ? (
                          // 「没有价格」和「花了 0 元」是两件事
                          <span className="text-muted-foreground">
                            算不出来 —— 这个模型不在价目表里
                          </span>
                        ) : r.cost_estimated ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            ~{usd(r.cost_micros)} · 估算
                          </span>
                        ) : (
                          usd(r.cost_micros)
                        )
                      }
                    />
                  </>
                )}
              </div>
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  );
}

/**
 * 另存为回放用例。
 *
 * **上游漂移是我们的单元测试永远抓不到的那一类故障** —— Codex 在一个
 * patch 版本里改了 `auth.json` 的语义、`reasoning_content` 在不同上游
 * 有三个别名。防它只有一个办法：拿真实流量反复回放。
 *
 * 导出时已经走过脱敏，但**它会进 git**，所以那句「自己看一眼」
 * 必须写在按钮旁边而不是文档里。
 */
function SaveFixture({ id }: { id: number }) {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 items-center gap-2">
      {path && (
        <span className="tw-label text-muted-foreground" title={path}>
          写好了，记得自己看一眼再交出去
        </span>
      )}
      {error && <span className="tw-label text-amber-600 dark:text-amber-400">{error}</span>}
      <Tip text="把这次的请求和响应存成一个脱敏过的回放用例。它会进 git，交出去之前自己看一眼">
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 whitespace-nowrap"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setPath(await invoke<string>("save_fixture", { id }));
          } catch (e) {
            // Tauri 的 invoke 用字符串 reject，不是 Error
            setError(typeof e === "string" ? e : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "存…" : "存为用例"}
      </Button>
      </Tip>
    </span>
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
  const [ov, setOv] = useState<Overview | null>(null);
  const [provider, setProvider] = useState("");
  const [quote, setQuote] = useState<ReplayQuote | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const o = await invoke<Overview>("overview");
        setOv(o);
        // 默认选一个**和原来那次不同的**上游 —— 重放的价值在对比
        setProvider(o.providers.find((p) => p.name !== originalProvider)?.name ?? o.providers[0]?.name ?? "");
      } catch (e) {
        setError(typeof e === "string" ? e : String(e));
      }
    })();
  }, [originalProvider]);

  async function ask() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setQuote(await invoke<ReplayQuote>("replay_quote", { id, provider }));
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      setError(typeof e === "string" ? e : String(e));
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
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground">
        把这条请求<span className="font-medium">原样</span>发给另一个上游，并排对比
        <Tip text="请求体是当时存下来的那一份，一个字节都没改 —— 手工复现一个 Claude Code 请求几乎不可能，而任何一处不同都会让对比失去意义。">
          <span className="ml-1 underline decoration-dotted underline-offset-2">原样是指</span>
        </Tip>
      </p>
      <div className="flex items-center gap-2">
        <Select
          value={provider}
          onValueChange={(v) => {
            setProvider(v);
            setQuote(null);
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ov?.providers.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                  {p.name === originalProvider ? "（原来就是它）" : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void ask()}
          disabled={busy || !provider}
        >
          看报价
        </Button>
      </div>

      {error && <div className="text-amber-600 dark:text-amber-400">{error}</div>}

      {quote && (
        <div className="rounded border border-border p-3">
          {/* **触发前必须显示预估消耗**，而不是点了才知道 */}
          <div>
            发 {quote.body_bytes} 字节给 <span className="font-medium">{quote.provider}</span>，
            约 {quote.input_tokens} 个输入 token。
          </div>
          <div className="mt-1">{quote.note}</div>
          {quote.will_redact && (
            <div className="mt-1 text-muted-foreground">
              发出去之前会按这家的规则脱敏，回显会换回来。
            </div>
          )}
          <div className="mt-1 text-muted-foreground">价目表日期 {quote.pricing_date}。</div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => void go()}
            disabled={busy}
          >
            {busy ? "发送中…" : "确认发送"}
          </Button>
        </div>
      )}

      {result && (
        <div className="rounded border border-border p-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-normal"></TableHead>
                <TableHead className="text-right font-normal">{result.original.provider}（原来）</TableHead>
                <TableHead className="text-right font-normal">{result.provider}（重放）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <Cmp label="状态" a={result.original.status} b={result.status} />
              <Cmp label="首字节" a={result.original.ttfb_ms} b={result.ttfb_ms} unit="ms" />
              <Cmp label="耗时" a={result.original.duration_ms} b={result.duration_ms} unit="ms" />
              <Cmp label="字节" a={result.original.bytes} b={result.bytes} />
            </TableBody>
          </Table>
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-50 p-2 tw-label dark:bg-neutral-950">
            {result.body}
          </pre>
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
