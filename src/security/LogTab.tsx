import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { windowStart, type Range } from "@/ui/range";
import { when } from "@/format";
import { appLabel } from "@/labels";
import { KeyLabel } from "@/KeyLabel";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import RequestDrawer from "@/RequestDrawer";
import { GUARDS, isRuleGuard, type RuleGuard, type SecurityDetail, type SecurityEventView } from "@/types";
import { api } from "./api";
import { ActionBadge, EventDetail, ruleName, whereOf } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { logTabText } from "./LogTab.i18n";

/** 一次读多少条。**一屏半** —— 再多就是替用户翻他不会看的那几页 */
const PAGE = 100;

/** 日志行上的菜单能做的两件事，由页面接住：它们要切标签、要写配置 */
export interface LogActions {
  viewRule: (guard: RuleGuard, id: string, custom: boolean) => void;
  disableRule: (guard: RuleGuard, id: string, custom: boolean) => void;
}

/**
 * 安全日志：一行是一次命中，各项防护的都在一张表里，「类型」一列分得开。
 *
 * **和概览上那几个数是同一批。**时间窗的起点用同一个函数算（`windowStart`），
 * 从概览点进来时，条数是那几个数之和。
 *
 * 点一行打开那次请求的详情 —— 日志说的是「命中了什么」，请求详情说的是
 * 「那次请求本身」，排查时两样都要看。
 */
export function LogTab({
  detail,
  range,
  tick,
  onCount,
  actions,
}: {
  detail: SecurityDetail | null;
  range: Range;
  /** 库里多了请求就涨一次。日志跟着重读，新命中不用手动刷新 */
  tick: number;
  /** 读到了几条。页面把它放在标签那一行上，挨着区间；没有记录时是 null */
  onCount: (count: string | null) => void;
  actions: LogActions;
}) {
  const t = useText(logTabText);
  const lt = useText(securityLabelsText);
  const [rows, setRows] = useState<SecurityEventView[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 点开的那次请求（右侧抽屉） */
  const [open, setOpen] = useState<number | null>(null);

  /*
    **换了区间从第一页读起；只是来了新记录，就把已经翻出来的几页一起重读。**
    用户往下翻了三页正看着，一条新命中进来就把列表弹回第一页，等于把他
    翻过的全扔了。
  */
  const key = `${range.ms}|${range.live ? 1 : 0}|${range.custom ? 1 : 0}`;
  const lastKey = useRef(key);
  const loaded = useRef(0);
  loaded.current = rows?.length ?? 0;
  useEffect(() => {
    const same = lastKey.current === key;
    lastKey.current = key;
    const limit = same ? Math.max(PAGE, loaded.current) : PAGE;
    let alive = true;
    api
      .events({ from_ms: windowStart(range), limit })
      .then((p) => {
        if (!alive) return;
        setRows(p.events);
        setMore(p.more);
        setError(null);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
    // `range` 换了 `key` 一定跟着换；把对象本身放进来的话，它每次重建都会多读一遍
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  async function loadMore() {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const p = await api.events({
        from_ms: windowStart(range),
        before: last.id,
        limit: PAGE,
      });
      setRows((r) => [...(r ?? []), ...p.events]);
      setMore(p.more);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * 这条规则现在还在不在、开没开。删掉的自定义规则，菜单里那两项就灰掉；
   * 输出长度没有规则，那两项也是灰的
   */
  const ruleOf = (e: SecurityEventView) =>
    isRuleGuard(e.guard)
      ? detail?.[e.guard].rules.find((r) => r.id === e.rule && r.custom === e.custom)
      : undefined;

  function menu(e: SecurityEventView): MenuItems {
    const r = ruleOf(e);
    return [
      { kind: "item", label: t.viewRequest, onSelect: () => setOpen(e.request_id) },
      {
        kind: "item",
        label: t.viewRule,
        onSelect: () => isRuleGuard(e.guard) && actions.viewRule(e.guard, e.rule, e.custom),
        disabled: !r,
      },
      { kind: "sep" },
      {
        kind: "item",
        label: t.disableRule,
        onSelect: () => isRuleGuard(e.guard) && actions.disableRule(e.guard, e.rule, e.custom),
        disabled: !r || !r.enabled,
      },
    ];
  }

  const count = rows && rows.length > 0 ? t.count(rows.length, more) : null;
  useEffect(() => {
    onCount(count);
    return () => onCount(null);
  }, [count, onCount]);

  // 空的时候说清是「这段时间没有」还是「根本不会有」
  const emptyNote = detail && GUARDS.every((g) => detail[g].mode === "off") ? t.allOff : t.empty;

  return (
    <div className="flex flex-col gap-3">
      {error && !rows ? (
        <p className="tw-body text-destructive">{error}</p>
      ) : !rows ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center tw-body text-muted-foreground">
          {emptyNote}
        </p>
      ) : (
        <>
          {/* 列宽是定死的：窗口再窄，「命中」一列也要留出能读的宽度，放不下就横向滚 */}
          <Table className="table-fixed min-w-[722px]">
            <colgroup>
              <col className="w-[92px]" />
              {/* 「Hidden text」要 88 */}
              <col className="w-[96px]" />
              <col />
              <col className="w-[84px]" />
              <col className="w-[230px]" />
              <col className="w-9" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t.time}</TableHead>
                <TableHead>{t.type}</TableHead>
                <TableHead>{t.hit}</TableHead>
                <TableHead>{t.action}</TableHead>
                <TableHead>{t.request}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => {
                const items = menu(e);
                const name = ruleName(e.guard, e.rule, e.custom);
                const where = whereOf(e);
                return (
                  <RowMenu key={e.id} items={items}>
                    <TableRow className="cursor-default" onClick={() => setOpen(e.request_id)}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        <Tip text={new Date(e.at_ms).toLocaleString()}>
                          <span>{when(e.at_ms)}</span>
                        </Tip>
                      </TableCell>
                      <TableCell className="truncate text-muted-foreground">{lt.guardShort[e.guard]}</TableCell>
                      <TableCell className="py-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium">{name}</span>
                          {e.custom && <Badge variant="outline">{lt.custom}</Badge>}
                          {where && <span className="shrink-0 text-muted-foreground">· {where}</span>}
                        </div>
                        {/* 值只剩头尾：日志截一张图就能带出去 */}
                        <div className="truncate tw-label text-muted-foreground">
                          <EventDetail e={e} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <ActionBadge action={e.action} />
                      </TableCell>
                      <TableCell className="py-2">
                        {/* 密钥是身份：打码的值加名字。名字是随便起的，不代表是哪个应用 */}
                        <div className="truncate">
                          <KeyLabel name={e.client || "—"} masked={e.key_masked} />
                          <span className="text-muted-foreground"> → </span>
                          {e.provider || "—"}
                        </div>
                        {/* 模型、推测出的应用、非本机的来源 */}
                        <div className="truncate tw-label text-muted-foreground">
                          {[e.model, e.client_hint && appLabel(e.client_hint), e.peer && t.from(e.peer)]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                        <RowMenuButton items={items} label={t.actionsFor(name)} />
                      </TableCell>
                    </TableRow>
                  </RowMenu>
                );
              })}
            </TableBody>
          </Table>
          {more && (
            <div className="flex justify-center">
              <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Spinner />}
                {t.loadMore}
              </Button>
            </div>
          )}
        </>
      )}

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
