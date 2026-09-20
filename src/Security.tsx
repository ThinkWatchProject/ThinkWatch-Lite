import { useCallback, useEffect, useState } from "react";
import { Tip } from "@/ui/tip";
import { invoke } from "@tauri-apps/api/core";
import type {
  AdoptResponse,
  BaselineResponse,
  McpOpRequest,
  McpTargetView,
  McpView,
  PlanView,
  ScanFinding,
  ScanResponse,
} from "./types";
import { driftLabel, scanRulesText } from "./labels";
import { Button } from "@/ui/button";
import { Alert, AlertDescription } from "@/ui/alert";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { securityText } from "./Security.i18n";
import { errorText } from "@/i18n/core.i18n";

/**
 * 客户端配置面。
 *
 * 两件事放在一页，因为**它们是同一件事的两面**：扫描要知道去哪儿找，
 * 而清单正是那份地址簿。
 *
 * 三条纪律写在界面上：
 *
 * - **只报告，不自动删除。**这一页没有任何删除按钮。误报删掉用户的
 *   正常配置比漏报还糟 —— 它会摧毁信任，然后用户关掉整个功能。
 * - **查干净了要说「没发现问题」**，而不是让这一块消失。
 * - **不存任何状态。**每次打开现扫一遍，你看到的永远是磁盘上此刻的
 *   真实情况；没有「同步失效了」这种问题，因为压根没有同步状态。
 */
export default function Security({
  alerts,
  onSeen,
}: {
  /** 监听到的、**新出现**的那些。它们已经在下面的完整列表里了，
   *  这里单独再说一遍是因为「刚刚变的」和「一直就有」是两个信号。 */
  alerts: ScanFinding[];
  onSeen: () => void;
}) {
  const t = useText(securityText);
  const [data, setData] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<ScanFinding | null>(null);
  const [targets, setTargets] = useState<McpTargetView[]>([]);
  const [base, setBase] = useState<BaselineResponse | null>(null);
  const [pending, setPending] = useState<{ req: McpOpRequest; plan: PlanView } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [scan, ts, bl] = await Promise.all([
        invoke<ScanResponse>("scan_configs", { projects: [] }),
        invoke<McpTargetView[]>("mcp_targets"),
        invoke<BaselineResponse>("baseline"),
      ]);
      setData(scan);
      setTargets(ts);
      setBase(bl);
      setError(null);
    } catch (e) {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /** 点了格子。**先算一份 diff**，不直接写 —— 和接管同一条纪律。 */
  async function ask(req: McpOpRequest) {
    setBusy(true);
    setError(null);
    try {
      setPending({ req, plan: await invoke<PlanView>("mcp_plan", { req }) });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await invoke<AdoptResponse>("mcp_apply", { req: pending.req });
      setPending(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return <div className="p-5 tw-head text-muted-foreground">{error ?? t.scanning}</div>;
  }

  const high = data.findings.filter((f) => f.level === "high").length;

  return (
    <div className="space-y-5 p-5">
      

      <div className="flex items-center gap-2 tw-body text-muted-foreground">
        <span>
          {t.scanned(data.scanned, scanRulesText(data))}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={busy}
        >
          {busy && <Spinner />}
              {t.rescan}
        </Button>
      </div>

      {data.rules_warning && (
        <Alert variant="warning" className="px-3 py-2">
          <AlertDescription>
          {data.rules_warning}
        </AlertDescription>
        </Alert>
      )}

      {/* 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉 */}
      {data.unreadable.length > 0 && (
        <div className="tw-body text-amber-600 dark:text-amber-400">
          {t.unreadable(data.unreadable)}
        </div>
      )}

      {alerts.length > 0 && (
        <section className="rounded border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
          <div className="flex items-center gap-2">
            <h2 className="tw-head font-medium text-red-900 dark:text-red-200">
              {t.newFindings(alerts.length)}
            </h2>
            <Button
              variant="destructive"
              size="xs"
              className="ml-auto"
              onClick={onSeen}
            >
              {t.markRead}
            </Button>
          </div>
          {/* 「一个用了半年的 skill 突然多了一段零宽字符」这个信号，
              比「这个文件里有可疑内容」强得多 */}
          <p className="mt-1 tw-body text-red-800 dark:text-red-300">
            {t.newNote((s) => <span className="font-medium">{s}</span>)}
          </p>
          <ul className="mt-2 space-y-1 tw-body">
            {alerts.map((f, i) => (
              <li key={i}>
                <Button
                  variant="link"
                  size="xs"
                  className="text-left" onClick={() => setOpen(f)}
                >
                  {f.title}
                  <span className="ml-2 text-red-700 dark:text-red-400">
                    {f.path.replace(/^.*\//, "")}:{f.line}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 tw-head font-medium">
          {t.findings(data.findings.length)}
          {high > 0 && <span className="ml-1 text-red-600 dark:text-red-400">{t.high(high)}</span>}
        </h2>
        {data.findings.length === 0 ? (
          // 没风险的时候要说「安全」，而不是让这一块消失
          <Alert variant="default" className="px-3 py-2">
          <AlertDescription>
            ✓ {t.noIssues}
            <Tip text={t.checkedTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">{t.checked}</span>
            </Tip>
          </AlertDescription>
        </Alert>
        ) : (
          <ul className="space-y-1">
            {data.findings.map((f, i) => (
              <li key={i}>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex h-auto w-full items-start gap-2 text-left"
                  onClick={() => setOpen(f)}
                >
                  <span
                    className={
                      f.level === "high"
                        ? "text-red-600 dark:text-red-400"
                        : f.level === "medium"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    }
                  >
                    {f.level === "high" ? "✗" : f.level === "medium" ? "?" : "·"}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium">{f.title}</span>
                    <span className="ml-2 text-muted-foreground">
                      {f.path.replace(/^.*\//, "")}:{f.line}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {base && <Baseline b={base} />}

      <Matrix mcp={data.mcp} conflicting={data.conflicting} targets={targets} busy={busy} onAsk={ask} />

      {data.hooks.length > 0 && (
        <section>
          <h2 className="mb-1 tw-head font-medium">{t.hooks(data.hooks.length)}</h2>
          {/* 危险度第一：不需要模型参与就能拿到执行权 */}
          <p className="mb-2 tw-body text-muted-foreground">
            {t.hooksNote}
            <Tip text={t.hooksRiskTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">{t.hooksRisk}</span>
            </Tip>
          </p>
          <ul className="space-y-1 tw-body">
            {data.hooks.map((h, i) => (
              <li key={i} className="rounded border border-border px-3 py-1.5">
                <span className="text-muted-foreground">{h.event}</span>{" "}
                <code className="break-all">{h.command}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.skills.length > 0 && (
        <section>
          <h2 className="mb-1 tw-head font-medium">{t.skills(data.skills.length)}</h2>
          {/* skill 只看不搬 —— 跨客户端的格式还没有事实标准 */}
          <p className="mb-2 tw-body text-muted-foreground">
            {t.skillsNote}
            <Tip text={t.skillsWhyTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">{t.skillsWhy}</span>
            </Tip>
          </p>
          <ul className="space-y-1 tw-body">
            {data.skills.map((s, i) => (
              <li key={i} className="rounded border border-border px-3 py-1.5">
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-muted-foreground">{s.client}</span>
                {s.allowed_tools.length > 0 && (
                  <span className="ml-2 text-muted-foreground">{t.tools(s.allowed_tools)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && <Detail f={open} onClose={() => setOpen(null)} />}
      {pending && (
        <McpConfirm
          plan={pending.plan}
          req={pending.req}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

/**
 * MCP 矩阵。
 *
 * M4 的简化版**只看不搬**：格子告诉你谁配了什么，同名不同配置标个记号。
 * 点格子执行复制是更完整的那一版，等这一版用顺了再说。
 */
function Matrix({
  mcp,
  conflicting,
  targets,
  busy,
  onAsk,
}: {
  mcp: McpView[];
  conflicting: string[];
  targets: McpTargetView[];
  busy: boolean;
  onAsk: (req: McpOpRequest) => void;
}) {
  const t = useText(securityText);
  // 列 = 所有能写的位置 ∪ 已经配了东西的位置。
  // **不能写的也要出现在表里** —— 看得见是第一目标，只是它的格子点不动
  const clients = [
    ...new Set([...targets.map((t) => t.client), ...mcp.map((m) => m.client)]),
  ].sort();
  /**
   * 正在对比的那个同名服务器。
   *
   * **标一个记号只回答了「不一样」，没回答「哪儿不一样」** —— 而用户
   * 要做的决定恰恰是「以哪边为准」，那个决定需要看见差异。
   */
  const [compare, setCompare] = useState<string | null>(null);
  const canWrite = (c: string) => targets.find((t) => t.client === c)?.copyable ?? false;
  const whyNot = (c: string) => targets.find((x) => x.client === c)?.why_not ?? t.cannotWrite;
  const names = [...new Set(mcp.map((m) => m.name))].sort();
  if (names.length === 0) {
    return (
      <section>
        <h2 className="mb-1 tw-head font-medium">{t.mcp}</h2>
        <p className="tw-body text-muted-foreground">{t.noMcp}</p>
      </section>
    );
  }
  const at = (name: string, client: string) => mcp.find((m) => m.name === name && m.client === client);

  return (
    <section>
      <h2 className="mb-1 tw-head font-medium">{t.mcpCount(names.length)}</h2>
      <p className="mb-2 tw-body text-muted-foreground">
        {t.mcpNote}
        <Tip text={t.mcpEditTip}>
          <span className="underline decoration-dotted underline-offset-2">{t.mcpEdit}</span>
        </Tip>
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-muted-foreground">
              <TableHead className="font-normal">{t.name}</TableHead>
              {clients.map((c) => (
                <TableHead key={c} className="font-normal">
                  {c}
                </TableHead>
              ))}
              <TableHead className="font-normal">{t.config}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {names.map((n) => {
              const any = mcp.find((m) => m.name === n)!;
              return (
                <TableRow key={n}>
                  <TableCell>
                    {conflicting.includes(n) && (
                      <Tip text={t.conflictTip}>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="mr-1"
                          onClick={() => setCompare(compare === n ? null : n)}
                        >
                          ⚠
                        </Button>
                      </Tip>
                    )}
                    {n}
                  </TableCell>
                  {clients.map((c) => {
                    const m = at(n, c);
                    const writable = canWrite(c);
                    // 空格子从哪儿抄过来。多个来源时用第一个能抄的
                    const source = mcp.find((x) => x.name === n && canWrite(x.client));
                    const can = writable && (m ? true : !!source);
                    const title = !writable
                      ? whyNot(c)
                      : m
                        ? t.removeFrom(c)
                        : source
                          ? t.copyFrom(source.client)
                          : t.noSource;
                    return (
                      <TableCell key={c} className="text-center">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={title}
                          disabled={!can || busy}
                          onClick={() =>
                            can &&
                            onAsk(
                              m
                                ? { op: "remove", name: n, to: c }
                                : { op: "copy", name: n, from: source!.client, to: c },
                            )
                          }
                        >
                          {!m ? (
                            <span className="text-neutral-300 dark:text-neutral-700">·</span>
                          ) : m.enabled ? (
                            "✓"
                          ) : (
                            // 关掉的还在配置里，一次编辑就能打开
                            <Tip text={t.disabledTip}>
                              <span className="text-neutral-400">○</span>
                            </Tip>
                          )}
                        </Button>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-muted-foreground">
                    {/* **同名不同配置时，不能只显示其中一份。**挑一个显示
                        等于替用户选了个「正确答案」，而这一行的记号说的
                        恰恰是「没有正确答案，它们不一样」 */}
                    {conflicting.includes(n)
                      ? mcp
                          .filter((m) => m.name === n)
                          .map((m) => (
                            <div key={m.client}>
                              <span className="text-neutral-400">{t.ofClient(m.client)}</span>
                              <Shape m={m} />
                            </div>
                          ))
                      : <Shape m={any} />}
                    {any.env_keys.length > 0 && (
                      <div className="text-neutral-400">{t.readsEnv(any.env_keys)}</div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/*
        同名不同配置的并排对比。**标一个记号只回答了「不一样」，
        没回答「哪儿不一样」** —— 而用户要做的决定恰恰是「以哪边为准」。
      */}
      {compare && (
        <Alert variant="warning" className="mt-3">
          <AlertDescription>
          <div className="flex items-baseline justify-between">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              <code>{compare}</code> {t.differs}
            </p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setCompare(null)}
            >
              {t.hide}
            </Button>
          </div>
          <div className="mt-2 space-y-2">
            {mcp
              .filter((m) => m.name === compare)
              .map((m) => {
                const peers = mcp.filter((x) => x.name === compare);
                // 只把**真的不一样**的字段标出来。全都标一遍等于没标
                const differs = (get: (x: McpView) => string) =>
                  new Set(peers.map(get)).size > 1;
                const cmd = (x: McpView) =>
                  x.url ? `${t.remote} ${x.url}` : `${x.command} ${x.args.join(" ")}`.trim();
                const hi = (on: boolean) =>
                  on
                    ? "rounded bg-amber-200 px-1 dark:bg-amber-900/60"
                    : "";
                return (
                  <div key={m.client} className="rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-900 dark:bg-black/20">
                    <div className="font-medium">{m.client}</div>
                    <div className="mt-0.5 font-mono">
                      <span className={hi(differs(cmd))}>{cmd(m)}</span>
                    </div>
                    {(m.env_keys.length > 0 || differs((x) => x.env_keys.join(","))) && (
                      <div className="mt-0.5 text-muted-foreground">
                        {t.env}{" "}
                        <span className={"font-mono " + hi(differs((x) => x.env_keys.join(",")))}>
                          {m.env_keys.length > 0 ? m.env_keys.join(" · ") : t.noEnv}
                        </span>
                        {/* **只有名字没有值** —— 值里常常就是密钥 */}
                      </div>
                    )}
                    <div className="mt-0.5 text-muted-foreground">
                      <span className={hi(differs((x) => String(x.enabled)))}>
                        {m.enabled ? t.enabled : t.disabled}
                      </span>
                      <span className="ml-2 font-mono tw-label">{m.source}</span>
                    </div>
                  </div>
                );
              })}
          </div>
          <p className="mt-2 text-amber-800 dark:text-amber-300">
            {t.unify}
          </p>
        </AlertDescription>
        </Alert>
      )}
    </section>
  );
}

/**
 * 点了格子之后的确认框。
 *
 * **和接管走同一条纪律**：字段级合并、写前全文备份、展示 diff
 * 让用户确认。往客户端配置里写东西，风险和接管完全一样。
 */
function McpConfirm({
  plan,
  req,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: PlanView;
  req: McpOpRequest;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(securityText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {req.op === "copy"
              ? t.copyTitle(req.name, req.to)
              : t.removeTitle(req.name, req.to)}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-1 tw-body text-muted-foreground">
          {t.modifies} <code>{plan.path}</code>
        </div>
        {plan.noop ? (
          <div className="mt-3 tw-body">{t.noop}</div>
        ) : (
          <>
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-neutral-50 p-2 tw-label leading-relaxed dark:bg-neutral-950">
              {plan.after}
            </pre>
            <div className="mt-2 tw-body text-muted-foreground">
              {t.backup}
              {req.op === "copy" && (
                <span className="text-amber-700 dark:text-amber-400">
                  {t.envCopied}
                </span>
              )}
            </div>
          </>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {common.cancel}
          </Button>
          {!plan.noop && (
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={busy}
            >
              {common.confirm}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
function Baseline({ b }: { b: BaselineResponse }) {
  const t = useText(securityText);
  if (b.unavailable) {
    // **「不是没发现，是没看」**要说出来
    return (
      <section>
        <h2 className="mb-1 tw-head font-medium">{t.behavior}</h2>
        <p className="tw-body text-muted-foreground">
          {t.unobserved}
          <Tip text={t.cannotCompareTip}>
            <span className="ml-1 underline decoration-dotted underline-offset-2">{t.cannotCompare}</span>
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
          <span className="ml-1 underline decoration-dotted underline-offset-2">{t.sampleRule}</span>
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
                  {t.metric(driftLabel(d.metric))}<span className="font-medium">{pct(d.recent)}</span>
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
                    <span className="ml-1 underline decoration-dotted underline-offset-2">{t.uninspected}</span>
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

/** 一个 MCP server 是什么形态。远端和本机的风险不是一回事。 */
function Shape({ m }: { m: McpView }) {
  const t = useText(securityText);
  if (m.url) {
    return (
      <>
        {t.remote} <code>{m.url}</code>
        {m.third_party && (
          <span className="ml-1 text-amber-600 dark:text-amber-400">{t.thirdParty}</span>
        )}
      </>
    );
  }
  return (
    <code className="break-all">
      {m.command} {m.args.join(" ")}
    </code>
  );
}

/** 一处发现的详情。**没有删除按钮** —— 删不删由用户自己去改文件。 */
function Detail({ f, onClose }: { f: ScanFinding; onClose: () => void }) {
  const t = useText(securityText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{f.title}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-2 tw-body text-muted-foreground">
          <div>{f.detail}</div>
          <div>
            <code>
              {f.path}:{f.line}
            </code>
          </div>
          {/* 不可见字符已经换成可见记号，否则这一行看起来和正常行一样，
              用户会以为我们在误报 */}
          <pre className="overflow-x-auto rounded bg-neutral-50 p-2 dark:bg-neutral-950">{f.excerpt}</pre>
          <div className="text-muted-foreground">
            {t.reportOnly}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {common.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
