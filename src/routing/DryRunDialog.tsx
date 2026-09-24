import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { BanIcon, ChevronRightIcon, CircleCheckIcon, CircleDotIcon, CircleMinusIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
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
import { Field, FieldLabel } from "@/ui/field";
import { IconRoute } from "@/ui/icons";
import { Input } from "@/ui/input";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Skeleton } from "@/ui/skeleton";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import {
  PROBES,
  formatLabel,
  groupKindLabel,
  mismatchText,
  setText,
  targetLabel,
  translatedText,
} from "@/labels";
import type {
  Dialect,
  DryRunResult,
  KnownModel,
  Overview,
  RouteInput,
  RuleTrace,
} from "@/types";
import { skipLabel } from "@/upstreams/labels";
import { FormItem } from "@/upstreams/parts";
import { api } from "./api";
import { dryRunText } from "./DryRunDialog.i18n";
import { ModelInput, onOpenFocus } from "./fields";
import { DIALECTS, usersOf } from "./model";
import { KeyIcon, TargetIcon } from "./parts";
import { routingText } from "./routing.i18n";

/** 按什么求值：密钥使用的路由、指定的路由、路由对话框里还没保存的草稿 */
export type DryRunTarget =
  | { kind: "key" }
  | { kind: "route"; name: string }
  | { kind: "draft"; route: RouteInput; keys: string[] };

/**
 * 试算。回答的不只是「会走到哪儿」，还有**「为什么没走我以为的那条」**：
 * 每条规则的匹配情况都列出来。**只计算，不发出请求。**
 *
 * 右边从上往下：结论（一句话 + 状态点）、这一趟经过的路（密钥 → 路由 → 规则 →
 * 去向，和页上的路由图同一套标志）、细节、逐条匹配明细。输入一变就重算，重算时
 * 旧结果淡一档留着，不闪成空白。
 */
export function DryRunDialog({
  target,
  ov,
  models,
  onClose,
}: {
  target: DryRunTarget;
  ov: Overview;
  models: KnownModel[];
  onClose: () => void;
}) {
  const t = useText(dryRunText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const uid = useId();
  const firstKey =
    target.kind === "key"
      ? (ov.clients[0]?.name ?? "")
      : target.kind === "route"
        ? (() => {
            const r = ov.routes.find((x) => x.name === target.name);
            return r ? (usersOf(r, ov.clients)[0] ?? "") : "";
          })()
        : (target.keys[0] ?? "");
  const [client, setClient] = useState(firstKey);
  const [model, setModel] = useState(models[0]?.id ?? "claude-sonnet-4-5");
  const [dialect, setDialect] = useState<Dialect>("anthropic");
  const [kTokens, setKTokens] = useState("8");
  const [maxTokens, setMaxTokens] = useState("");
  const [flags, setFlags] = useState({
    cache: false,
    tools: false,
    image: false,
    thinking: false,
    stream: true,
  });
  const [toolCount, setToolCount] = useState("5");
  const [intent, setIntent] = useState("");
  const [r, setR] = useState<DryRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const keyRoute = (name: string) =>
    ov.clients.find((c) => c.name === name)?.route ??
    ov.routes.find((x) => x.default)?.name ??
    "";

  const req = useMemo(
    () => ({
      model: model.trim(),
      client,
      route: target.kind === "route" ? target.name : null,
      draft: target.kind === "draft" ? target.route : null,
      dialect,
      input_tokens: Math.round((Number.parseFloat(kTokens) || 0) * 1000),
      max_tokens: /^\d+$/.test(maxTokens.trim()) ? Number(maxTokens.trim()) : null,
      cache: flags.cache,
      tools: flags.tools,
      tool_count: flags.tools ? Number.parseInt(toolCount, 10) || 0 : 0,
      image: flags.image,
      thinking: flags.thinking,
      stream: flags.stream,
      intent,
    }),
    [model, client, target, dialect, kTokens, maxTokens, flags, toolCount, intent],
  );

  // 输入一变就重算：只计算，不发请求，没有必要等一个按钮
  useEffect(() => {
    if (!req.model) return;
    let alive = true;
    setBusy(true);
    const h = setTimeout(() => {
      api
        .dryRun(req)
        .then((res) => {
          if (!alive) return;
          setR(res);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e))
        .finally(() => alive && setBusy(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [req]);

  const routeName =
    target.kind === "key" ? keyRoute(client) : target.kind === "route" ? target.name : target.route.name;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[880px]"
        // 打开就已经按默认输入算好了：先看结果，焦点不落进第一个下拉
        onOpenAutoFocus={(e) => onOpenFocus(e, true)}
      >
        <DialogHeader>
          <DialogTitle className="tw-title">{rt.dryRun}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] overflow-y-auto border-t border-border">
          <div className="flex flex-col gap-3.5 border-r border-border bg-surface/40 p-4">
            {target.kind !== "key" && (
              <FormItem label={t.route}>
                <div className="flex h-8 items-center gap-1.5">
                  <IconRoute aria-hidden className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{routeName}</span>
                  {target.kind === "draft" && <Badge variant="outline">{t.unsaved}</Badge>}
                </div>
              </FormItem>
            )}
            <FormItem
              label={t.key}
              htmlFor={`${uid}-key`}
              desc={target.kind === "key" ? t.usesRoute(routeName) : t.keyConditions}
            >
              <NativeSelect
                id={`${uid}-key`}
                className="w-full"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              >
                {target.kind !== "key" && <NativeSelectOption value="">{t.noKey}</NativeSelectOption>}
                {ov.clients.map((c) => (
                  <NativeSelectOption key={c.name} value={c.name}>
                    {c.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormItem>
            <FormItem label={t.model} htmlFor={`${uid}-model`}>
              <ModelInput id={`${uid}-model`} value={model} onChange={setModel} models={models.map((m) => m.id)} />
            </FormItem>
            <FormItem label={t.dialect} htmlFor={`${uid}-dialect`}>
              <NativeSelect
                id={`${uid}-dialect`}
                className="w-full"
                value={dialect}
                onChange={(e) => setDialect(DIALECTS.find((d) => d === e.target.value) ?? dialect)}
              >
                {DIALECTS.map((d) => (
                  <NativeSelectOption key={d} value={d}>
                    {formatLabel(d)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormItem>
            <div className="grid grid-cols-2 gap-3">
              <FormItem label={t.inputTokens} htmlFor={`${uid}-tokens`}>
                <div className="flex items-center gap-1.5">
                  <Input
                    id={`${uid}-tokens`}
                    className="font-mono"
                    inputMode="decimal"
                    value={kTokens}
                    onChange={(e) => setKTokens(e.target.value)}
                  />
                  <span className="text-muted-foreground">k</span>
                </div>
              </FormItem>
              <FormItem label="max_tokens" htmlFor={`${uid}-max`}>
                <Input
                  id={`${uid}-max`}
                  className="font-mono"
                  inputMode="numeric"
                  placeholder={t.notSet}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(e.target.value)}
                />
              </FormItem>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {(["cache", "tools", "image", "thinking", "stream"] as const).map((k) => (
                <Field key={k} orientation="horizontal" className="w-auto">
                  <Checkbox
                    id={`${uid}-${k}`}
                    checked={flags[k]}
                    onCheckedChange={(v) => setFlags((f) => ({ ...f, [k]: v === true }))}
                  />
                  <FieldLabel htmlFor={`${uid}-${k}`} className="font-normal">
                    {t.flags[k]}
                  </FieldLabel>
                </Field>
              ))}
            </div>
            {flags.tools && (
              <FormItem label={t.toolCount} htmlFor={`${uid}-toolcount`}>
                <Input
                  id={`${uid}-toolcount`}
                  className="w-24 font-mono"
                  inputMode="numeric"
                  value={toolCount}
                  onChange={(e) => setToolCount(e.target.value)}
                />
              </FormItem>
            )}
            <FormItem label={t.intent} htmlFor={`${uid}-intent`}>
              <NativeSelect
                id={`${uid}-intent`}
                className="w-full"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
              >
                <NativeSelectOption value="">{t.userRequest}</NativeSelectOption>
                {PROBES.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </FormItem>
          </div>

          <div className="flex min-w-0 flex-col gap-4 p-4" aria-live="polite" aria-busy={busy || undefined}>
            <Banner layout="inline" tone="error" show={error !== null} title={t.failed}>
              {error !== null && errorText(error)}
            </Banner>
            {r ? (
              <div
                className={cn(
                  "flex flex-col gap-4 transition-opacity duration-(--motion-base) ease-(--motion-ease)",
                  (busy || error !== null) && "opacity-55",
                )}
              >
                <Result r={r} ov={ov} client={client} draft={target.kind === "draft"} />
              </div>
            ) : error === null ? (
              <ResultSkeleton />
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {ct.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 第一次算出来之前：和结果同样的骨架，算好了不跳 */
function ResultSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3.5">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-80" />
      </div>
      <div className="flex flex-col gap-2.5">
        {[64, 48, 72, 40].map((w, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

/** 结论的语气：转发成了是 ok，拒绝和无路可走是 error，规则没参与的是 idle */
function verdictTone(r: DryRunResult): StatusTone {
  switch (r.outcome) {
    case "route":
      return "ok";
    case "intercepted":
    case "passthrough":
      return "idle";
    default:
      return "error";
  }
}

function Result({
  r,
  ov,
  client,
  draft,
}: {
  r: DryRunResult;
  ov: Overview;
  client: string;
  draft: boolean;
}) {
  const t = useText(dryRunText);
  const rt = useText(routingText);
  const ct = useText(commonText);
  const decided = r.trace.findIndex((x) => x.effect === "decide");
  const route = ov.routes.find((x) => x.name === r.route);
  const key = ov.clients.find((c) => c.name === client);
  /**
   * 这个请求在规则之前就有了去向。
   *
   * **那时下面每一格都不适用** —— 路由、候选、改写说的都是规则走完之后
   * 的事，而一条规则都没走。留着它们只会让人以为它真的去了那儿。
   */
  const short = r.outcome === "intercepted" || r.outcome === "passthrough";
  const target = r.outcome === "route" ? (r.via_group ?? r.candidates[0] ?? null) : null;

  // 这一趟经过的路：密钥 → 路由 → 规则 → 去向。和路由图同一套标志
  const steps: ReactNode[] = [];
  if (key) {
    steps.push(
      <Step key="key">
        <KeyIcon k={key} size={13} />
        {key.name}
      </Step>,
    );
  }
  if (!short) {
    steps.push(
      <Step key="route">
        <IconRoute aria-hidden className="size-3.5 text-muted-foreground" />
        {r.route}
      </Step>,
    );
    if (r.rule) steps.push(<Step key="rule">{r.rule}</Step>);
  }
  if (target) {
    steps.push(
      <Step key="target" strong>
        <TargetIcon name={target} providers={ov.providers} size={13} />
        {targetLabel(target)}
      </Step>,
    );
  } else if (r.outcome === "deny") {
    steps.push(
      <Step key="deny" className="text-destructive">
        <BanIcon aria-hidden className="size-3.5" />
        {rt.deny}
      </Step>,
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface/50 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot tone={verdictTone(r)} size="md" />
          <span className="tw-title">{headline(r)}</span>
          {r.outcome === "route" && r.strategy && <Badge variant="outline">{groupKindLabel(r.strategy)}</Badge>}
        </div>
        {steps.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 tw-body">
            {steps.map((s, i) => (
              <Fragment key={i}>
                {i > 0 && <ChevronRightIcon aria-hidden className="size-3.5 text-muted-foreground/60" />}
                {s}
              </Fragment>
            ))}
          </div>
        )}
        {r.outcome === "deny" && r.reason && <p className="tw-body text-muted-foreground">{t.reason(r.reason)}</p>}
        {short && (
          <div className="flex flex-col gap-1 tw-body text-muted-foreground">
            <span>{r.outcome === "intercepted" ? t.interceptedWhat : t.passedThroughWhat}</span>
            <span>{t.howToRoute}</span>
          </div>
        )}
      </div>

      {/* 标签列 80px：中文的四个字只要 64，英文的 Matched rule 要 79 */}
      {!short && (
        <dl className="grid grid-cols-[80px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2.5 tw-body">
          <dt className="text-muted-foreground">{t.route}</dt>
          <dd>
            {r.route}
            {!draft && route?.default && <span className="text-muted-foreground">{t.defaultRoute}</span>}
            {draft && <span className="text-muted-foreground">{t.unsavedChanges}</span>}
          </dd>
          {r.rule && (
            <>
              <dt className="text-muted-foreground">{t.matchedRule}</dt>
              <dd>
                {r.rule}
                {decided >= 0 && <span className="text-muted-foreground">{t.position(decided + 1)}</span>}
              </dd>
            </>
          )}
          {r.outcome === "route" && (
            <>
              <dt className="text-muted-foreground">{t.attempts}</dt>
              <dd className="flex flex-col gap-1">
                {r.candidates.map((c, i) => {
                  const open = r.circuit_open.includes(c);
                  const conv = r.converted.find((x) => x.provider === c);
                  return (
                    <div key={c} className="flex flex-wrap items-center gap-x-2">
                      <span className="w-3 tw-num text-muted-foreground">{i + 1}</span>
                      <TargetIcon name={c} providers={ov.providers} size={13} />
                      <span className={cn("font-medium", open && "text-muted-foreground line-through")}>{c}</span>
                      {open && (
                        <span className="inline-flex items-center gap-1 tw-label text-warning">
                          <StatusDot tone="warn" />
                          {t.circuitOpen}
                        </span>
                      )}
                      {conv && (
                        <span className="tw-label text-muted-foreground">{t.converted(translatedText(conv))}</span>
                      )}
                    </div>
                  );
                })}
              </dd>
            </>
          )}
          {r.skipped.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t.skipped}</dt>
              <dd>
                {r.skipped.map((s, i) => (
                  <span key={s.provider}>
                    {i > 0 && rt.listSep}
                    {s.provider}
                    <span className="text-muted-foreground">{t.skipReason(skipLabel(s.reason))}</span>
                  </span>
                ))}
              </dd>
            </>
          )}
          {r.outcome === "route" && (
            <>
              <dt className="text-muted-foreground">{t.rewrites}</dt>
              <dd className="flex flex-col gap-0.5">
                {r.set.length === 0 ? (
                  <span className="text-muted-foreground">{ct.none}</span>
                ) : (
                  r.set.map((s) => <span key={s.field}>{setText(s)}</span>)
                )}
              </dd>
            </>
          )}
        </dl>
      )}
      {r.hurts_cache && (
        <Banner layout="inline" tone="warning">
          {t.hurtsCache}
        </Banner>
      )}

      {/* 一条规则都没求值时不画这个框 —— 空框比不画更像出了错 */}
      {r.trace.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="border-b border-border bg-surface/60 px-3 py-1.5 tw-head">{t.trace}</div>
          <ol>
            {r.trace.map((x, i) => {
              const v = traceView(x, decided);
              return (
                <li
                  key={x.name}
                  className={cn(
                    "flex items-start gap-2 border-b border-border px-3 py-1.5 tw-body last:border-b-0",
                    v.icon === "hit" && x.effect === "decide" && "bg-success/[0.06]",
                  )}
                >
                  <span className={cn("mt-[3px]", v.tone === "ok" ? "text-success" : "text-muted-foreground")}>
                    {v.icon === "hit" ? (
                      <CircleCheckIcon className="size-3.5" />
                    ) : v.icon === "later" ? (
                      <CircleDotIcon className="size-3.5" />
                    ) : (
                      <CircleMinusIcon className="size-3.5" />
                    )}
                  </span>
                  <span className="w-5 shrink-0 tw-num text-muted-foreground">{i + 1}</span>
                  <span className="w-28 shrink-0 truncate font-medium">{x.name}</span>
                  <span
                    className={cn(
                      "min-w-0",
                      v.tone === "warn" ? "text-warning" : v.tone === "ok" ? "" : "text-muted-foreground",
                    )}
                  >
                    {v.text}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </>
  );
}

/** 路上的一站：标志加名字 */
function Step({ children, strong, className }: { children: ReactNode; strong?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-background px-2",
        strong && "border-foreground/30 font-medium",
        className,
      )}
    >
      {children}
    </span>
  );
}

function headline(r: DryRunResult): string {
  const m = textOf(dryRunText);
  switch (r.outcome) {
    case "route":
      return r.via_group ? m.viaGroup(targetLabel(r.via_group)) : m.toUpstream(r.candidates[0] ?? "");
    case "deny":
      return m.denied;
    case "unavailable":
      return m.unavailable;
    case "intercepted":
      return m.intercepted;
    case "passthrough":
      return m.passedThrough;
    default:
      return m.noMatch;
  }
}

/** 规则匹配明细里的一行 */
function traceView(
  t: RuleTrace,
  decided: number,
): {
  text: string;
  tone: "ok" | "muted" | "warn";
  icon: "hit" | "later" | "miss";
} {
  const m = textOf(dryRunText);
  if (t.verdict === "matched") {
    if (t.effect === "decide") return { text: m.decides, tone: "ok", icon: "hit" };
    if (t.effect === "apply") return { text: m.applies, tone: "ok", icon: "hit" };
    return {
      text: decided >= 0 ? m.decidedBy(decided + 1) : m.matched,
      tone: "muted",
      icon: "hit",
    };
  }
  if (t.verdict === "phase_two") return { text: m.phaseTwo, tone: "muted", icon: "later" };
  if (t.error) return { text: coreText(t.error), tone: "warn", icon: "miss" };
  return {
    text: t.mismatch ? m.missedBecause(mismatchText(t.mismatch)) : m.missed,
    tone: "muted",
    icon: "miss",
  };
}
