import { Fragment } from "react";
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
import { cn } from "@/lib/utils";
import { groupKindLabel } from "@/labels";
import type { GroupView, Overview } from "@/types";

export interface GroupActions {
  edit: (name: string) => void;
  prefer: (group: GroupView, provider: string) => void;
  duplicate: (name: string) => void;
  locate: (name: string) => void;
  remove: (name: string) => void;
  showUpstreams: () => void;
}

/** 引用了这个策略组的规则：「路由 · 规则」 */
export function groupRefs(ov: Overview, name: string): { route: string; rule: string }[] {
  return ov.routes.flatMap((r) =>
    r.rules.filter((x) => x.to === name).map((x) => ({ route: r.name, rule: x.name })),
  );
}

/**
 * 策略组列表。「全部上游」是内置的，排第一行：成员随上游列表更新，不能编辑。
 */
export function GroupTable({ ov, actions }: { ov: Overview; actions: GroupActions }) {
  const groups = [...ov.groups].sort((a, b) => Number(b.builtin) - Number(a.builtin));
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-36">名称</TableHead>
          <TableHead className="w-28">策略</TableHead>
          <TableHead>成员</TableHead>
          <TableHead className="w-48">引用</TableHead>
          <TableHead className="w-9" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((g) => {
          const items = menu(g, actions);
          const refs = groupRefs(ov, g.name);
          return (
            <RowMenu key={g.name} items={items}>
              <TableRow
                data-row={g.name}
                onDoubleClick={() => (g.builtin ? actions.showUpstreams() : actions.edit(g.name))}
                className="cursor-default"
              >
                <TableCell className="py-2.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{g.builtin ? "全部上游" : g.name}</span>
                    {g.builtin && <Badge variant="outline">内置</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div>{groupKindLabel(g.kind)}</div>
                  {g.hurts_cache && <div className="tw-label text-warning">影响 prompt cache</div>}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Members g={g} />
                  {g.builtin ? (
                    <div className="tw-label text-muted-foreground">按上游列表顺序</div>
                  ) : g.kind === "select" && g.selected ? (
                    <div className="tw-label text-muted-foreground">优先使用 {g.selected}</div>
                  ) : null}
                </TableCell>
                <TableCell className="overflow-hidden">
                  {refs.length === 0 ? (
                    <span className="text-muted-foreground">未被引用</span>
                  ) : (
                    <div className="truncate" title={refs.map((r) => `${r.route} · ${r.rule}`).join("；")}>
                      {refs.map((r, i) => (
                        <Fragment key={`${r.route}/${r.rule}`}>
                          {i > 0 && "；"}
                          {r.route} · {r.rule}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={`${g.builtin ? "全部上游" : g.name} 的操作`} />
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
 * 成员。**有先后的用「→」连**（按顺序、手动选择：前一个不可用才用下一个），
 * 按运行时数字排的（轮询、延迟最低、费用最低）不连 —— 那几种的次序不是写死的。
 */
function Members({ g }: { g: GroupView }) {
  const ordered = g.kind === "fallback" || g.kind === "select";
  const list =
    g.kind === "select" && g.selected
      ? [g.selected, ...g.providers.filter((p) => p !== g.selected)]
      : g.providers;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((p, i) => (
        // 箭头和它后面的成员放在一起换行，续行以「→」开头，读得出是接着上一行
        <span key={p} className="inline-flex items-center gap-1">
          {i > 0 && ordered && <span className="text-muted-foreground">→</span>}
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 font-mono tw-label leading-5",
              g.kind === "select" && p === g.selected
                ? "border-foreground/30 bg-foreground/10"
                : "border-border bg-muted/40",
            )}
          >
            {g.kind === "select" && p === g.selected && (
              <span aria-hidden className="size-1.5 rounded-full bg-foreground" />
            )}
            {p}
          </span>
        </span>
      ))}
    </div>
  );
}

function menu(g: GroupView, a: GroupActions): MenuItems {
  if (g.builtin) {
    return [{ kind: "item", label: "前往上游页", onSelect: a.showUpstreams }];
  }
  return [
    { kind: "item", label: "编辑…", onSelect: () => a.edit(g.name) },
    ...(g.kind === "select"
      ? ([
          {
            kind: "sub",
            label: "优先使用",
            choices: g.providers.map((p) => ({
              label: p,
              checked: p === g.selected,
              onSelect: () => a.prefer(g, p),
            })),
          },
        ] as MenuItems)
      : []),
    { kind: "item", label: "复制…", onSelect: () => a.duplicate(g.name) },
    { kind: "sep" },
    { kind: "item", label: "在配置文件中定位", onSelect: () => a.locate(g.name) },
    { kind: "sep" },
    { kind: "item", label: "删除…", onSelect: () => a.remove(g.name), danger: true },
  ];
}
