import type { KeyboardEvent, MouseEvent } from "react";
import { Badge } from "@/ui/badge";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { StatusLabel } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import type { Overview, RouteView } from "@/types";
import { orderedRoutes, type ChainFocus } from "./chain";
import { flowOf, routeProblems } from "./model";
import { modelText } from "./model.i18n";
import { KeyChips, TargetIcon } from "./parts";
import { routeTableText } from "./RouteTable.i18n";
import { routingText } from "./routing.i18n";
import { hitsOfRoute, hitsOfRule, type HitSpan, type RouteHitsWindow } from "./useRouteHits";

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
 * 「规则」一栏一行一条，按顺序写出决定去向的规则和它们最近几天命中了多少，不打开
 * 对话框也能看出一条路由做什么、哪条规则在用。这些数说的是多长一段写在这一栏的表头
 * 上。悬停一行，上面的路由图里经过它的路亮起来。
 */
export function RouteTable({
  ov,
  hits,
  actions,
  focus,
  onEnter,
  onLeave,
  flash,
}: {
  ov: Overview;
  /** 最近一段时间的命中数（`useRouteHits`） */
  hits: RouteHitsWindow;
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
          <TableHead className="w-[24%]">{t.route}</TableHead>
          <TableHead className="w-[25%]">{t.keys}</TableHead>
          <TableHead>
            <div className="flex items-center justify-between gap-3">
              <span>{t.rules}</span>
              {/* 一条请求记录都没有时在这里说一次，下面不逐条写 */}
              <span className="font-normal">
                {hits.state === "counted" ? rt.hitsIn(hits.span) : hits.state === "empty" ? rt.noRecords : null}
              </span>
            </div>
          </TableHead>
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
                  <RouteTotal route={r.name} hits={hits} />
                </TableCell>
                <TableCell className="py-2.5 align-top whitespace-normal">
                  <KeyChips keys={users} empty={t.unused} />
                </TableCell>
                <TableCell className="overflow-hidden py-2.5 align-top">
                  <Flow route={r} ov={ov} hits={hits} />
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

/**
 * 这条路由最近一段时间走了多少请求。读不到时是一道横线，没有请求时直说；一条请求记录
 * 都没有时不写 —— 表头已经说了
 */
function RouteTotal({ route, hits }: { route: string; hits: RouteHitsWindow }) {
  const rt = useText(routingText);
  if (hits.state === "loading") return <Skeleton className="mt-1.5 h-2.5 w-20 rounded-sm" />;
  if (hits.state === "empty") return null;
  if (hits.state === "unknown") return <div className="tw-label text-muted-foreground">—</div>;
  const { span } = hits;
  const h = hitsOfRoute(hits.routes, route);
  return (
    <div className="tw-label tw-num text-muted-foreground">
      {h ? (
        <AnimatedNumber
          value={h.requests}
          scope={spanKey(span)}
          format={(n) => rt.requestsIn(span, Math.round(n))}
        />
      ) : (
        rt.noRequestsIn(span)
      )}
    </div>
  );
}

/** 换了一段（7 天换成 5 小时）数字直接换，不从旧数滚过去 */
const spanKey = (s: HitSpan) => `${s.n}${s.unit}`;

/**
 * 决定去向的规则，一行一条：「长上下文 → 长上下文池」，右边是它命中了多少。
 *
 * **一次都没命中的写「未命中」**，不是错误，是提醒这条规则可能用不上了。整条路由这段
 * 时间都没有请求时不逐条写 —— 那是路由没在用，这一行左边已经说了；一条请求记录都没有
 * 时也不写，那时「未命中」什么都说明不了。
 */
function Flow({ route, ov, hits }: { route: RouteView; ov: Overview; hits: RouteHitsWindow }) {
  const t = useText(routeTableText);
  const rt = useText(routingText);
  const flow = flowOf(route);
  if (flow.length === 0) {
    return <div className="text-muted-foreground">{t.noDecidingRule}</div>;
  }
  const counted = hits.state === "counted" ? hits : null;
  const h = counted ? hitsOfRoute(counted.routes, route.name) : null;
  const scope = counted ? spanKey(counted.span) : "";
  return (
    <ul className="flex flex-col gap-0.5">
      {flow.map((f) => {
        const n = h ? hitsOfRule(h, f.rule).requests : null;
        return (
          <li key={f.rule} data-rule={f.rule} className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 truncate">
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
            <div className="ml-auto shrink-0 tw-num">
              {hits.state === "loading" ? (
                <Skeleton className="h-2.5 w-8 rounded-sm" />
              ) : n == null ? null : n > 0 ? (
                <AnimatedNumber value={n} scope={scope} />
              ) : (
                <span className="text-muted-foreground">{rt.noHits}</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
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
