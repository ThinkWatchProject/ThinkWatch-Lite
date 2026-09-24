import { KeyRoundIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { ClientLogo } from "@/ui/logos";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { StatusDot } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import type { ClientView, DetectedClient, KnownModel, ManualClient } from "@/types";
import type { KeyUse } from "./data";
import { keysTableText } from "./KeysTable.i18n";
import { labelsText } from "./labels.i18n";
import { routeLabel, scopeLabel, takeoverOf, type KeyOwner } from "./labels";
import { ClientMark, CopyIconButton, CostCell, OPENABLE_ROW, Tile, UsageCell, openable, stop } from "./parts";

export interface KeyActions {
  edit: (name: string) => void;
  /**
   * 放进剪贴板。失败由调用方说；`quiet` 时成功也不弹提示 —— 值旁边那个按钮
   * 自己会换成一个勾，再弹一条就是两遍
   */
  copy: (name: string, quiet?: boolean) => Promise<void>;
  rotate: (name: string) => void;
  toggle: (k: ClientView) => void;
  makeDefault: (name: string) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
}

/**
 * 密钥列表。**只读** —— 改任何东西都走对话框，行上没有就地编辑的控件。单击一行
 * （或回车）打开编辑，右键和行尾「…」是同一份菜单。
 *
 * 一行要回答三件事：这把是谁的、它能去哪、还有没有人在用。**密钥的值原样
 * 写出来**，旁边一个复制按钮：这把钥匙的用处就是被填进客户端配置，只给
 * 头尾几位的话，用户还得另找地方看全。行首的方块是它所属客户端的标志，
 * 手动建的是一把钥匙。
 */
export function KeysTable({
  keys,
  clients,
  manual,
  usage,
  busy,
  defaultRoute,
  catalog,
  highlight,
  actions,
}: {
  keys: ClientView[];
  /** 本机上装着的客户端，用来说清一把密钥是接管谁时生成的 */
  clients: DetectedClient[];
  /** 接管不了、要手动配置的客户端。为它们生成的密钥标「手动配置」 */
  manual: ManualClient[];
  /** 从客户端页点过来的那一把：底色亮一下 */
  highlight?: string | null;
  /** 每把密钥 24 小时的用量。**取不到时是 `undefined`**，那几格写「—」 */
  usage: Map<string, KeyUse> | undefined;
  /** 此刻有请求在跑的密钥 */
  busy: ReadonlySet<string>;
  defaultRoute: string;
  /** 网关知道的全部模型，用来把规则换算成模型数 */
  catalog: KnownModel[];
  actions: KeyActions;
}) {
  const t = useText(keysTableText);
  const shown = usePresentList(keys, (k) => k.name);
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t.key}</TableHead>
          <TableHead>{t.route}</TableHead>
          <TableHead>{t.models}</TableHead>
          <TableHead className="text-right">{t.last24h}</TableHead>
          <TableHead className="text-right @max-3xl/page:hidden">{t.cost}</TableHead>
          <TableHead className="w-9">
            <span className="sr-only">{t.actions}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map(({ item: k, key, presence }) => {
          const owner = takeoverOf(k, clients, manual);
          const items = menu(k, owner, actions);
          const scope = scopeLabel(k.allow, catalog);
          const use = usage?.get(k.name);
          return (
            <RowMenu key={key} items={items}>
              <TableRow
                data-row={k.name}
                {...openable(() => actions.edit(k.name))}
                className={cn(
                  OPENABLE_ROW,
                  // 滚进视野时不横着滚（WebKit 对宽元素会左对齐）
                  "scroll-mx-[100vw]",
                  rowMotion(presence),
                  highlight === k.name && "bg-muted",
                )}
              >
                {/*
                  **这一列吃掉剩下的宽度**（`w-full max-w-0`）：完整的密钥有三十多位，
                  按内容撑开的话最小窗口下整张表要横着滚。放不下时密钥尾部省略，
                  复制的仍是完整的值。
                */}
                <TableCell className="w-full max-w-0 py-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Tile className={cn(k.disabled && "opacity-60")}>
                      {owner ? <ClientMark id={owner.id} name={owner.client} /> : <KeyRoundIcon />}
                    </Tile>
                    <div className="min-w-0 flex-1">
                      {/* 状态只在异常时出现：每行都写一遍「正常」是噪声 */}
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={cn("min-w-0 truncate font-medium", k.disabled && "text-muted-foreground")}>
                          {k.name}
                        </span>
                        {k.default && <Badge variant="secondary">{t.default}</Badge>}
                        {k.disabled && (
                          <Badge variant="outline" className="text-muted-foreground">
                            <StatusDot tone="idle" />
                            {t.disabled}
                          </Badge>
                        )}
                        {owner && <TakeoverBadge owner={owner} />}
                      </div>
                      <KeyValue value={k.key} label={t.copyKey} onCopy={() => actions.copy(k.name, true)} />
                    </div>
                  </div>
                </TableCell>
                <TableCell className={cn(k.disabled && "text-muted-foreground")}>
                  {routeLabel(k.route, defaultRoute)}
                </TableCell>
                <TableCell className={scope.warn ? "text-warning" : k.disabled ? "text-muted-foreground" : undefined}>
                  {scope.text}
                </TableCell>
                <TableCell className="text-right">
                  <UsageCell use={use} loaded={usage !== undefined} lastSeen={k.last_seen_ms} busy={busy.has(k.name)} />
                </TableCell>
                <TableCell className="text-right tw-num @max-3xl/page:hidden">
                  <CostCell use={use} loaded={usage !== undefined} />
                </TableCell>
                <TableCell className="text-right" onClick={stop} onKeyDown={stop}>
                  <RowMenuButton items={items} label={t.actionsFor(k.name)} />
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
 * 为某个客户端生成的那几把，**单独一个标记**，写出是为谁生成的 —— 接管时生成的写
 * 「接管 · Claude Code」，手动配置时生成的写「手动配置 · Cursor」。
 *
 * 能接管的客户端此刻没被接管时标记变淡：密钥还留着，接管时直接用，但此刻没有
 * 客户端的配置里写着它，所以可以删。
 *
 * `logo`：标记里带客户端的标志。表格里行首已经有了，不重复；对话框里带上。
 */
export function TakeoverBadge({ owner, logo }: { owner: KeyOwner; logo?: boolean }) {
  const t = useText(labelsText);
  const { client, kind } = owner;
  const tip = kind === "manual" ? t.manualTip(client) : kind === "adopted" ? t.takeoverOn(client) : t.takeoverOff(client);
  return (
    <Tip text={tip}>
      <Badge variant="outline" className={cn(kind === "idle" && "text-muted-foreground")}>
        {logo && <ClientLogo id={owner.id} name={client} size={12} />}
        {kind === "manual" ? t.manualFor(client) : t.takeover(client)}
      </Badge>
    </Tip>
  );
}

/**
 * 密钥的值和它的复制按钮。
 *
 * **点在值上不打开对话框** —— 在值上点、双击、拖的人想要的是选中它；行上其余
 * 地方单击才是「编辑」。
 */
function KeyValue({ value, label, onCopy }: { value: string; label: string; onCopy: () => Promise<void> }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        className="min-w-0 cursor-text truncate font-mono tw-label text-muted-foreground select-text"
        onClick={stop}
      >
        {value}
      </span>
      <CopyIconButton label={label} onCopy={onCopy} className="-my-1" />
    </div>
  );
}

/**
 * 行菜单。
 *
 * **删不掉的那一项灰着，不消失。**灰着的话用户会问一次为什么，而答案
 * （默认密钥、或者那个客户端正被接管）正是他该知道的。
 */
function menu(k: ClientView, owner: KeyOwner | null, a: KeyActions): MenuItems {
  const adopted = owner?.kind === "adopted";
  const t = textOf(keysTableText);
  return [
    { kind: "item", label: t.edit, onSelect: () => a.edit(k.name) },
    { kind: "item", label: t.copyKey, onSelect: () => void a.copy(k.name) },
    { kind: "item", label: t.rotate, onSelect: () => a.rotate(k.name) },
    { kind: "sep" },
    {
      kind: "item",
      label: t.makeDefault,
      onSelect: () => a.makeDefault(k.name),
      disabled: k.default || k.disabled,
    },
    {
      kind: "item",
      label: k.disabled ? t.enable : t.disable,
      onSelect: () => a.toggle(k),
      disabled: k.default,
    },
    { kind: "item", label: t.locate, onSelect: () => a.locate(k.name) },
    { kind: "sep" },
    {
      kind: "item",
      label: k.default ? t.removeDefault : adopted ? t.removeConnected : t.remove,
      onSelect: () => a.remove(k.name),
      danger: true,
      disabled: k.default || adopted,
    },
  ];
}
