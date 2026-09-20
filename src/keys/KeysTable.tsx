import { Badge } from "@/ui/badge";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { when } from "@/format";
import { textOf, useText } from "@/i18n";
import type { ClientView, CostGroup, DetectedClient, KnownModel } from "@/types";
import { keysTableText } from "./KeysTable.i18n";
import { routeLabel, scopeLabel, useLabel } from "./labels";

export interface KeyActions {
  edit: (name: string) => void;
  copy: (name: string) => void;
  rotate: (name: string) => void;
  toggle: (k: ClientView) => void;
  makeDefault: (name: string) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
}

/**
 * 密钥列表。**只读** —— 改任何东西都走对话框，行上没有就地编辑的控件。
 *
 * 一行要回答三件事：这把是谁的、它能去哪、还有没有人在用。
 */
export function KeysTable({
  keys,
  clients,
  usage,
  defaultRoute,
  catalog,
  actions,
}: {
  keys: ClientView[];
  /** 本机上装着的客户端，用来说清一把密钥是给谁的 */
  clients: DetectedClient[];
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
          const items = menu(k, clients, actions);
          const scope = scopeLabel(k.allow, catalog);
          const used = usage.find((u) => u.name === k.name);
          return (
            <RowMenu key={k.name} items={items}>
              <TableRow
                data-row={k.name}
                onDoubleClick={() => actions.edit(k.name)}
                className="cursor-default"
              >
                <TableCell className="py-2">
                  {/* 状态只在异常时出现：每行都写一遍「正常」是噪声 */}
                  <div className="flex items-center gap-1.5">
                    <span className={k.disabled ? "font-medium text-muted-foreground" : "font-medium"}>
                      {k.name}
                    </span>
                    {k.default && <Badge variant="secondary">{t.default}</Badge>}
                    {k.disabled && <Badge variant="outline">{t.disabled}</Badge>}
                  </div>
                  {/* 密钥值只剩头尾：一张截图就能把它带出去 */}
                  <div className="tw-label text-muted-foreground">
                    <span className="font-mono">{k.key}</span> · {useLabel(k, clients)}
                  </div>
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
 * 行菜单。
 *
 * **删不掉的那一项灰着，不消失。**灰着的话用户会问一次为什么，而答案
 * （默认密钥、或者那个客户端正被接管）正是他该知道的。
 */
function menu(k: ClientView, clients: DetectedClient[], a: KeyActions): MenuItems {
  const adopted = !!clients.find((c) => c.id === k.client)?.adopted_at_ms;
  const t = textOf(keysTableText);
  return [
    { kind: "item", label: t.copyKey, onSelect: () => a.copy(k.name) },
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
