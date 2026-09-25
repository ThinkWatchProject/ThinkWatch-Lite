import { Fragment, useState } from "react";
import { ArrowRightIcon, ShieldCheckIcon, ShieldOffIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { UpstreamLogo, ClientLogo } from "@/ui/logos";
import { rowMotion, usePresentList } from "@/ui/motion";
import { presetRange, RangePicker, type Range } from "@/ui/range";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState, Loadable, TableSkeleton } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { appLabel } from "@/labels";
import { KeyLabel } from "@/KeyLabel";
import { useText } from "@/i18n";
import RequestDrawer from "@/RequestDrawer";
import { GUARDS, isRuleGuard, type Guard, type RuleGuard, type SecurityDetail, type SecurityEventView } from "@/types";
import { ActionBadge, clock, dayHead, dayKey, EventDetail, ruleName, whereOf } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { logTabText } from "./LogTab.i18n";
import { GroupRow, ROW_FOCUS, rowNav, stop } from "./rows";
import type { SecurityLog } from "./useSecurityLog";

const DAY = 24 * 3_600_000;

/** 日志行上的菜单能做的事，由页面接住：它们要切标签、要写配置 */
export interface LogActions {
  viewRule: (guard: RuleGuard, id: string, custom: boolean) => void;
  disableRule: (guard: RuleGuard, id: string, custom: boolean) => void;
  /** 切到某一项防护的标签（空状态里的入口） */
  showGuard: (guard: Guard) => void;
}

/**
 * 安全日志：一行是一次命中，各项防护的都在一张表里，「类型」一列分得开。
 *
 * **按天分组，读起来是一条时间线**：一天一个标题（今天、昨天、9月23日周三），
 * 行上只写时刻。每行先说处置（状态点：切断、拒绝红，替换绿，仅记录琥珀），
 * 再说是哪一项、命中了什么、是哪次请求。
 *
 * 点一行打开那次请求的详情 —— 日志说的是「命中了什么」，请求详情说的是
 * 「那次请求本身」，排查时两样都要看。
 */
export function LogTab({
  log,
  range,
  onRange,
  detail,
  actions,
}: {
  log: SecurityLog;
  range: Range;
  onRange: (r: Range) => void;
  detail: SecurityDetail | undefined;
  actions: LogActions;
}) {
  const t = useText(logTabText);
  const lt = useText(securityLabelsText);
  /** 点开的那次请求（右侧抽屉） */
  const [open, setOpen] = useState<number | null>(null);

  // 空的时候说清是「这段时间没有」还是「根本不会有」
  const allOff = detail !== undefined && GUARDS.every((g) => detail[g].mode === "off");
  const widest = range.ms >= 30 * DAY || range.custom === true;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker value={range} onChange={onRange} live={false} align="start" />
      </div>

      <Loadable
        r={log.r}
        loading={<TableSkeleton rows={7} cols={5} />}
        errorTitle={t.loadFailed}
        isEmpty={(p) => p.events.length === 0}
        empty={
          allOff ? (
            <EmptyState
              icon={<ShieldOffIcon />}
              title={t.allOff}
              description={t.allOffHint}
              action={
                <Button size="sm" variant="outline" onClick={() => actions.showGuard("redact")}>
                  {t.goTo(lt.guards.redact)}
                  <ArrowRightIcon />
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ShieldCheckIcon />}
              title={t.emptyIn(range.label, range.custom === true)}
              description={t.emptyHint}
              action={
                !widest && (
                  <Button size="sm" variant="outline" onClick={() => onRange(presetRange("30d"))}>
                    {t.widen}
                  </Button>
                )
              }
            />
          )
        }
      >
        {(p) => (
          <LogTable
            events={p.events}
            more={p.more}
            detail={detail}
            actions={actions}
            onOpen={setOpen}
            loadMore={log.loadMore}
            loadingMore={log.loadingMore}
          />
        )}
      </Loadable>

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function LogTable({
  events,
  more,
  detail,
  actions,
  onOpen,
  loadMore,
  loadingMore,
}: {
  events: SecurityEventView[];
  more: boolean;
  detail: SecurityDetail | undefined;
  actions: LogActions;
  onOpen: (requestId: number) => void;
  loadMore: () => void;
  loadingMore: boolean;
}) {
  const t = useText(logTabText);
  const lt = useText(securityLabelsText);
  const shown = usePresentList(events, (e) => e.id);

  /*
    按天分组。列表本来就是倒序，同一天的挨在一起 —— 除了淡出的那一小会儿：
    一下子来了一整页新记录时，读回来的全是新的，旧的几行留在原处淡出，新行
    排在它们后面，同一天会被隔成两段。按天归拢，一天只有一个标题。
  */
  const days: { key: string; at: number; rows: typeof shown }[] = [];
  const byKey = new Map<string, (typeof days)[number]>();
  for (const s of shown) {
    const key = dayKey(s.item.at_ms);
    const day = byKey.get(key);
    if (day) day.rows.push(s);
    else {
      const next = { key, at: s.item.at_ms, rows: [s] };
      byKey.set(key, next);
      days.push(next);
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
      { kind: "item", label: t.viewRequest, onSelect: () => onOpen(e.request_id) },
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

  return (
    <>
      {/* 列宽是定死的：窗口再窄，「命中」一列也要留出能读的宽度，放不下就横向滚 */}
      <Table className="table-fixed min-w-[760px]">
        <colgroup>
          <col className="w-[76px]" />
          {/* 「● Recorded」要 86 */}
          <col className="w-[92px]" />
          {/* 「Hidden text」要 88 */}
          <col className="w-[92px]" />
          <col />
          <col className="w-[304px]" />
          <col className="w-9" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>{t.time}</TableHead>
            <TableHead>{t.action}</TableHead>
            <TableHead>{t.type}</TableHead>
            <TableHead>{t.hit}</TableHead>
            <TableHead>{t.request}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((day, i) => {
            const head = dayHead(day.at);
            // 最后一天可能还没翻完：条数只写读全了的那几天
            const whole = !more || i < days.length - 1;
            return (
              <Fragment key={day.key}>
                <GroupRow
                  span={6}
                  title={head.title}
                  sub={head.date}
                  count={whole ? t.count(day.rows.filter((s) => s.presence !== "exit").length) : undefined}
                />
                {day.rows.map(({ item: e, key, presence }) => {
                  const items = menu(e);
                  const name = ruleName(e.guard, e.rule, e.custom);
                  const where = whereOf(e);
                  const app = e.client_hint ? appLabel(e.client_hint) : null;
                  return (
                    <RowMenu key={key} items={items}>
                      <TableRow
                        className={cn("cursor-default", ROW_FOCUS, rowMotion(presence))}
                        onClick={() => onOpen(e.request_id)}
                        {...rowNav(() => onOpen(e.request_id))}
                      >
                        <TableCell className="tw-num text-muted-foreground">
                          <Tip text={new Date(e.at_ms).toLocaleString()}>
                            <span>{clock(e.at_ms)}</span>
                          </Tip>
                        </TableCell>
                        <TableCell>
                          <ActionBadge action={e.action} />
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
                        <TableCell className="py-2">
                          {/*
                            密钥是身份：打码的值加名字。名字是随便起的，不代表是哪个应用。
                            **上游不让位**：放不下时先截密钥，去了哪儿要一直看得见
                          */}
                          <div className="flex min-w-0 items-center gap-1">
                            <span className="min-w-0 truncate">
                              <KeyLabel name={e.client || "—"} masked={e.key_masked} />
                            </span>
                            <span className="shrink-0 text-muted-foreground">→</span>
                            {e.provider && (
                              <UpstreamLogo name={e.provider} size={13} className="shrink-0 text-muted-foreground" />
                            )}
                            <span className="shrink-0">{e.provider || "—"}</span>
                          </div>
                          {/* 模型、推测出的应用、非本机的来源 */}
                          <div className="flex min-w-0 items-center gap-1 tw-label text-muted-foreground">
                            {e.model && <span className="truncate">{e.model}</span>}
                            {app && (
                              <>
                                {e.model && <span className="shrink-0">·</span>}
                                <ClientLogo id={e.client_hint ?? ""} name={app} size={11} className="shrink-0" />
                                <span className="shrink-0">{app}</span>
                              </>
                            )}
                            {e.peer && (
                              <>
                                {(e.model || app) && <span className="shrink-0">·</span>}
                                <span className="shrink-0">{t.from(e.peer)}</span>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right" {...stop}>
                          <RowMenuButton items={items} label={t.actionsFor(name)} />
                        </TableCell>
                      </TableRow>
                    </RowMenu>
                  );
                })}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {more && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" pending={loadingMore} onClick={loadMore}>
            {t.loadMore}
          </Button>
        </div>
      )}
    </>
  );
}
