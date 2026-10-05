import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { copyText } from "@/traffic/cells";
import { usd, type ProviderView } from "@/types";
import { Logo, upstreamGlyph } from "@/ui/logos";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { contextWindow } from "@/upstreams/labels";
import { keepInRow, openRow } from "@/upstreams/parts";
import type { AliasView } from "@/types";
import { aliasesText } from "./aliases.i18n";
import { aliasWarnings, modelLines, type AliasWarning, type ModelLine } from "./logic";

export interface AliasActions {
  edit: (name: string) => void;
  traffic: (name: string) => void;
  remove: (name: string) => void;
}

/**
 * 别名列表。**只读**：单击一行（或 Enter）编辑，行尾按钮和右键是同一份菜单。
 *
 * 「上游模型」一格每个上游一行，写发给它的名称 —— 用户要确认的正是「哪几个上游能接
 * 这个名称、各自收到什么」。有要留意的（没有上游提供、同名模型被挡住）在下面用琥珀色
 * 说一句。
 */
export function AliasTable({
  aliases,
  providers,
  actions,
}: {
  aliases: AliasView[];
  /** 上游的标志要用 */
  providers: Pick<ProviderView, "name" | "base_url" | "protocol">[];
  actions: AliasActions;
}) {
  const t = useText(aliasesText);
  const c = useText(commonText);
  const shown = usePresentList(aliases, (a) => a.name);
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-52 @max-3xl/page:w-40">{t.alias}</TableHead>
          <TableHead>{t.models}</TableHead>
          <TableHead className="text-right">{t.context}</TableHead>
          <TableHead className="text-right">{t.day}</TableHead>
          <TableHead className="w-9">
            <span className="sr-only">{t.actionsColumn}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map(({ item: a, key, presence }) => {
          const items: MenuItems = [
            { kind: "item", label: `${c.edit}…`, onSelect: () => actions.edit(a.name) },
            { kind: "item", label: t.copyName, onSelect: () => void copyText(a.name) },
            { kind: "item", label: t.traffic, onSelect: () => actions.traffic(a.name) },
            { kind: "sep" },
            { kind: "item", label: `${c.delete}…`, onSelect: () => actions.remove(a.name), danger: true },
          ];
          return (
            <RowMenu key={key} items={items}>
              <TableRow data-row={a.name} {...openRow(() => actions.edit(a.name), rowMotion(presence))}>
                <TableCell className="max-w-52 py-2 align-top @max-3xl/page:max-w-40">
                  <span className="block truncate font-mono font-medium leading-5">{a.name}</span>
                </TableCell>
                <TableCell className="w-full max-w-0 py-2 whitespace-normal">
                  <Lines lines={modelLines(a)} providers={providers} />
                  {aliasWarnings(a).map((w) => (
                    <p key={w.kind} className="mt-0.5 whitespace-normal tw-label text-warning">
                      <WarningText w={w} name={a.name} />
                    </p>
                  ))}
                </TableCell>
                <TableCell className="py-2 text-right align-top tw-num leading-5">
                  {a.context_window ? contextWindow(a.context_window) : ""}
                </TableCell>
                <TableCell className="py-2 text-right align-top">
                  <DayFigure a={a} />
                </TableCell>
                <TableCell className="py-2 text-right align-top" {...keepInRow}>
                  <RowMenuButton items={items} label={t.actions(a.name)} />
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
 * 每个上游一行：标志、上游名、发给它的名称。上游名一列对齐；名称长了折行，不截断 ——
 * 窄窗口里 `us.anthropic.claude-sonnet-5-v1:0` 截掉后半截就分不出是哪一个了。
 * 没有上游提供的名称，上游那一格写「—」。
 */
export function Lines({
  lines,
  providers,
  className,
}: {
  lines: ModelLine[];
  providers: Pick<ProviderView, "name" | "base_url" | "protocol">[];
  className?: string;
}) {
  const t = useText(aliasesText);
  return (
    <div className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5", className)}>
      {lines.map((l, i) => (
        <Line key={`${l.provider ?? ""}/${l.model}/${i}`} line={l} providers={providers} notOffered={t.notOffered} />
      ))}
    </div>
  );
}

function Line({
  line,
  providers,
  notOffered,
}: {
  line: ModelLine;
  providers: Pick<ProviderView, "name" | "base_url" | "protocol">[];
  notOffered: string;
}) {
  if (line.provider === null) {
    return (
      <>
        <Tip text={notOffered}>
          <span className="self-start leading-5 text-muted-foreground">—</span>
        </Tip>
        <span className={MODEL}>{line.model}</span>
      </>
    );
  }
  const p = providers.find((x) => x.name === line.provider);
  const id = upstreamGlyph({ name: line.provider, baseUrl: p?.base_url, protocol: p?.protocol });
  return (
    <>
      <span className="inline-flex items-center gap-1.5 self-start leading-5 whitespace-nowrap">
        {id ? (
          <Logo id={id} size={11} className="text-foreground/70" />
        ) : (
          <span aria-hidden className="w-[11px]" />
        )}
        {line.provider}
      </span>
      <span className={MODEL}>{line.model}</span>
    </>
  );
}

/** 模型名：等宽、淡一档，长了在任意处折行 */
const MODEL = "min-w-0 font-mono tw-label leading-5 break-all text-muted-foreground";

function WarningText({ w, name }: { w: AliasWarning; name: string }) {
  const t = useText(aliasesText);
  return <>{w.kind === "unserved" ? t.unserved(w.models) : t.shadowed(w.providers, name)}</>;
}

/** 24 小时：次数在上、费用在下（淡一档）。一次都没有写「—」；费用取不到就只写次数 */
function DayFigure({ a }: { a: AliasView }) {
  const t = useText(aliasesText);
  if (a.requests_24h === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end leading-5">
      <span className="tw-num">{t.requests(a.requests_24h)}</span>
      {a.cost_micros_24h != null && (
        <span className="tw-label tw-num text-muted-foreground">{usd(a.cost_micros_24h)}</span>
      )}
    </div>
  );
}
