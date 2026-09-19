import { Badge } from "@/ui/badge";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import type { Overview, RouteView } from "@/types";
import { NameChips } from "@/upstreams/parts";
import { flowOf, routeSummary, usersOf } from "./model";

export interface RouteActions {
  edit: (name: string) => void;
  dryRun: (name: string) => void;
  duplicate: (name: string) => void;
  setDefault: (name: string) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
}

/**
 * 路由列表。**只读**：改任何东西都走对话框。
 *
 * 默认路由固定在第一行 —— 没指定路由的密钥都走它，它是读这张表的起点。
 * 「规则」一栏按顺序写出决定去向的规则，不打开对话框也能看出一条路由做什么。
 */
export function RouteTable({ ov, actions }: { ov: Overview; actions: RouteActions }) {
  const routes = [...ov.routes].sort((a, b) => Number(b.default) - Number(a.default));
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-36">路由</TableHead>
          <TableHead className="w-56">使用密钥</TableHead>
          <TableHead>规则</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {routes.map((r) => {
          const items = menu(r, actions);
          const users = usersOf(r, ov.clients);
          // 默认路由的使用者里，没指定路由的那几把要点出来：它们跟着默认路由走，
          // 默认路由换了它们也换；指定了这条路由名的不会
          const implicit = r.default ? ov.clients.filter((c) => !c.route).map((c) => c.name) : [];
          const note =
            implicit.length === 0
              ? null
              : implicit.length === users.length
                ? "未指定路由的密钥"
                : `其中 ${implicit.join("、")} 未指定路由`;
          const summary = routeSummary(r);
          return (
            <RowMenu key={r.name} items={items}>
              <TableRow
                data-row={r.name}
                onDoubleClick={() => actions.edit(r.name)}
                className="cursor-default"
              >
                <TableCell className="py-2.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{r.name}</span>
                    {r.default && <Badge variant="secondary">默认</Badge>}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <NameChips names={users} empty="未被密钥使用" />
                  {note && <div className="mt-1 tw-label text-muted-foreground">{note}</div>}
                </TableCell>
                <TableCell className="overflow-hidden">
                  <Flow route={r} />
                  <div className={summary.warn ? "tw-label text-warning" : "tw-label text-muted-foreground"}>
                    {summary.text}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={`${r.name} 的操作`} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** 「长上下文 → 长上下文池 · 兜底 → 主力」。截断，悬停看全 */
function Flow({ route }: { route: RouteView }) {
  const flow = flowOf(route);
  if (flow.length === 0) {
    return <div className="text-muted-foreground">无决定去向的规则</div>;
  }
  const title = flow.map((f) => `${f.rule} → ${f.target ?? "拒绝"}`).join(" · ");
  return (
    <div className="truncate" title={title}>
      {flow.map((f, i) => (
        <span key={f.rule}>
          {i > 0 && <span className="mx-2 text-muted-foreground/60">·</span>}
          <span>{f.rule}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          {f.target ? (
            <span className="font-medium">{f.target}</span>
          ) : (
            <span className="text-destructive">拒绝</span>
          )}
        </span>
      ))}
    </div>
  );
}

function menu(r: RouteView, a: RouteActions): MenuItems {
  return [
    { kind: "item", label: "编辑…", onSelect: () => a.edit(r.name) },
    { kind: "item", label: "试算…", onSelect: () => a.dryRun(r.name) },
    { kind: "item", label: "复制…", onSelect: () => a.duplicate(r.name) },
    { kind: "sep" },
    ...(r.default
      ? []
      : ([{ kind: "item", label: "设为默认路由", onSelect: () => a.setDefault(r.name) }] as MenuItems)),
    // 网关补出来的默认路由不在配置文件里，定位不到
    ...(r.builtin
      ? []
      : ([{ kind: "item", label: "在配置文件中定位", onSelect: () => a.locate(r.name) }] as MenuItems)),
    ...(r.default && r.builtin ? [] : ([{ kind: "sep" }] as MenuItems)),
    {
      kind: "item",
      label: "删除…",
      onSelect: () => a.remove(r.name),
      danger: true,
      // 默认路由不能删：没指定路由的密钥要有地方去
      disabled: r.default,
    },
  ];
}
