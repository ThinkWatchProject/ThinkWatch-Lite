import type { KeyboardEvent, MouseEvent } from "react";
import { Badge } from "@/ui/badge";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { StatusLabel } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import type { Overview, RouteView } from "@/types";
import { orderedRoutes, type ChainFocus } from "./chain";
import { flowOf, routeProblems } from "./model";
import { modelText } from "./model.i18n";
import { KeyChips, TargetIcon } from "./parts";
import { routeTableText } from "./RouteTable.i18n";
import { routingText } from "./routing.i18n";

export interface RouteActions {
  edit: (name: string) => void;
  dryRun: (name: string) => void;
  duplicate: (name: string) => void;
  setDefault: (name: string) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
}

/** 行尾的菜单按钮在行里：点它、点它弹出的菜单项，都不该再冒泡成「打开这一行」 */
const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

/**
 * 路由列表。**只读**：改任何东西都走对话框，单击一行就是打开它。
 *
 * 默认路由固定在第一行 —— 没指定路由的密钥都走它，它是读这张表的起点。
 * 「规则」一栏按顺序写出决定去向的规则，不打开对话框也能看出一条路由做什么。
 * 悬停一行，上面的路由图里经过它的路亮起来。
 */
export function RouteTable({
  ov,
  actions,
  focus,
  onEnter,
  onLeave,
  flash,
}: {
  ov: Overview;
  actions: RouteActions;
  focus: ChainFocus | null;
  onEnter: (f: ChainFocus) => void;
  onLeave: () => void;
  /** 刚保存的那一条，闪一下 */
  flash: string | null;
}) {
  const t = useText(routeTableText);
  const rt = useText(routingText);
  const mt = useText(modelText);
  const shown = usePresentList(orderedRoutes(ov.routes), (r) => r.name);
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[26%]">{t.route}</TableHead>
          <TableHead className="w-[26%]">{t.keys}</TableHead>
          <TableHead>{t.rules}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map(({ item: r, key, presence }) => {
          const items = menu(r, actions);
          const users = ov.clients.filter((c) => c.route === r.name || (r.default && !c.route));
          const problems = routeProblems(r);
          const f: ChainFocus = { kind: "route", name: r.name };
          const lit = focus?.kind === "route" && focus.name === r.name;
          return (
            <RowMenu key={key} items={items}>
              <TableRow
                data-row={r.name}
                data-lit={lit || undefined}
                tabIndex={0}
                onClick={() => actions.edit(r.name)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                  e.preventDefault();
                  actions.edit(r.name);
                }}
                onMouseEnter={() => onEnter(f)}
                onMouseLeave={onLeave}
                onFocus={(e) => e.target === e.currentTarget && onEnter(f)}
                onBlur={onLeave}
                className={cn(
                  "cursor-pointer outline-none focus-visible:bg-muted/60 data-[lit]:bg-muted/50",
                  rowMotion(presence),
                  flash === r.name && "motion-row-in",
                )}
              >
                <TableCell className="py-2.5 align-top">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{r.name}</span>
                    {r.default && <Badge variant="secondary">{t.defaultBadge}</Badge>}
                  </div>
                  <div className="mt-0.5 tw-label text-muted-foreground">{mt.ruleCount(r.rules.length)}</div>
                </TableCell>
                <TableCell className="py-2.5 align-top whitespace-normal">
                  <KeyChips keys={users} empty={t.unused} />
                </TableCell>
                <TableCell className="overflow-hidden py-2.5 align-top">
                  <Flow route={r} ov={ov} />
                  {problems.length > 0 && (
                    <div className="mt-0.5">
                      <StatusLabel tone="warn" className="tw-label">
                        {problems.join(rt.clauseSep)}
                      </StatusLabel>
                    </div>
                  )}
                </TableCell>
                <TableCell className="py-2 text-right align-top" onClick={stop} onKeyDown={stop}>
                  <RowMenuButton items={items} label={rt.actionsFor(r.name)} />
                </TableCell>
              </TableRow>
            </RowMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** 「长上下文 → 长上下文池 · 兜底 → 主力」。一行放不下时截断，悬停看全 */
function Flow({ route, ov }: { route: RouteView; ov: Overview }) {
  const t = useText(routeTableText);
  const rt = useText(routingText);
  const flow = flowOf(route);
  if (flow.length === 0) {
    return <div className="text-muted-foreground">{t.noDecidingRule}</div>;
  }
  return (
    <Tip
      text={
        <div className="flex flex-col gap-0.5">
          {flow.map((f) => (
            <span key={f.rule}>
              {f.rule} → {f.target ?? rt.deny}
            </span>
          ))}
        </div>
      }
    >
      <div className="truncate">
        {flow.map((f, i) => (
          <span key={f.rule}>
            {i > 0 && <span className="mx-2 text-muted-foreground/50">·</span>}
            <span className="text-muted-foreground">{f.rule}</span>
            <span className="mx-1 text-muted-foreground/60">→</span>
            {f.target ? (
              <span className="font-medium">
                <TargetIcon
                  name={f.name!}
                  providers={ov.providers}
                  size={13}
                  className="mr-1 inline-block align-[-2px]"
                />
                {f.target}
              </span>
            ) : (
              <span className="text-destructive">{rt.deny}</span>
            )}
          </span>
        ))}
      </div>
    </Tip>
  );
}

function menu(r: RouteView, a: RouteActions): MenuItems {
  const t = textOf(routeTableText);
  const rt = textOf(routingText);
  return [
    { kind: "item", label: rt.editMenu, onSelect: () => a.edit(r.name) },
    { kind: "item", label: t.dryRunMenu, onSelect: () => a.dryRun(r.name) },
    { kind: "item", label: rt.duplicateMenu, onSelect: () => a.duplicate(r.name) },
    { kind: "sep" },
    ...(r.default
      ? []
      : ([{ kind: "item", label: rt.setDefault, onSelect: () => a.setDefault(r.name) }] as MenuItems)),
    // 网关补出来的默认路由不在配置文件里，定位不到
    ...(r.builtin
      ? []
      : ([{ kind: "item", label: rt.locate, onSelect: () => a.locate(r.name) }] as MenuItems)),
    ...(r.default && r.builtin ? [] : ([{ kind: "sep" }] as MenuItems)),
    {
      kind: "item",
      label: rt.deleteMenu,
      onSelect: () => a.remove(r.name),
      danger: true,
      // 默认路由不能删：没指定路由的密钥要有地方去
      disabled: r.default,
    },
  ];
}
