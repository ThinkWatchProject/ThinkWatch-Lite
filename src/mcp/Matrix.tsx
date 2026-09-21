import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { McpOpRequest, McpTargetView, McpView, PlanView } from "@/types";
import { mcpText } from "./McpPage.i18n";

/**
 * MCP 服务器矩阵：行是服务器，列是客户端。
 *
 * **不能写的客户端也在表里** —— 看得见是第一目标，只是它的格子点不动。
 * 点空格从已配置它的客户端复制过来，点已配置的格子从那个客户端移除；两样都
 * 先算出改动给用户确认，不直接写。
 */
export function Matrix({
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
  const t = useText(mcpText);
  /** 正在对比的那个同名服务器 */
  const [compare, setCompare] = useState<string | null>(null);
  // 列 = 所有能写的位置 ∪ 已经配了东西的位置
  const clients = [...new Set([...targets.map((x) => x.client), ...mcp.map((m) => m.client)])];
  const nameOf = (c: string) => targets.find((x) => x.client === c)?.name ?? c;
  const canWrite = (c: string) => targets.find((x) => x.client === c)?.copyable ?? false;
  const whyNot = (c: string) => coreText(targets.find((x) => x.client === c)?.why_not) || t.cannotWrite;
  const names = [...new Set(mcp.map((m) => m.name))].sort();
  const at = (name: string, client: string) => mcp.find((m) => m.name === name && m.client === client);

  if (names.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center tw-body text-muted-foreground">
        {t.noMcp}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* 服务器一列至少留 200px：客户端多、窗口窄时横向滚，而不是把名字挤没 */}
      <Table className="table-fixed" style={{ minWidth: 200 + clients.length * 116 }}>
        <colgroup>
          <col />
          {/* 116px 放得下「Claude Desktop」：列名用客户端的名字，不用标识 */}
          {clients.map((c) => (
            <col key={c} className="w-[116px]" />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t.server}</TableHead>
            {clients.map((c) => (
              <TableHead key={c} className="truncate text-center" title={nameOf(c)}>
                {nameOf(c)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {names.map((n) => {
            const any = mcp.find((m) => m.name === n)!;
            const differs = conflicting.includes(n);
            return (
              <TableRow key={n}>
                <TableCell className="py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{n}</span>
                    {differs && (
                      <Tip text={t.differsTip}>
                        <Badge variant="warning" asChild>
                          <button type="button" onClick={() => setCompare(n)}>
                            {t.differs}
                          </button>
                        </Badge>
                      </Tip>
                    )}
                  </div>
                  {/*
                    **同名不同配置时不挑一份显示。**挑一个等于替用户选了「正确
                    答案」，而那个记号说的恰恰是「它们不一样」—— 点记号并排看。
                  */}
                  {!differs && (
                    <div className="truncate tw-label text-muted-foreground">
                      <Shape m={any} />
                      {any.env_keys.length > 0 && ` · ${t.readsEnv(any.env_keys)}`}
                    </div>
                  )}
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
                      ? t.removeFrom(nameOf(c))
                      : source
                        ? t.copyFrom(nameOf(source.client), nameOf(c))
                        : t.noSource;
                  const state = !m ? t.none : m.enabled ? t.enabled : t.disabled;
                  return (
                    <TableCell key={c} className="text-center">
                      <Tip text={m && !m.enabled ? `${title} · ${t.disabledTip}` : title}>
                        {/* 点不动的格子也要能悬停看原因：外面包一层接住指针 */}
                        <span className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t.cellLabel(n, nameOf(c), state)}
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
                              <span className="text-muted-foreground/50">·</span>
                            ) : m.enabled ? (
                              <CheckIcon />
                            ) : (
                              <span className="text-muted-foreground">○</span>
                            )}
                          </Button>
                        </span>
                      </Tip>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 tw-label text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CheckIcon className="size-3" /> {t.enabled}
        </span>
        <span>○ {t.disabled}</span>
        <span>· {t.none}</span>
        <span>{t.legendNote}</span>
      </p>

      {compare && (
        <Compare
          name={compare}
          peers={mcp.filter((m) => m.name === compare)}
          nameOf={nameOf}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}

/**
 * 同名不同配置，并排看。**只把真的不一样的字段标出来** —— 全都标一遍等于没标。
 */
function Compare({
  name,
  peers,
  nameOf,
  onClose,
}: {
  name: string;
  peers: McpView[];
  nameOf: (client: string) => string;
  onClose: () => void;
}) {
  const t = useText(mcpText);
  const common = useText(commonText);
  const differs = (get: (x: McpView) => string) => new Set(peers.map(get)).size > 1;
  const cmd = (x: McpView) => (x.url ? `${t.remote} ${x.url}` : `${x.command} ${x.args.join(" ")}`.trim());
  const env = (x: McpView) => x.env_keys.join(",");
  const hi = (on: boolean) => (on ? "rounded-sm bg-amber-200/80 px-1 dark:bg-amber-400/30" : "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.compareTitle(name)}</DialogTitle>
          <DialogDescription>{t.compareDesc}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {peers.map((m) => (
            <div key={m.client} className="rounded-md border border-border px-3 py-2 tw-body">
              <div className="font-medium">{nameOf(m.client)}</div>
              <div className="mt-0.5 font-mono tw-label break-all">
                <span className={hi(differs(cmd))}>{cmd(m)}</span>
              </div>
              {(m.env_keys.length > 0 || differs(env)) && (
                <div className="mt-0.5 tw-label text-muted-foreground">
                  {t.env}{" "}
                  <span className={"font-mono " + hi(differs(env))}>
                    {m.env_keys.length > 0 ? m.env_keys.join(" · ") : t.noEnv}
                  </span>
                </div>
              )}
              <div className="mt-0.5 tw-label text-muted-foreground">
                <span className={hi(differs((x) => String(x.enabled)))}>{m.enabled ? t.enabled : t.disabled}</span>
                <span className="ml-2 font-mono">{m.source}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="tw-label text-muted-foreground">{t.unify}</p>
        <DialogFooter>
          <Button onClick={onClose}>{common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 点了格子之后的确认框。
 *
 * **和接管走同一条纪律**：字段级合并、写前全文备份、展示改动让用户确认。
 * 往客户端配置里写东西，风险和接管完全一样。
 */
export function McpConfirm({
  plan,
  req,
  nameOf,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: PlanView;
  req: McpOpRequest;
  nameOf: (client: string) => string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(mcpText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {req.op === "copy" ? t.copyTitle(req.name, nameOf(req.to)) : t.removeTitle(req.name, nameOf(req.to))}
          </DialogTitle>
          <DialogDescription>
            {t.modifies} <code className="font-mono">{plan.path}</code>
          </DialogDescription>
        </DialogHeader>
        {plan.noop ? (
          <p className="tw-body">{t.noop}</p>
        ) : (
          <>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted/50 p-2 font-mono tw-label leading-relaxed">
              {plan.after}
            </pre>
            <p className="tw-label text-muted-foreground">
              {t.backup}
              {req.op === "copy" && <span className="text-warning">{t.envCopied}</span>}
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {common.cancel}
          </Button>
          {!plan.noop && (
            <Button onClick={onConfirm} disabled={busy}>
              {common.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 一个 MCP 服务器是什么形态。**远端和本机的风险不是一回事** */
function Shape({ m }: { m: McpView }) {
  const t = useText(mcpText);
  if (m.url) {
    return (
      <>
        {t.remote} <span className="font-mono">{m.url}</span>
        {m.third_party && (
          <Tip text={t.thirdPartyTip}>
            <Badge variant="warning" className="ml-1.5">
              {t.thirdParty}
            </Badge>
          </Tip>
        )}
      </>
    );
  }
  return (
    <span className="font-mono">
      {m.command} {m.args.join(" ")}
    </span>
  );
}
