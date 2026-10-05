import { useMemo, useState } from "react";
import { SearchIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Input } from "@/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Segmented } from "@/ui/segmented";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import { Boxed, FormItem, Note } from "@/upstreams/parts";
import type { KnownModel } from "@/types";
import { modelScopeText } from "./ModelScope.i18n";
import {
  addPattern,
  hasAliases,
  locked,
  patternHits,
  removeEntry,
  rowsOf,
  splitEntries,
  toggleModel,
  visibleCount,
  type Scope,
  type Source,
} from "./scope";

/** 一次画多少行。几百个模型全渲染出来，打开对话框会卡一下 */
const PAGE = 60;

/**
 * 「可见模型」那一块：三态，以及指定范围时的规则与勾选。
 *
 * **模型清单来自网关聚合后的目录，不按这把密钥的路由过滤。**core 的准入
 * （`resolve_allowed`）只看客户端方言和 `allow`，不看路由 —— 按路由删掉
 * 一半，显示的就不是客户端真会看到的那一份。每行写明来自哪个上游。
 *
 * **别名也列在里面**，名称旁一个「别名」标记。范围里有它列表里的某个模型时，它跟着
 * 可见：勾上、点不动，来源写「随 … 放行」。反过来不成立 —— 只选别名，它的模型不可见。
 */
export function ModelScope({
  scope,
  entries,
  catalog,
  onScope,
  onEntries,
}: {
  scope: Scope;
  entries: string[];
  /** 网关知道的全部模型，含别名。尚未获取到时是空的 */
  catalog: KnownModel[];
  onScope: (s: Scope) => void;
  onEntries: (e: string[]) => void;
}) {
  const t = useText(modelScopeText);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [shown, setShown] = useState(PAGE);

  const { patterns } = splitEntries(entries);
  const rows = useMemo(() => rowsOf(entries, catalog), [entries, catalog]);
  const matched = useMemo(() => {
    // 目录是空的时候没有搜索框：之前留下的过滤词不能把剩下那几行也藏起来
    const q = catalog.length > 0 ? filter.trim().toLowerCase() : "";
    return q ? rows.filter((r) => r.id.toLowerCase().includes(q)) : rows;
  }, [rows, filter, catalog.length]);
  const visible = visibleCount(entries, catalog);

  function commitDraft() {
    const next = addPattern(entries, draft);
    if (next !== entries) onEntries(next);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-3">
      <FormItem label={t.scope}>
        <Segmented<Scope>
          value={scope}
          options={[
            { id: "all", label: t.all },
            { id: "some", label: t.some },
            { id: "none", label: t.none },
          ]}
          onChange={onScope}
        />
      </FormItem>

      {scope === "all" && (
        <Note>{catalog.length > 0 ? t.allNote(catalog.length) : t.allNoteEmpty}</Note>
      )}
      {/* 「无」的后果说清楚：它看起来只是少了几个模型，实际上这把密钥没法用了 */}
      {scope === "none" && <p className="tw-label text-warning">{t.noneNote}</p>}

      {scope === "some" && (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline gap-2.5">
              <span className="tw-body font-medium">{t.patterns}</span>
              <span className="tw-label text-muted-foreground">{t.patternsHint}</span>
            </div>
            <Boxed>
              {patterns.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2.5 border-b border-border px-3 py-1.5 last:border-b-0"
                >
                  <span className="flex-1 truncate font-mono tw-body">{p}</span>
                  <span className="tw-label tabular-nums text-muted-foreground">
                    {catalog.length > 0 ? t.patternHits(patternHits(p, catalog)) : t.patternHitsUnknown}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t.patternRemove(p)}
                    className="-my-1 -mr-1 text-muted-foreground"
                    onClick={() => onEntries(removeEntry(entries, p))}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2.5 px-3 py-1">
                <Input
                  aria-label={t.patterns}
                  className="h-7 flex-1 border-0 px-0 font-mono shadow-none focus-visible:ring-0"
                  placeholder={t.patternPlaceholder}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitDraft}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    // 对话框会把回车当成提交
                    e.preventDefault();
                    commitDraft();
                  }}
                />
                <span className="tw-label text-muted-foreground">{t.patternAdd}</span>
              </div>
            </Boxed>
          </div>

          {catalog.length === 0 && <Note>{t.noCatalog}</Note>}
          {/*
            **目录是空的也要列出单独选中的那几条。**在规则框里手填的模型 ID（没有 `*`）
            是单独选中的一条，不算规则：以前目录一空这张表就不画，它们既看不见也删不掉
          */}
          {(catalog.length > 0 || rows.length > 0) && (
            <>
              {catalog.length > 0 && (
                <div className="flex items-center gap-3">
                  <InputGroup className="flex-1">
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    <InputGroupInput
                      aria-label={t.search}
                      placeholder={t.search}
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value);
                        setShown(PAGE);
                      }}
                    />
                  </InputGroup>
                  <span className="tw-label tabular-nums text-muted-foreground">
                    {t.counts(visible, catalog.length)}
                  </span>
                </div>
              )}

              <Boxed className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-9" />
                      <TableHead>{t.model}</TableHead>
                      <TableHead className="w-28">{t.provider}</TableHead>
                      <TableHead className="w-40">{t.source}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matched.slice(0, shown).map((r) => (
                      <TableRow key={r.id}>
                        {/* 点不动的那些，把原因挂在格子上 —— 一个禁用的
                            勾选框自己不会说明为什么 */}
                        <TableCell title={lockedTitle(r.source, t) ?? undefined}>
                          <Checkbox
                            aria-label={r.id}
                            checked={r.source != null}
                            // 规则命中的点不动：一次勾选把规则展开成几百条明细，
                            // 是用户看不出原因的一次大改。随别的模型放行的别名
                            // 同理：取消它要先去掉那个模型
                            disabled={locked(r.source)}
                            onCheckedChange={(v) => onEntries(toggleModel(entries, r.id, v === true))}
                          />
                        </TableCell>
                        <TableCell className={r.source ? undefined : "text-muted-foreground"}>
                          <span className="font-mono">{r.id}</span>
                          {r.alias && (
                            <Badge
                              variant="secondary"
                              title={t.aliasOf(r.alias)}
                              className="ml-1.5 h-4 rounded-[4px] px-1 align-[1px] font-normal"
                              style={{ fontSize: 11 }}
                            >
                              {t.alias}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.unknown ? "—" : t.providers(r.providers)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{sourceText(r.source, t)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {matched.length === 0 && (
                  <p className="px-3 py-2 tw-label text-muted-foreground">{t.noMatch}</p>
                )}
                {matched.length > shown && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start rounded-none px-3 font-normal text-muted-foreground"
                    onClick={() => setShown((n) => n + PAGE)}
                  >
                    {t.rest(matched.length - shown)}
                  </Button>
                )}
              </Boxed>
              {hasAliases(catalog) && <Note>{t.aliasRule}</Note>}
            </>
          )}
        </>
      )}
    </div>
  );
}

type ScopeText = (typeof modelScopeText)["zh"];

/** 「来源」那一格 */
function sourceText(source: Source, t: ScopeText): string {
  switch (source?.kind) {
    case "pattern":
      return t.byPattern(source.pattern);
    case "inherited":
      return t.inherited(source.model);
    case "picked":
      return t.picked;
    default:
      return "";
  }
}

/** 点不动的那一行为什么点不动 */
function lockedTitle(source: Source, t: ScopeText): string | null {
  if (source?.kind === "pattern") return t.lockedHint(source.pattern);
  if (source?.kind === "inherited") return t.inheritedHint(source.model);
  return null;
}
