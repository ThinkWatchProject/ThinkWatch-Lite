import { useEffect, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";
import { useClients } from "@/clients/data";
import { useText } from "@/i18n";
import { cn } from "@/lib/utils";
import { useNav } from "@/nav";
import { Button } from "@/ui/button";
import { ClientLogo } from "@/ui/logos";
import { StatusLabel } from "@/ui/status-dot";
import { guideText } from "./guide.i18n";
import { markSetupSeen } from "./hints";

type StepState = "done" | "current" | "later";

/**
 * 概览上的「开始使用」：从装好到第一条请求经过网关的三步。
 *
 * 只在「从没用过」时出现（和原来的空状态同一个条件），第一条真正的请求一到就整块
 * 让位给用量数字。**每一步的勾都按此刻的事实打**：上游有几个、哪些客户端接进来了，
 * 不靠「点过那个按钮」—— 在别处加的上游、在客户端页接的客户端同样算数。
 *
 * 当前那一步（第一个没做完的）给按钮，后面的灰着不给：一次只指一个方向。第三步
 * 没有按钮可按，它等的是客户端里的一条消息，给一个在等的状态。
 */
export function SetupGuide({ upstreams, probes }: { upstreams: number; probes: number }) {
  const t = useText(guideText);
  const nav = useNav();
  const clients = useClients();

  useEffect(() => markSetupSeen(), []);

  const list = clients.data?.clients ?? [];
  const adopted = list.filter((c) => c.adopted_at_ms != null);
  const found = list.filter((c) => c.installed && c.adopted_at_ms == null && !c.managed);
  const manual = (clients.data?.manual ?? []).filter((m) => m.key != null);
  const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(t.listSep);

  const hasUpstream = upstreams > 0;
  // 手动配的（Cursor 之类）也算接进来了；客户端的探测被网关答过，说明它也连上了
  const hasClient = adopted.length > 0 || manual.length > 0 || probes > 0;
  const done = [hasUpstream, hasClient, false];
  const current = done.indexOf(false);
  const state = (i: number): StepState => (done[i] ? "done" : i === current ? "current" : "later");

  return (
    <section aria-labelledby="setup-title" className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 id="setup-title" className="tw-head">
          {t.setupTitle}
        </h2>
        <span className="tw-label tw-num text-muted-foreground">
          {t.setupProgress(done.filter(Boolean).length, done.length)}
        </span>
      </div>
      <ol>
        <Step
          n={1}
          state={state(0)}
          title={t.stepUpstream}
          detail={hasUpstream ? t.stepUpstreamDone(upstreams) : t.stepUpstreamTodo}
          action={
            <Button size="sm" onClick={() => nav.open("upstreams", { create: "upstream" })}>
              {t.newUpstream}
            </Button>
          }
        />
        <Step
          n={2}
          state={clients.data === undefined && !hasClient ? "later" : state(1)}
          title={t.stepClient}
          detail={
            adopted.length > 0 ? (
              t.stepClientDone(names(adopted))
            ) : manual.length > 0 ? (
              t.stepClientManual
            ) : found.length > 0 ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <span className="inline-flex items-center gap-1" aria-hidden>
                  {found.slice(0, 4).map((c) => (
                    <ClientLogo key={c.id} id={c.id} name={c.name} />
                  ))}
                </span>
                {t.stepClientFound(names(found))}
              </span>
            ) : clients.data !== undefined ? (
              t.stepClientNone
            ) : null
          }
          action={
            <Button size="sm" onClick={() => nav.open("clients")}>
              {t.goClients}
            </Button>
          }
        />
        <Step
          n={3}
          state={state(2)}
          title={t.stepRequest}
          detail={
            <>
              {t.stepRequestTodo}
              {probes > 0 && <span className="block">{t.probes(probes)}</span>}
            </>
          }
          action={<StatusLabel tone="pending">{t.waiting}</StatusLabel>}
        />
      </ol>
    </section>
  );
}

function Step({
  n,
  state,
  title,
  detail,
  action,
}: {
  n: number;
  state: StepState;
  title: string;
  detail: ReactNode;
  /** 只在当前那一步出现 */
  action: ReactNode;
}) {
  return (
    <li
      aria-current={state === "current" ? "step" : undefined}
      className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
    >
      <span
        className={cn(
          "mt-px flex size-5 shrink-0 items-center justify-center rounded-full border tw-label tw-num",
          state === "done" && "border-success/30 bg-success/10 text-success [&_svg]:size-3",
          state === "current" && "border-foreground/60 text-foreground",
          state === "later" && "border-border text-muted-foreground",
        )}
      >
        {state === "done" ? <CheckIcon aria-hidden /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("tw-head", state === "later" && "text-muted-foreground")}>{title}</p>
        {detail && <div className="mt-0.5 tw-body text-muted-foreground">{detail}</div>}
      </div>
      {state === "current" && <div className="-my-0.5 flex shrink-0 items-center">{action}</div>}
    </li>
  );
}
