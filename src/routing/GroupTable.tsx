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
import { textOf, useText } from "@/i18n";
import { groupKindLabel } from "@/labels";
import type { GroupView, Overview } from "@/types";
import { groupTableText } from "./GroupTable.i18n";
import { routingText } from "./routing.i18n";

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
  const t = useText(groupTableText);
  const rt = useText(routingText);
  const groups = [...ov.groups].sort((a, b) => Number(b.builtin) - Number(a.builtin));
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          {/* 176px：内置那一行是「全部上游 + 内置」，英文的 All upstreams 加 Built-in
              徽标要 164，144 的话名字被截成 All upstream… */}
          <TableHead className="w-44">{rt.name}</TableHead>
          <TableHead className="w-28">{rt.strategy}</TableHead>
          <TableHead>{rt.members}</TableHead>
          <TableHead className="w-48">{t.references}</TableHead>
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
                    <span className="truncate font-medium">{g.builtin ? t.allUpstreams : g.name}</span>
                    {g.builtin && <Badge variant="outline">{t.builtin}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div>{groupKindLabel(g.kind)}</div>
                  {g.hurts_cache && <div className="tw-label text-warning">{rt.affectsCache}</div>}
                </TableCell>
                <TableCell className="whitespace-normal">
                  <Members g={g} />
                  {g.builtin ? (
                    <div className="tw-label text-muted-foreground">{t.listOrder}</div>
                  ) : g.kind === "select" && g.selected ? (
                    <div className="tw-label text-muted-foreground">{t.preferredIs(g.selected)}</div>
                  ) : null}
                </TableCell>
                <TableCell className="overflow-hidden">
                  {refs.length === 0 ? (
                    <span className="text-muted-foreground">{t.unreferenced}</span>
                  ) : (
                    <div className="truncate" title={refs.map((r) => `${r.route} · ${r.rule}`).join(t.refSep)}>
                      {refs.map((r, i) => (
                        <Fragment key={`${r.route}/${r.rule}`}>
                          {i > 0 && t.refSep}
                          {r.route} · {r.rule}
                        </Fragment>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <RowMenuButton items={items} label={rt.actionsFor(g.builtin ? t.allUpstreams : g.name)} />
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
  const t = textOf(groupTableText);
  const rt = textOf(routingText);
  if (g.builtin) {
    return [{ kind: "item", label: rt.showUpstreams, onSelect: a.showUpstreams }];
  }
  return [
    { kind: "item", label: rt.editMenu, onSelect: () => a.edit(g.name) },
    ...(g.kind === "select"
      ? ([
          {
            kind: "sub",
            label: t.prefer,
            choices: g.providers.map((p) => ({
              label: p,
              checked: p === g.selected,
              onSelect: () => a.prefer(g, p),
            })),
          },
        ] as MenuItems)
      : []),
    { kind: "item", label: rt.duplicateMenu, onSelect: () => a.duplicate(g.name) },
    { kind: "sep" },
    { kind: "item", label: rt.locate, onSelect: () => a.locate(g.name) },
    { kind: "sep" },
    { kind: "item", label: rt.deleteMenu, onSelect: () => a.remove(g.name), danger: true },
  ];
}
