import { ShieldCheckIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { ClientLogo } from "@/ui/logos";
import { rowMotion, usePresentList } from "@/ui/motion";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import { ROW_FOCUS, rowNav, stop } from "@/security/rows";
import type { ScanFinding, ScanReport } from "@/types";
import { mcpText } from "./McpPage.i18n";
import { copyText, Level, rank, shortPath, worst } from "./parts";

/** 同一处发现：同一个文件、同一行、同一条规则 */
const sameFinding = (a: ScanFinding, b: ScanFinding) =>
  a.path === b.path && a.line === b.line && a.rule === b.rule;

const keyOf = (f: ScanFinding) => `${f.path}:${f.line}:${f.rule}`;

/**
 * 扫描发现。**只报告，不删除** —— 误报删掉用户的正常配置比漏报还糟。
 *
 * 新出现的排在前面并标「新」：「一个用了半年的 skill 突然多了一段零宽字符」
 * 这个信号，比「这个文件里有可疑内容」强得多。点一行看详情（命中的那一行原文），
 * 右键或行尾菜单里能复制路径，去编辑器里打开。
 */
export function Findings({
  data,
  alerts,
  nameOf,
  onSeen,
  onOpen,
  movable,
  onMove,
}: {
  data: ScanReport;
  /** 监听到的、新出现的那些 */
  alerts: ScanFinding[];
  nameOf: (client: string) => string;
  onSeen: () => void;
  /** 打开一处的详情（对话框在页面上：技能与钩子那边也能点开） */
  onOpen: (f: ScanFinding) => void;
  /** 这个客户端的配置位置能不能换 */
  movable: (client: string) => boolean;
  /** 更改这个客户端的配置位置 */
  onMove: (client: string) => void;
}) {
  const t = useText(mcpText);
  const isNew = (f: ScanFinding) => alerts.some((a) => sameFinding(a, f));
  const rows = [...data.findings].sort(
    (a, b) => Number(isNew(b)) - Number(isNew(a)) || rank(a.level) - rank(b.level),
  );
  const fresh = rows.filter(isNew);
  const shown = usePresentList(rows, keyOf);

  const menu = (f: ScanFinding): MenuItems => [
    { kind: "item", label: t.viewDetail, onSelect: () => onOpen(f) },
    { kind: "item", label: t.copyPath, onSelect: () => copyText(`${f.path}:${f.line}`) },
    ...(movable(f.client)
      ? [
          { kind: "sep" as const },
          { kind: "item" as const, label: t.changePathOf(nameOf(f.client)), onSelect: () => onMove(f.client) },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <Banner
        show={fresh.length > 0}
        layout="inline"
        tone={worst(fresh) === "high" ? "error" : "warning"}
        actions={
          <Button variant="outline" size="sm" onClick={onSeen}>
            {t.markRead}
          </Button>
        }
      >
        {t.newFindings(fresh.length, (s) => (
          <span className="font-semibold">{s}</span>
        ))}
      </Banner>

      {/* 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉 */}
      <Banner show={data.unreadable.length > 0} layout="inline" tone="warning" title={t.unreadable(data.unreadable.length)}>
        <span className="font-mono tw-label break-all">{data.unreadable.map(shortPath).join(t.listSep)}</span>
      </Banner>

      {rows.length === 0 ? (
        // 没风险的时候要说「没有问题」，而不是让这一块消失
        <EmptyState
          icon={<ShieldCheckIcon />}
          title={t.noIssues}
          description={
            <>
              {t.scope}
              <br />
              {t.checked}
            </>
          }
        />
      ) : (
        <>
          <Table className="table-fixed min-w-[520px]">
            <colgroup>
              {/* 「● Medium」要 67 */}
              <col className="w-[88px]" />
              <col />
              <col className="w-[156px]" />
              <col className="w-9" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t.level}</TableHead>
                <TableHead>{t.finding}</TableHead>
                <TableHead>{t.client}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map(({ item: f, key, presence }) => {
                const items = menu(f);
                const title = coreText(f.title);
                return (
                  <RowMenu key={key} items={items}>
                    <TableRow
                      className={cn("cursor-default", ROW_FOCUS, rowMotion(presence))}
                      onClick={() => onOpen(f)}
                      {...rowNav(() => onOpen(f))}
                    >
                      <TableCell>
                        <Level level={f.level} />
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium">{title}</span>
                          {isNew(f) && (
                            <span className="shrink-0 rounded bg-destructive px-1 tw-label font-medium text-white">
                              {t.isNew}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono tw-label text-muted-foreground">
                          {shortPath(f.path)}:{f.line}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                          <ClientLogo id={f.client} name={nameOf(f.client)} className="shrink-0" />
                          <span className="truncate">{nameOf(f.client)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right" {...stop}>
                        <RowMenuButton items={items} label={t.actionsFor(title)} />
                      </TableCell>
                    </TableRow>
                  </RowMenu>
                );
              })}
            </TableBody>
          </Table>
          <p className="tw-label text-muted-foreground">{t.scope}</p>
        </>
      )}
    </div>
  );
}

/** 一处发现的详情。**没有删除按钮** —— 删不删由用户自己去改文件 */
export function FindingDetail({ f, nameOf, onClose }: { f: ScanFinding; nameOf: (client: string) => string; onClose: () => void }) {
  const t = useText(mcpText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Level level={f.level} />
            <span className="min-w-0">{coreText(f.title)}</span>
          </DialogTitle>
          <DialogDescription>{coreText(f.detail)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 tw-body">
          <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <ClientLogo id={f.client} name={nameOf(f.client)} className="shrink-0" />
            <span className="shrink-0">{nameOf(f.client)}</span>
            <code className="min-w-0 truncate font-mono tw-label" title={`${f.path}:${f.line}`}>
              {f.path}:{f.line}
            </code>
          </div>
          {/* 不可见字符已经换成可见记号，否则这一行看起来和正常行一样，
              用户会以为是误报 */}
          <pre className="overflow-x-auto rounded-md border border-border bg-surface/60 p-2.5 font-mono tw-label leading-relaxed whitespace-pre-wrap break-all">
            {f.excerpt}
          </pre>
          <p className="tw-label text-muted-foreground">{t.reportOnly}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => copyText(`${f.path}:${f.line}`)}>
            {t.copyPath}
          </Button>
          <Button onClick={onClose}>{common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
