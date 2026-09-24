import type { KeyboardEvent, MouseEvent } from "react";
import { LayersIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { groupKindLabel } from "@/labels";
import type { GroupView, Overview } from "@/types";
import { membersOf, type ChainFocus } from "./chain";
import { groupTableText } from "./GroupTable.i18n";
import { TargetIcon, upstreamState } from "./parts";
import { routingText } from "./routing.i18n";

export interface GroupActions {
  create: () => void;
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

const stop = (e: MouseEvent | KeyboardEvent) => e.stopPropagation();

/**
 * 策略组列表。「全部上游」是内置的，排第一行：成员随上游列表更新，不能编辑。
 * 单击其余的行打开编辑；悬停一行，路由图里经过它的路亮起来。
 */
export function GroupTable({
  ov,
  actions,
  focus,
  onEnter,
  onLeave,
  flash,
  busy,
}: {
  ov: Overview;
  actions: GroupActions;
  focus: ChainFocus | null;
  onEnter: (f: ChainFocus) => void;
  onLeave: () => void;
  flash: string | null;
  /** 正在改「优先使用」的策略组 */
  busy: ReadonlySet<string>;
}) {
  const t = useText(groupTableText);
  const rt = useText(routingText);
  const groups = [...ov.groups].sort((a, b) => Number(b.builtin) - Number(a.builtin));
  const shown = usePresentList(groups, (g) => g.name);
  return (
    <>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[22%]">{rt.name}</TableHead>
            <TableHead className="w-[15%]">{rt.strategy}</TableHead>
            <TableHead>{rt.members}</TableHead>
            <TableHead className="w-[22%]">{t.references}</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map(({ item: g, key, presence }) => {
            const items = menu(g, actions);
            const refs = groupRefs(ov, g.name);
            const label = g.builtin ? t.allUpstreams : g.name;
            const f: ChainFocus = { kind: "group", name: g.name };
            const lit = focus?.kind === "group" && focus.name === g.name;
            const open = g.builtin ? undefined : () => actions.edit(g.name);
            return (
              <RowMenu key={key} items={items}>
                <TableRow
                  data-row={g.name}
                  data-lit={lit || undefined}
                  aria-busy={busy.has(g.name) || undefined}
                  tabIndex={0}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (!open || e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                    e.preventDefault();
                    open();
                  }}
                  onMouseEnter={() => onEnter(f)}
                  onMouseLeave={onLeave}
                  onFocus={(e) => e.target === e.currentTarget && onEnter(f)}
                  onBlur={onLeave}
                  className={cn(
                    "outline-none focus-visible:bg-muted/60 data-[lit]:bg-muted/50",
                    open ? "cursor-pointer" : "cursor-default",
                    rowMotion(presence),
                    flash === g.name && "motion-row-in",
                  )}
                >
                  <TableCell className="py-2.5 align-top">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{label}</span>
                      {g.builtin && <Badge variant="outline">{t.builtin}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="py-2.5 align-top">
                    <div>{groupKindLabel(g.kind)}</div>
                    {g.hurts_cache && <div className="tw-label text-warning">{rt.affectsCache}</div>}
                  </TableCell>
                  <TableCell className="py-2.5 align-top whitespace-normal">
                    <Members g={g} ov={ov} busy={busy.has(g.name)} />
                    {g.builtin && <div className="mt-1 tw-label text-muted-foreground">{t.listOrder}</div>}
                  </TableCell>
                  <TableCell className="overflow-hidden py-2.5 align-top">
                    {refs.length === 0 ? (
                      <span className="text-muted-foreground">{t.unreferenced}</span>
                    ) : (
                      <Tip
                        text={
                          <div className="flex flex-col gap-0.5">
                            {refs.map((r) => (
                              <span key={`${r.route}/${r.rule}`}>
                                {r.route} · {r.rule}
                              </span>
                            ))}
                          </div>
                        }
                      >
                        <div className="truncate">
                          {refs.map((r, i) => (
                            <span key={`${r.route}/${r.rule}`}>
                              {i > 0 && <span className="text-muted-foreground">{t.refSep}</span>}
                              {r.route}
                              <span className="text-muted-foreground"> · {r.rule}</span>
                            </span>
                          ))}
                        </div>
                      </Tip>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-right align-top" onClick={stop} onKeyDown={stop}>
                    <RowMenuButton items={items} label={rt.actionsFor(label)} />
                  </TableCell>
                </TableRow>
              </RowMenu>
            );
          })}
        </TableBody>
      </Table>
      {groups.every((g) => g.builtin) && (
        <EmptyState
          variant="outlined"
          className="mt-4"
          icon={<LayersIcon />}
          title={t.noGroups}
          description={t.noGroupsDesc}
          action={
            <Button size="sm" variant="outline" onClick={actions.create}>
              <PlusIcon />
              {rt.newGroup}
            </Button>
          }
        />
      )}
    </>
  );
}

/**
 * 成员。**有先后的用「→」连**（按顺序、手动选择：前一个不可用才用下一个），
 * 按运行时数字排的（轮询、延迟最低、费用最低）不连 —— 那几种的次序不是写死的。
 * 手动选择的那一个排最前、标「优先」；正在改的那一下，它的底色明暗。
 */
function Members({ g, ov, busy }: { g: GroupView; ov: Overview; busy: boolean }) {
  const t = useText(groupTableText);
  const ordered = g.kind === "fallback" || g.kind === "select";
  const list = membersOf(
    g,
    ov.providers.map((p) => p.name),
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((p, i) => {
        const s = upstreamState(ov.providers.find((x) => x.name === p));
        const preferred = g.kind === "select" && p === g.selected;
        return (
          // 箭头和它后面的成员放在一起换行，续行以「→」开头，读得出是接着上一行
          <span key={p} className="inline-flex items-center gap-1">
            {i > 0 && ordered && <span className="text-muted-foreground/60">→</span>}
            <span
              className={cn(
                "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border pr-1.5 pl-1 tw-label transition-colors duration-(--motion-base)",
                preferred ? "border-foreground/30 bg-foreground/[0.07]" : "border-border bg-surface/70",
                preferred && busy && "motion-shimmer",
                s?.tone === "idle" && "text-muted-foreground",
              )}
            >
              <TargetIcon name={p} providers={ov.providers} size={12} />
              <span className="font-mono">{p}</span>
              {preferred && <span className="text-muted-foreground">{t.preferredTag}</span>}
              {s && <StatusDot tone={s.tone} label={s.label} />}
            </span>
          </span>
        );
      })}
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
