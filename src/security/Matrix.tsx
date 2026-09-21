import { useState } from "react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { McpOpRequest, McpTargetView, McpView, PlanView } from "@/types";
import { securityText } from "@/Security.i18n";

/**
 * MCP 矩阵。
 *
 * M4 的简化版**只看不搬**：格子告诉你谁配了什么，同名不同配置标个记号。
 * 点格子执行复制是更完整的那一版，等这一版用顺了再说。
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
  const canWrite = (c: string) =>
    targets.find((t) => t.client === c)?.copyable ?? false;
  const whyNot = (c: string) =>
    coreText(targets.find((x) => x.client === c)?.why_not) || t.cannotWrite;
  const names = [...new Set(mcp.map((m) => m.name))].sort();
  if (names.length === 0) {
    return (
      <section>
        <h2 className="mb-1 tw-head font-medium">{t.mcp}</h2>
        <p className="tw-body text-muted-foreground">{t.noMcp}</p>
      </section>
    );
  }
  const at = (name: string, client: string) =>
    mcp.find((m) => m.name === name && m.client === client);

  return (
    <section>
      <h2 className="mb-1 tw-head font-medium">{t.mcpCount(names.length)}</h2>
      <p className="mb-2 tw-body text-muted-foreground">
        {t.mcpNote}
        <Tip text={t.mcpEditTip}>
          <span className="underline decoration-dotted underline-offset-2">
            {t.mcpEdit}
          </span>
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
                    const source = mcp.find(
                      (x) => x.name === n && canWrite(x.client),
                    );
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
                                : {
                                    op: "copy",
                                    name: n,
                                    from: source!.client,
                                    to: c,
                                  },
                            )
                          }
                        >
                          {!m ? (
                            <span className="text-neutral-300 dark:text-neutral-700">
                              ·
                            </span>
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
                    {conflicting.includes(n) ? (
                      mcp
                        .filter((m) => m.name === n)
                        .map((m) => (
                          <div key={m.client}>
                            <span className="text-neutral-400">
                              {t.ofClient(m.client)}
                            </span>
                            <Shape m={m} />
                          </div>
                        ))
                    ) : (
                      <Shape m={any} />
                    )}
                    {any.env_keys.length > 0 && (
                      <div className="text-neutral-400">
                        {t.readsEnv(any.env_keys)}
                      </div>
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
                    x.url
                      ? `${t.remote} ${x.url}`
                      : `${x.command} ${x.args.join(" ")}`.trim();
                  const hi = (on: boolean) =>
                    on ? "rounded bg-amber-200 px-1 dark:bg-amber-900/60" : "";
                  return (
                    <div
                      key={m.client}
                      className="rounded border border-amber-200 bg-white/60 p-2 dark:border-amber-900 dark:bg-black/20"
                    >
                      <div className="font-medium">{m.client}</div>
                      <div className="mt-0.5 font-mono">
                        <span className={hi(differs(cmd))}>{cmd(m)}</span>
                      </div>
                      {(m.env_keys.length > 0 ||
                        differs((x) => x.env_keys.join(","))) && (
                        <div className="mt-0.5 text-muted-foreground">
                          {t.env}{" "}
                          <span
                            className={
                              "font-mono " +
                              hi(differs((x) => x.env_keys.join(",")))
                            }
                          >
                            {m.env_keys.length > 0
                              ? m.env_keys.join(" · ")
                              : t.noEnv}
                          </span>
                          {/* **只有名字没有值** —— 值里常常就是密钥 */}
                        </div>
                      )}
                      <div className="mt-0.5 text-muted-foreground">
                        <span className={hi(differs((x) => String(x.enabled)))}>
                          {m.enabled ? t.enabled : t.disabled}
                        </span>
                        <span className="ml-2 font-mono tw-label">
                          {m.source}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
            <p className="mt-2 text-amber-800 dark:text-amber-300">{t.unify}</p>
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
export function McpConfirm({
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
            <Button size="sm" onClick={onConfirm} disabled={busy}>
              {common.confirm}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
          <span className="ml-1 text-amber-600 dark:text-amber-400">
            {t.thirdParty}
          </span>
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
