import { useEffect, useRef, useState } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { IconClient, IconCopied, IconCopy } from "@/ui/icons";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { when } from "@/format";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import type { ClientView, CostGroup, DetectedClient, KnownModel, ManualClient } from "@/types";
import { keysTableText } from "./KeysTable.i18n";
import { labelsText } from "./labels.i18n";
import { routeLabel, scopeLabel, takeoverOf, type KeyOwner } from "./labels";

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
 * 密钥列表。**只读** —— 改任何东西都走对话框，行上没有就地编辑的控件。
 *
 * 一行要回答三件事：这把是谁的、它能去哪、还有没有人在用。**密钥的值原样
 * 写出来**，旁边一个复制按钮：这把钥匙的用处就是被填进客户端配置，只给
 * 头尾几位的话，用户还得另找地方看全。
 */
export function KeysTable({
  keys,
  clients,
  manual,
  usage,
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
  /** 24 小时内每把密钥发了多少请求 */
  usage: CostGroup[];
  defaultRoute: string;
  /** 网关知道的全部模型，用来把规则换算成模型数 */
  catalog: KnownModel[];
  actions: KeyActions;
}) {
  const t = useText(keysTableText);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.key}</TableHead>
          <TableHead>{t.route}</TableHead>
          <TableHead>{t.models}</TableHead>
          <TableHead className="text-right">{t.last24h}</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => {
          const owner = takeoverOf(k, clients, manual);
          const items = menu(k, owner, actions);
          const scope = scopeLabel(k.allow, catalog);
          const used = usage.find((u) => u.name === k.name);
          return (
            <RowMenu key={k.name} items={items}>
              <TableRow
                data-row={k.name}
                onDoubleClick={() => actions.edit(k.name)}
                className={cn(
                  "cursor-default transition-colors duration-700",
                  highlight === k.name && "bg-muted",
                )}
              >
                {/*
                  **这一列吃掉剩下的宽度**（`w-full max-w-0`）：完整的密钥有三十多位，
                  按内容撑开的话最小窗口下整张表要横着滚。放不下时密钥尾部省略，
                  复制的仍是完整的值。
                */}
                <TableCell className="w-full max-w-0 py-2">
                  {/* 状态只在异常时出现：每行都写一遍「正常」是噪声 */}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "min-w-0 truncate font-medium",
                        k.disabled && "text-muted-foreground",
                      )}
                    >
                      {k.name}
                    </span>
                    {k.default && <Badge variant="secondary">{t.default}</Badge>}
                    {k.disabled && <Badge variant="outline">{t.disabled}</Badge>}
                    {owner && <TakeoverBadge owner={owner} />}
                  </div>
                  <KeyValue value={k.key} onCopy={() => actions.copy(k.name, true)} />
                </TableCell>
                <TableCell>{routeLabel(k.route, defaultRoute)}</TableCell>
                <TableCell className={scope.warn ? "text-warning" : undefined}>
                  {scope.text}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {used && used.requests > 0 ? (
                    <>
                      <div>{t.requests(used.requests)}</div>
                      <div className="tw-label text-muted-foreground">
                        {k.last_seen_ms ? when(k.last_seen_ms) : "—"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-muted-foreground">—</div>
                      {/* 「从来没用过」和「今天没用过」是两句话 */}
                      <div className="tw-label text-muted-foreground">
                        {k.last_seen_ms ? when(k.last_seen_ms) : t.neverUsed}
                      </div>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">
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
 * 为某个客户端生成的那几把，**单独一个标记**：带客户端图标，写出是为谁生成的 ——
 * 接管时生成的写「接管 · Claude Code」，手动配置时生成的写「手动配置 · Cursor」。
 *
 * 能接管的客户端此刻没被接管时标记变淡：密钥还留着，接管时直接用，但此刻没有
 * 客户端的配置里写着它，所以可以删。
 */
export function TakeoverBadge({ owner }: { owner: KeyOwner }) {
  const t = useText(labelsText);
  const { client, kind } = owner;
  const tip = kind === "manual" ? t.manualTip(client) : kind === "adopted" ? t.takeoverOn(client) : t.takeoverOff(client);
  return (
    <Tip text={tip}>
      <Badge variant="outline" className={cn(kind === "idle" && "text-muted-foreground")}>
        <IconClient />
        {kind === "manual" ? t.manualFor(client) : t.takeover(client)}
      </Badge>
    </Tip>
  );
}

/**
 * 密钥的值和它的复制按钮。
 *
 * **双击选中文字，不打开对话框** —— 行上的双击是「编辑」，而在值上双击的人
 * 想要的是选中它。复制成功后按钮上换成一个勾，一秒半后换回来。
 */
function KeyValue({ value, onCopy }: { value: string; onCopy: () => Promise<void> }) {
  const t = useText(keysTableText);
  const common = useText(commonText);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        className="min-w-0 truncate font-mono tw-label text-muted-foreground select-text"
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {value}
      </span>
      <Tip text={copied ? common.copied : t.copyKey}>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t.copyKey}
          className="shrink-0 text-muted-foreground"
          onClick={() =>
            void onCopy().then(() => {
              setCopied(true);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? <IconCopied /> : <IconCopy />}
        </Button>
      </Tip>
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
    { kind: "item", label: t.copyKey, onSelect: () => void a.copy(k.name) },
    { kind: "item", label: t.edit, onSelect: () => a.edit(k.name) },
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
      label: k.default
        ? t.removeDefault
        : adopted
          ? t.removeConnected
          : t.remove,
      onSelect: () => a.remove(k.name),
      danger: true,
      disabled: k.default || adopted,
    },
  ];
}
