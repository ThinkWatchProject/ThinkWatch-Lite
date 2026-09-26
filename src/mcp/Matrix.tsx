import { CheckIcon, CircleIcon, MinusIcon, PlugIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { ClientLogo } from "@/ui/logos";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState } from "@/ui/states";
import { StatusLabel } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { Diff } from "@/clients/PlanDialog";
import { ROW_FOCUS, rowNav, stop } from "@/security/rows";
import type { McpOpRequest, McpTargetView, McpView, PlanView } from "@/types";
import { mcpText } from "./McpPage.i18n";
import { shortPath } from "./parts";

/**
 * MCP 服务器矩阵：行是服务器，列是客户端（带各自的标志）。
 *
 * **不能写的客户端也在表里** —— 看得见是第一目标，只是它的格子点不动。
 * 点空格从已配置它的客户端复制过来（悬停时是「+」），点已配置的格子从那个
 * 客户端移除（悬停时是「−」）；两样都先算出改动给用户确认，不直接写。点一行
 * 看它在各客户端里的配置，右键和行尾是同一份菜单。
 */
export function Matrix({
  mcp,
  conflicting,
  targets,
  busy,
  rescanning,
  onAsk,
  onOpen,
  onRescan,
  onMove,
}: {
  mcp: McpView[];
  conflicting: string[];
  targets: McpTargetView[];
  /** 正在算改动或写入：格子先点不动 */
  busy: boolean;
  rescanning: boolean;
  onAsk: (req: McpOpRequest) => void;
  /** 看一个服务器在各客户端里的配置 */
  onOpen: (name: string) => void;
  onRescan: () => void;
  /** 更改一个客户端的配置位置（列头的右键菜单） */
  onMove: (client: string) => void;
}) {
  const t = useText(mcpText);
  // 列 = 所有能写的位置 ∪ 已经配了东西的位置
  const clients = [...new Set([...targets.map((x) => x.client), ...mcp.map((m) => m.client)])];
  const nameOf = (c: string) => targets.find((x) => x.client === c)?.name ?? c;
  const canWrite = (c: string) => targets.find((x) => x.client === c)?.copyable ?? false;
  const whyNot = (c: string) => coreText(targets.find((x) => x.client === c)?.why_not) || t.cannotWrite;
  const movable = (c: string) => targets.find((x) => x.client === c)?.movable ?? false;
  const names = [...new Set(mcp.map((m) => m.name))].sort();
  const at = (name: string, client: string) => mcp.find((m) => m.name === name && m.client === client);
  const shown = usePresentList(names, (n) => n);

  if (names.length === 0) {
    return (
      <EmptyState
        icon={<PlugIcon />}
        title={t.noMcp}
        description={t.noMcpHint}
        action={
          <Button size="sm" variant="outline" pending={rescanning} onClick={onRescan}>
            {!rescanning && <RefreshCwIcon />}
            {t.rescan}
          </Button>
        }
      />
    );
  }

  /** 一个服务器能做的改动：复制到还没有它的客户端、从有它的客户端移除 */
  function menu(n: string): MenuItems {
    const source = mcp.find((x) => x.name === n && canWrite(x.client));
    const copies = clients.filter((c) => canWrite(c) && !at(n, c) && source);
    const removes = clients.filter((c) => canWrite(c) && at(n, c));
    return [
      { kind: "item", label: t.viewConfig, onSelect: () => onOpen(n) },
      ...(copies.length + removes.length > 0 ? [{ kind: "sep" as const }] : []),
      ...copies.map((c) => ({
        kind: "item" as const,
        label: t.copyTo(nameOf(c)),
        disabled: busy,
        onSelect: () => onAsk({ op: "copy", name: n, from: source!.client, to: c }),
      })),
      ...removes.map((c) => ({
        kind: "item" as const,
        label: t.removeFrom(nameOf(c)),
        danger: true,
        disabled: busy,
        onSelect: () => onAsk({ op: "remove", name: n, from: null, to: c }),
      })),
    ];
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 服务器一列至少留 220px：客户端多、窗口窄时横向滚，而不是把名字挤没 */}
      <Table className="table-fixed" style={{ minWidth: 220 + 36 + clients.length * 120 }}>
        <colgroup>
          <col />
          {/* 120px 放得下标志加「Claude Desktop」：列名用客户端的名字，不用标识 */}
          {clients.map((c) => (
            <col key={c} className="w-[120px]" />
          ))}
          <col className="w-9" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t.server}</TableHead>
            {clients.map((c) => {
              const head = (
                <TableHead key={c} className="text-center" title={nameOf(c)}>
                  <span className="inline-flex max-w-full items-center justify-center gap-1.5">
                    <ClientLogo id={c} name={nameOf(c)} size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{nameOf(c)}</span>
                  </span>
                </TableHead>
              );
              // 列头右键：更改这个客户端的配置位置
              return movable(c) ? (
                <RowMenu key={c} items={[{ kind: "item", label: t.changePath, onSelect: () => onMove(c) }]}>
                  {head}
                </RowMenu>
              ) : (
                head
              );
            })}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(({ item: n, key, presence }) => {
            const any = mcp.find((m) => m.name === n);
            const differs = conflicting.includes(n);
            const items = menu(n);
            return (
              <RowMenu key={key} items={items}>
                <TableRow
                  className={cn("cursor-default", ROW_FOCUS, rowMotion(presence))}
                  onClick={() => onOpen(n)}
                  {...rowNav(() => onOpen(n))}
                >
                  <TableCell className="py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{n}</span>
                      {differs && (
                        <Tip text={t.differsTip}>
                          <Badge variant="warning">{t.differs}</Badge>
                        </Tip>
                      )}
                      {!differs && any?.third_party && (
                        <Tip text={t.thirdPartyTip}>
                          <Badge variant="warning">{t.thirdParty}</Badge>
                        </Tip>
                      )}
                    </div>
                    {/*
                      **同名不同配置时不挑一份显示。**挑一个等于替用户选了「正确
                      答案」，而那个记号说的恰恰是「它们不一样」—— 点开并排看。
                    */}
                    {!differs && any && (
                      <div className="truncate tw-label text-muted-foreground">
                        <Shape m={any} />
                        {any.env_keys.length > 0 && ` · ${t.readsEnv(any.env_keys)}`}
                      </div>
                    )}
                  </TableCell>
                  {clients.map((c) => (
                    <TableCell key={c} className="text-center" {...stop}>
                      <Cell
                        server={n}
                        client={c}
                        m={at(n, c)}
                        clientName={nameOf(c)}
                        writable={canWrite(c)}
                        whyNot={whyNot(c)}
                        source={mcp.find((x) => x.name === n && canWrite(x.client))}
                        sourceName={(s) => nameOf(s)}
                        busy={busy}
                        onAsk={onAsk}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="text-right" {...stop}>
                    <RowMenuButton items={items} label={t.actionsFor(n)} />
                  </TableCell>
                </TableRow>
              </RowMenu>
            );
          })}
        </TableBody>
      </Table>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 tw-label text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CheckIcon className="size-3 text-foreground" /> {t.enabled}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CircleIcon className="size-2.5" /> {t.disabled}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1 rounded-full bg-muted-foreground/50" /> {t.none}
        </span>
        <span>{t.legendNote}</span>
      </p>
    </div>
  );
}

/**
 * 矩阵的一格。已启用打勾，停用画空心圈，没配置是一个小点；能点的格子悬停时
 * 换成它会做的事（「+」复制过来，「−」移除）。点不动的格子也要能悬停看原因：
 * 外面包一层接住指针。
 */
function Cell({
  server,
  client,
  m,
  clientName,
  writable,
  whyNot,
  source,
  sourceName,
  busy,
  onAsk,
}: {
  server: string;
  client: string;
  m: McpView | undefined;
  clientName: string;
  writable: boolean;
  whyNot: string;
  /** 空格子从哪儿抄过来。多个来源时用第一个能抄的 */
  source: McpView | undefined;
  sourceName: (client: string) => string;
  busy: boolean;
  onAsk: (req: McpOpRequest) => void;
}) {
  const t = useText(mcpText);
  const can = writable && (m ? true : !!source);
  const title = !writable
    ? whyNot
    : m
      ? t.removeFrom(clientName)
      : source
        ? t.copyFrom(sourceName(source.client), clientName)
        : t.noSource;
  const state = !m ? t.none : m.enabled ? t.enabled : t.disabled;
  return (
    <Tip text={m && !m.enabled ? `${title} · ${t.disabledTip}` : title}>
      <span className="inline-flex">
        <Button
          variant="ghost"
          size="icon-xs"
          className="group/cell"
          aria-label={t.cellLabel(server, clientName, state)}
          disabled={!can || busy}
          onClick={() =>
            can &&
            onAsk(
              m
                ? { op: "remove", name: server, from: null, to: client }
                : { op: "copy", name: server, from: source!.client, to: client },
            )
          }
        >
          <span className={cn("inline-flex", can && "group-hover/cell:hidden")}>
            {!m ? (
              <span className="size-1 rounded-full bg-muted-foreground/50" />
            ) : m.enabled ? (
              <CheckIcon className="size-3.5! text-foreground" />
            ) : (
              <CircleIcon className="size-2.5! text-muted-foreground" />
            )}
          </span>
          {can &&
            (m ? (
              <MinusIcon className="hidden size-3.5! text-muted-foreground group-hover/cell:inline" />
            ) : (
              <PlusIcon className="hidden size-3.5! text-muted-foreground group-hover/cell:inline" />
            ))}
        </Button>
      </span>
    </Tip>
  );
}

/**
 * 一个服务器在各客户端里的配置，一个客户端一块。
 *
 * **同名不同配置时只把真的不一样的字段标出来** —— 全都标一遍等于没标。
 */
export function ServerDialog({
  name,
  peers,
  differs,
  nameOf,
  onClose,
}: {
  name: string;
  peers: McpView[];
  differs: boolean;
  nameOf: (client: string) => string;
  onClose: () => void;
}) {
  const t = useText(mcpText);
  const common = useText(commonText);
  const varies = (get: (x: McpView) => string) => differs && new Set(peers.map(get)).size > 1;
  const cmd = (x: McpView) => (x.url ? `${t.remote} ${x.url}` : `${x.command} ${x.args.join(" ")}`.trim());
  const env = (x: McpView) => x.env_keys.join(",");
  const hi = (on: boolean) =>
    on ? "rounded-[3px] bg-warning/25 shadow-[inset_0_-1.5px_0_0_var(--warning)] box-decoration-clone" : "";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{name}</span>
            {differs && <Badge variant="warning">{t.differs}</Badge>}
          </DialogTitle>
          <DialogDescription>{differs ? t.compareDesc : t.configuredIn(peers.length)}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
          {peers.map((m) => (
            <div key={m.client} className="rounded-lg border border-border bg-surface/40 px-3.5 py-2.5 tw-body">
              <div className="flex min-w-0 items-center gap-2">
                <ClientLogo id={m.client} name={nameOf(m.client)} className="shrink-0" />
                <span className="font-medium">{nameOf(m.client)}</span>
                <span className="flex-1" />
                <span className={cn(varies((x) => String(x.enabled)) && hi(true), "px-0.5")}>
                  <StatusLabel tone={m.enabled ? "ok" : "idle"} muted>
                    {m.enabled ? t.enabled : t.disabled}
                  </StatusLabel>
                </span>
              </div>
              <div className="mt-1.5 font-mono tw-label break-all text-foreground">
                <span className={hi(varies(cmd))}>{cmd(m)}</span>
              </div>
              {(m.env_keys.length > 0 || varies(env)) && (
                <div className="mt-1 tw-label text-muted-foreground">
                  {t.env}{" "}
                  <span className={cn("font-mono", hi(varies(env)))}>
                    {m.env_keys.length > 0 ? m.env_keys.join(" · ") : t.noEnv}
                  </span>
                </div>
              )}
              <div className="mt-1 truncate font-mono tw-label text-muted-foreground" title={m.source}>
                {shortPath(m.source)}
              </div>
            </div>
          ))}
        </div>
        {differs && <p className="tw-label text-muted-foreground">{t.unify}</p>}
        <DialogFooter>
          <Button onClick={onClose}>{common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 点了格子之后的确认框：改哪个文件、改成什么样（逐行 diff）。
 *
 * **和接管走同一条纪律**：字段级合并、写前全文备份、展示改动让用户确认。
 * 往客户端配置里写东西，风险和接管完全一样。写失败时对话框留着，原因写在里面。
 */
export function McpConfirm({
  plan,
  req,
  nameOf,
  applying,
  error,
  onCancel,
  onConfirm,
}: {
  plan: PlanView;
  req: McpOpRequest;
  nameOf: (client: string) => string;
  applying: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useText(mcpText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && !applying && onCancel()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {req.op === "copy" ? t.copyTitle(req.name, nameOf(req.to)) : t.removeTitle(req.name, nameOf(req.to))}
          </DialogTitle>
          <DialogDescription>
            {t.modifies} <code className="font-mono text-foreground">{plan.path}</code>
          </DialogDescription>
        </DialogHeader>
        {plan.noop ? (
          <p className="tw-body">{t.noop}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Diff before={plan.before} after={plan.after} />
            <p className="tw-label text-muted-foreground">
              {t.backup}
              {req.op === "copy" && <span className="text-warning-foreground">{t.envCopied}</span>}
            </p>
          </div>
        )}
        <Banner layout="inline" tone="error" title={t.applyFailed} show={error != null}>
          {error != null && errorText(error)}
        </Banner>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={applying}>
            {common.cancel}
          </Button>
          {!plan.noop && (
            <Button onClick={onConfirm} pending={applying}>
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
      </>
    );
  }
  return (
    <span className="font-mono">
      {m.command} {m.args.join(" ")}
    </span>
  );
}
