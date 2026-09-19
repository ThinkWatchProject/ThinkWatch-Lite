import { Badge } from "@/ui/badge";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { when } from "@/format";
import type { ClientView, CostGroup, DetectedClient } from "@/types";
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
  actions,
}: {
  keys: ClientView[];
  /** 本机上装着的客户端，用来说清一把密钥是给谁的 */
  clients: DetectedClient[];
  /** 24 小时内每把密钥发了多少请求 */
  usage: CostGroup[];
  defaultRoute: string;
  actions: KeyActions;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>密钥</TableHead>
          <TableHead>路由</TableHead>
          <TableHead>可见模型</TableHead>
          <TableHead className="text-right">24 小时</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => {
          const items = menu(k, clients, actions);
          const scope = scopeLabel(k.allow);
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
                    {k.default && <Badge variant="secondary">默认</Badge>}
                    {k.disabled && <Badge variant="outline">已停用</Badge>}
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
                      <div>{used.requests.toLocaleString()} 次</div>
                      <div className="tw-label text-muted-foreground">
                        {k.last_seen_ms ? when(k.last_seen_ms) : "—"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-muted-foreground">—</div>
                      {/* 「从来没用过」和「今天没用过」是两句话 */}
                      <div className="tw-label text-muted-foreground">
                        {k.last_seen_ms ? when(k.last_seen_ms) : "从未使用"}
                      </div>
                    </>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={`${k.name} 的操作`} />
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
  return [
    { kind: "item", label: "复制密钥", onSelect: () => a.copy(k.name) },
    { kind: "item", label: "编辑…", onSelect: () => a.edit(k.name) },
    { kind: "item", label: "更换密钥…", onSelect: () => a.rotate(k.name) },
    { kind: "sep" },
    {
      kind: "item",
      label: "设为默认密钥",
      onSelect: () => a.makeDefault(k.name),
      disabled: k.default || k.disabled,
    },
    {
      kind: "item",
      label: k.disabled ? "启用" : "停用",
      onSelect: () => a.toggle(k),
      disabled: k.default,
    },
    { kind: "item", label: "在配置文件中定位", onSelect: () => a.locate(k.name) },
    { kind: "sep" },
    {
      kind: "item",
      label: k.default
        ? "删除…（默认密钥不能删除）"
        : adopted
          ? "删除…（取消接管后可删除）"
          : "删除…",
      onSelect: () => a.remove(k.name),
      danger: true,
      disabled: k.default || adopted,
    },
  ];
}
