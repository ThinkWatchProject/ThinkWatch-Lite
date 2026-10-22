import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRightIcon, GripVerticalIcon } from "lucide-react";
import { Button, DISCLOSURE } from "@/ui/button";
import { Count } from "@/ui/count";
import { Reveal, rowMotion, usePresentList } from "@/ui/motion";
import { PageSection } from "@/ui/page";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { OPENABLE_ROW, openable, stop } from "@/ui/openable";
import { Tile } from "@/ui/tile";
import { cn } from "@/lib/utils";
import { useLang, useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type { DetectedClient, ManualClient } from "@/types";
import type { KeyUse } from "@/keys/data";
import { ClientMark, UsageCell } from "@/keys/parts";
import { clientsText } from "./clients.i18n";
import { SILENCE_MS, hostOf, manualStatusOf, statusOf, type Status, type WslPlace } from "./status";
import { ClientStatus, reasonText } from "./ClientStatus";
import { moved } from "./order";
import { useReorder } from "@/routing/useReorder";

export interface RowActions {
  details: (c: DetectedClient) => void;
  adopt: (c: DetectedClient) => void;
  restore: (c: DetectedClient) => void;
  manual: (id: string) => void;
  reveal: (c: DetectedClient) => void;
  /** 更改配置位置（接管、MCP 管理、安全扫描）。只有这台电脑上能换位置的才有这一项 */
  path: (id: string) => void;
  traffic: (key: string) => void;
  openKey: (key: string) => void;
}

/** 表格里要用到的、各行共有的东西 */
export interface RowContext {
  usage: Map<string, KeyUse> | undefined;
  /** 此刻有请求在跑的密钥 */
  busy: ReadonlySet<string>;
  gatewayBase: string;
  /** 连着远程 core。还指着本机网关的单独标出来 */
  remote: boolean;
  /** 正在取接管方案的那一个（它的主按钮转圈） */
  asking: string | null;
  /**
   * WSL 里的那一组：此刻能不能从 WSL 里够到网关。**够不着的不给接管、手动配置**，
   * 接管过的照样能还原。这台电脑上的没有
   */
  wsl?: WslPlace;
  actions: RowActions;
  /**
   * 一张表排过之后，这张表里客户端 id 的新顺序。页面把它并进整份顺序、存下来。只有
   * 能排序的表用它（检测到的、需要手动配置的；未检测到的不排）
   */
  reorder?: (ids: string[]) => void;
}

/** 能排序的表里的一行：第几个、共几个，拖动把手，上移下移 */
interface RowSort {
  index: number;
  count: number;
  /** 行上标的：`useReorder` 按它认是哪一行、是不是这一张表的 */
  attrs: { "data-reorder-row": number; "data-reorder-scope": string };
  handle: ReturnType<ReturnType<typeof useReorder>["handle"]>;
  mark: "before" | "after" | null;
  dragging: boolean;
  move: (d: -1 | 1) => void;
}

/**
 * 一张能排序的表：拖动把手、行菜单的上移下移、在行上按 Alt+↑/↓。`onReorder` 没给就不能排。
 *
 * **拖动中画的是按下把手那一刻的列表。**这一页跟着请求刷新，拖到一半来了新数据（新装了
 * 一个、有一个不见了）的话，行的进出场动画会把行挤来挤去，放下时的下标也对不上；放下
 * 之后才换成新的。
 *
 * 用键盘挪的那一行重新排过之后可能丢了焦点（React 挪的是它所在的那个节点）：焦点丢了
 * 就还给它
 */
function useSortable<T>(items: T[], idOf: (item: T) => string, onReorder: ((ids: string[]) => void) | undefined) {
  const scope = useId();
  const table = useRef<HTMLTableElement>(null);
  const [frozen, setFrozen] = useState<T[] | null>(null);
  const latest = useRef<string[]>([]);
  const commit = (ids: string[], focus?: string) => {
    onReorder?.(ids);
    if (focus === undefined) return;
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected) return;
      table.current?.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(focus)}"]`)?.focus();
    });
  };
  const reorder = useReorder((from, to) => commit(moved(latest.current, from, to)), scope);
  const dragging = reorder.dragging !== null;
  if (dragging && frozen === null) setFrozen(items);
  else if (!dragging && frozen !== null) setFrozen(null);
  const list = (dragging ? frozen : null) ?? items;
  const ids = list.map(idOf);
  latest.current = ids;
  const sortOf = (id: string): RowSort | undefined => {
    if (!onReorder) return undefined;
    const i = ids.indexOf(id);
    // 正在淡出的那一行已经不在列表里：不能再拖、再挪
    if (i < 0) return undefined;
    return {
      index: i,
      count: ids.length,
      attrs: { "data-reorder-row": i, "data-reorder-scope": scope },
      handle: reorder.handle(i),
      mark: reorder.marker(i, ids.length),
      dragging: reorder.dragging === i,
      move: (d) => {
        const j = i + d;
        if (j < 0 || j >= ids.length) return;
        commit(moved(ids, i, j), id);
      },
    };
  };
  return { list, table, sortOf };
}

/** 拖动中：被拖的那一行淡下去，放下的位置画一条线（和路由规则一样） */
const sortRow = (sort: RowSort | undefined) =>
  sort && [
    sort.dragging && "opacity-50",
    sort.mark === "before" && "shadow-[inset_0_2px_0_var(--color-foreground)]",
    sort.mark === "after" && "shadow-[inset_0_-2px_0_var(--color-foreground)]",
  ];

/** 行上的按键：Alt+↑/↓ 上移下移，其余照 `openable` */
function sortKeys(sort: RowSort | undefined, onKeyDown: (e: KeyboardEvent) => void) {
  return (e: KeyboardEvent) => {
    if (sort && e.target === e.currentTarget && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      sort.move(e.key === "ArrowUp" ? -1 : 1);
      return;
    }
    onKeyDown(e);
  };
}

/** 行菜单里的上移、下移。到顶、到底时置灰 */
function moveItems(sort: RowSort | undefined, t: typeof clientsText.zh): MenuItems {
  if (!sort) return [];
  return [
    { kind: "sep" },
    { kind: "item", label: t.moveUp, disabled: sort.index === 0, onSelect: () => sort.move(-1) },
    { kind: "item", label: t.moveDown, disabled: sort.index === sort.count - 1, onSelect: () => sort.move(1) },
  ];
}

/**
 * 最左边那一格：拖动把手（和路由规则的一样）。**只有它能拖**，点它不打开这一行。
 * 不能排序的表（未检测到）这一格空着，几张表的列照样对齐
 */
function GripCell({ sort, name }: { sort: RowSort | undefined; name: string }) {
  const t = useText(clientsText);
  if (!sort) return <TableCell className="px-0" />;
  return (
    <TableCell
      className="px-0 pl-2 text-muted-foreground/60"
      aria-label={t.dragClient(name)}
      onClick={stop}
      {...sort.handle}
    >
      <GripVerticalIcon className="size-3.5" />
    </TableCell>
  );
}

/**
 * 三张表共用的列宽。**表格是固定布局**：分组各是一张表（收起、展开时整块带高度
 * 动画），列宽写死在这里，几张表的列才对得齐。最左边一列是拖动把手，客户端那一列
 * 吃掉剩下的宽度。
 *
 * 窄窗口下（页面窄于 48rem）小柱图收起，那一列跟着变窄；「密钥」一列也收起 ——
 * 不然最小窗口下客户端名字那一列只剩几个像素。密钥在详情里、行菜单的「查看流量」
 * 里都还在。
 *
 * 24 小时那一列按 `UsageCell` 的实际宽度定（小柱图 25 格 74px + 间距 12px + 次数
 * 88px + 内边距 16px），窄一点它就压到左边那一列上去。
 */
function Cols() {
  const en = useLang() === "en";
  return (
    <colgroup>
      <col className="w-7" />
      <col />
      <col className={en ? "w-[184px] @max-3xl/page:w-[150px]" : "w-[136px] @max-3xl/page:w-[120px]"} />
      <col className="w-[128px] @max-3xl/page:w-0" />
      <col className="w-[192px] @max-3xl/page:w-[104px]" />
      <col className={en ? "w-[124px]" : "w-[120px]"} />
    </colgroup>
  );
}

/**
 * 「密钥」那一格在窄窗口下的样子：宽度归零、内容藏起来。**不用 `display: none`**
 * —— 固定布局的表里藏掉一个单元格，后面的格子会往前挪一列、和列宽对不上。
 */
const KEY_CELL = "@max-3xl/page:px-0 @max-3xl/page:*:hidden";

function Head() {
  const t = useText(clientsText);
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="px-0" />
        <TableHead>{t.client}</TableHead>
        <TableHead>{t.status}</TableHead>
        <TableHead className={KEY_CELL}>
          <span>{t.key}</span>
        </TableHead>
        <TableHead className="text-right">{t.last24h}</TableHead>
        <TableHead>
          <span className="sr-only">{t.actions}</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

/**
 * 能接管的客户端，一行一个：客户端、状态、密钥、24 小时、操作。
 *
 * 行上只放一个主按钮（接管… / 还原… / 配置方法…），其余在行菜单里（右键是同一份）。
 * 单击一行打开详情；没检测到的打开手动配置。
 *
 * `head`：带表头。页面上第一张表带，下面的分组不带 —— 列宽对齐，表头只写一次。
 * `sortable`：能拖动、上移下移（`ctx.reorder`）。未检测到的那一组不排。
 */
export function DetectedTable({
  clients,
  ctx,
  head,
  dim,
  sortable,
}: {
  clients: DetectedClient[];
  ctx: RowContext;
  head: boolean;
  /** 没检测到的那一组：整行淡显 */
  dim?: boolean;
  sortable?: boolean;
}) {
  const { list, table, sortOf } = useSortable(clients, (c) => c.id, sortable ? ctx.reorder : undefined);
  const shown = usePresentList(list, (c) => c.id);
  return (
    <Table ref={table} className="table-fixed">
      <Cols />
      {head && <Head />}
      <TableBody>
        {shown.map(({ item: c, key, presence }) => (
          <DetectedRow
            key={key}
            c={c}
            ctx={ctx}
            sort={sortOf(c.id)}
            className={cn(rowMotion(presence), dim && "text-muted-foreground")}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function DetectedRow({
  c,
  ctx,
  sort,
  className,
}: {
  c: DetectedClient;
  ctx: RowContext;
  sort: RowSort | undefined;
  className?: string;
}) {
  const t = useText(clientsText);
  const { actions, usage } = ctx;
  const status = statusOf(c, ctx.gatewayBase, Date.now(), ctx.remote, ctx.wsl);
  const absent = status.state === "absent";
  const adopted = c.adopted_at_ms != null;
  /** WSL 里够不着网关的那一组：接管、手动配置都不给 */
  const reachable = ctx.wsl?.adoptable ?? true;
  const items = [...menu(c, actions, t, reachable), ...moveItems(sort, t)];
  const open = () => {
    if (!absent) actions.details(c);
    else if (reachable) actions.manual(c.id);
  };
  const row = openable(open);
  const sub = subline(c, status, t);
  // 刚接管、正等着第一个请求：点带脉冲。等久了就不跳了
  const live = adopted && status.state === "waiting" && Date.now() - (c.adopted_at_ms ?? 0) < SILENCE_MS;
  return (
    <RowMenu items={items}>
      <TableRow
        data-row={c.id}
        {...sort?.attrs}
        {...row}
        onKeyDown={sortKeys(sort, row.onKeyDown)}
        aria-keyshortcuts={sort ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        className={cn(OPENABLE_ROW, "scroll-mx-[100vw]", className, sortRow(sort))}
      >
        <GripCell sort={sort} name={c.name} />
        <TableCell className="py-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Tile className={cn(absent && "opacity-60")}>
              <ClientMark id={c.id} name={c.name} />
            </Tile>
            <div className="min-w-0">
              <div className="truncate font-medium">{c.name}</div>
              <div className="truncate font-mono tw-label text-muted-foreground">{c.path}</div>
            </div>
          </div>
        </TableCell>
        <TableCell className="whitespace-normal">
          <ClientStatus status={status} live={live} />
          {(sub || status.state === "broken") && (
            <div className="tw-label text-muted-foreground">
              {sub}
              {status.state === "broken" && (
                <>
                  {sub && " · "}
                  <LinkButton onClick={() => actions.details(c)}>{t.seeWhy}</LinkButton>
                </>
              )}
            </div>
          )}
        </TableCell>
        <TableCell className={KEY_CELL}>
          <KeyLink name={c.key} onOpen={actions.openKey} />
        </TableCell>
        <TableCell className="text-right">
          <UsageCell
            use={c.key ? usage?.get(c.key) : undefined}
            loaded={usage !== undefined}
            lastSeen={c.last_seen_ms}
            busy={!!c.key && ctx.busy.has(c.key)}
            hasKey={!!c.key}
          />
        </TableCell>
        <TableCell className="text-right" onClick={stop} onKeyDown={stop}>
          <div className="flex items-center justify-end gap-1">
            {/* 另一个 ThinkWatch Lite 接管的：还原、接管都不在这里做 */}
            {status.state !== "other" && !(c.managed && !adopted && !absent) && (adopted || reachable) && (
              <Button
                variant="outline"
                size="xs"
                pending={ctx.asking === c.id}
                onClick={() => (absent ? actions.manual(c.id) : adopted ? actions.restore(c) : actions.adopt(c))}
              >
                {absent ? t.manual : adopted ? t.restore : t.adopt}
              </Button>
            )}
            <RowMenuButton items={items} label={t.actionsFor(c.name)} />
          </div>
        </TableCell>
      </TableRow>
    </RowMenu>
  );
}

/**
 * 需要手动配置的那几个。**和上面同一套列**：配过的一样看得到它的密钥和用量，
 * 状态只能按密钥判断 —— 这几个客户端检测不到。
 */
export function ManualTable({ manual, ctx }: { manual: ManualClient[]; ctx: RowContext }) {
  const t = useText(clientsText);
  const { list, table, sortOf } = useSortable(manual, (m) => m.id, ctx.reorder);
  const shown = usePresentList(list, (m) => m.id);
  const { actions, usage } = ctx;
  return (
    <Table ref={table} className="table-fixed">
      <Cols />
      <TableBody>
        {shown.map(({ item: m, key, presence }) => {
          const sort = sortOf(m.id);
          const row = openable(() => actions.manual(m.id));
          const items: MenuItems = [
            { kind: "item", label: t.manual, onSelect: () => actions.manual(m.id) },
            ...(m.movable ? [{ kind: "item" as const, label: t.changePath, onSelect: () => actions.path(m.id) }] : []),
            {
              kind: "item",
              label: t.traffic,
              onSelect: () => m.key && actions.traffic(m.key),
              disabled: !m.key,
            },
            ...moveItems(sort, t),
          ];
          return (
            <RowMenu key={key} items={items}>
              <TableRow
                data-row={m.id}
                {...sort?.attrs}
                {...row}
                onKeyDown={sortKeys(sort, row.onKeyDown)}
                aria-keyshortcuts={sort ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                className={cn(OPENABLE_ROW, "scroll-mx-[100vw]", rowMotion(presence), sortRow(sort))}
              >
                <GripCell sort={sort} name={m.name} />
                <TableCell className="py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Tile>
                      <ClientMark id={m.id} name={m.name} />
                    </Tile>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      {/* 名字下面那一行说它配完还漏什么 */}
                      <div className="truncate tw-label text-muted-foreground">{coreText(m.caveat)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <ClientStatus status={manualStatusOf(m)} manual />
                </TableCell>
                <TableCell className={KEY_CELL}>
                  <KeyLink name={m.key} onOpen={actions.openKey} />
                </TableCell>
                <TableCell className="text-right">
                  <UsageCell
                    use={m.key ? usage?.get(m.key) : undefined}
                    loaded={usage !== undefined}
                    lastSeen={m.last_seen_ms}
                    busy={!!m.key && ctx.busy.has(m.key)}
                    hasKey={!!m.key}
                  />
                </TableCell>
                <TableCell className="text-right" onClick={stop} onKeyDown={stop}>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="outline" size="xs" onClick={() => actions.manual(m.id)}>
                      {t.manual}
                    </Button>
                    <RowMenuButton items={items} label={t.actionsFor(m.name)} />
                  </div>
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * 可以收起的一组（需要手动配置、未检测到）。**默认展开** —— 没检测到的客户端也给
 * 手动配法，不藏起来；收起是看的人自己的选择，记在这台机器上。收起、展开时整组
 * 带高度动画。
 */
export function Section({
  id,
  title,
  count,
  description,
  children,
}: {
  /** 记住收起状态用的名字 */
  id: string;
  title: string;
  count: number;
  description: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id));
  useEffect(() => writeOpen(id, open), [id, open]);
  return (
    <PageSection
      className="mt-7"
      title={
        // 标题和页面上别的节标题对齐（左边不缩进），展开记号跟在数字后面
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          className={cn("-ml-1.5 h-6 gap-1.5 px-1.5 font-medium text-foreground", DISCLOSURE)}
          onClick={() => setOpen((o) => !o)}
        >
          {title}
          <Count n={count} />
          <ChevronRightIcon className={cn("-ml-0.5 size-3.5 text-muted-foreground motion-bar", open && "rotate-90")} />
        </Button>
      }
      description={description}
    >
      <Reveal show={open}>{children}</Reveal>
    </PageSection>
  );
}

function readOpen(id: string): boolean {
  try {
    return window.localStorage.getItem(`clients.${id}`) !== "collapsed";
  } catch {
    // 隐私窗口、禁用站点数据：照默认展开
    return true;
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    window.localStorage.setItem(`clients.${id}`, open ? "open" : "collapsed");
  } catch {
    // 记不住只是下次要再收一次
  }
}

/** 密钥名，点了去密钥页定位到那一行。还没有就是一道横线 */
function KeyLink({ name, onOpen }: { name?: string | null; onOpen: (key: string) => void }) {
  if (!name) return <span className="text-muted-foreground">—</span>;
  return <LinkButton onClick={() => onOpen(name)}>{name}</LinkButton>;
}

/** 行里的文字链接：下划线，点了不冒泡成「打开这一行」 */
function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="link"
      className="h-auto max-w-full justify-start p-0 font-normal text-inherit underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground [font-size:inherit]"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={stop}
    >
      <span className="truncate">{children}</span>
    </Button>
  );
}

/** 状态下面那一行 */
function subline(c: DetectedClient, s: Status, t: typeof clientsText.zh): string | null {
  // 由组织统一管理的，说明为什么接管不了（接管按钮也不给）
  if (c.managed && c.adopted_at_ms == null) return coreText(c.managed);
  const why = reasonText(s.reason, t);
  if (why) return why;
  if (s.state === "idle") return c.endpoint ? t.pointsTo(hostOf(c.endpoint)) : t.ownService;
  return null;
}

function menu(c: DetectedClient, a: RowActions, t: typeof clientsText.zh, reachable: boolean): MenuItems {
  const installed = c.installed;
  return [
    { kind: "item", label: t.details, onSelect: () => a.details(c), disabled: !installed },
    ...(reachable ? [{ kind: "item" as const, label: t.manual, onSelect: () => a.manual(c.id) }] : []),
    { kind: "sep" },
    {
      kind: "item",
      label: t.reveal,
      onSelect: () => a.reveal(c),
      disabled: !c.has_config,
    },
    ...(c.movable ? [{ kind: "item" as const, label: t.changePath, onSelect: () => a.path(c.id) }] : []),
    {
      kind: "item",
      label: t.traffic,
      onSelect: () => c.key && a.traffic(c.key),
      disabled: !c.key,
    },
  ];
}
