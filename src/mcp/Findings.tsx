import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { ScanFinding, ScanResponse } from "@/types";
import { mcpText } from "./McpPage.i18n";

/** 同一处发现：同一个文件、同一行、同一条规则 */
export const sameFinding = (a: ScanFinding, b: ScanFinding) =>
  a.path === b.path && a.line === b.line && a.rule === b.rule;

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** 级别。**颜色和字一起说** —— 只靠颜色的话，色弱的人分不出高和中 */
export function Level({ level }: { level: ScanFinding["level"] }) {
  const t = useText(mcpText);
  return (
    <span
      className={
        "inline-flex h-5 min-w-5 items-center justify-center rounded px-1 tw-label font-medium " +
        (level === "high"
          ? "bg-destructive/15 text-destructive"
          : level === "medium"
            ? "bg-warning/15 text-warning"
            : "bg-muted text-muted-foreground")
      }
    >
      {t.levels[level] ?? level}
    </span>
  );
}

/** 路径收成 `~/…`，一行放得下 */
export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

/**
 * 扫描发现。**只报告，不删除** —— 误报删掉用户的正常配置比漏报还糟。
 *
 * 新出现的排在前面并标「新」：「一个用了半年的 skill 突然多了一段零宽字符」
 * 这个信号，比「这个文件里有可疑内容」强得多。
 */
export function Findings({
  data,
  alerts,
  nameOf,
  onSeen,
}: {
  data: ScanResponse;
  /** 监听到的、新出现的那些 */
  alerts: ScanFinding[];
  nameOf: (client: string) => string;
  onSeen: () => void;
}) {
  const t = useText(mcpText);
  const [open, setOpen] = useState<ScanFinding | null>(null);
  const isNew = (f: ScanFinding) => alerts.some((a) => sameFinding(a, f));
  const rows = [...data.findings].sort(
    (a, b) => Number(isNew(b)) - Number(isNew(a)) || (RANK[a.level] ?? 3) - (RANK[b.level] ?? 3),
  );
  const fresh = rows.filter(isNew).length;

  return (
    <div className="flex flex-col gap-3">
      {fresh > 0 && (
        <div className="flex items-center gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 tw-body">
          <TriangleAlertIcon className="size-4 shrink-0 text-destructive" />
          <span className="text-destructive">
            {t.newFindings(fresh, (s) => (
              <span className="font-semibold">{s}</span>
            ))}
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="xs" onClick={onSeen}>
            {t.markRead}
          </Button>
        </div>
      )}

      <p className="tw-label text-muted-foreground">{t.scanned(data.scanned)}</p>
      {/* 悄悄跳过比不扫更糟：它会给人一种「查过了」的错觉 */}
      {data.unreadable.length > 0 && <p className="tw-label text-warning">{t.unreadable(data.unreadable)}</p>}

      {rows.length === 0 ? (
        // 没风险的时候要说「没有问题」，而不是让这一块消失
        <p className="rounded-md border border-dashed border-border px-4 py-8 text-center tw-body text-muted-foreground">
          {t.noIssues}
          <Tip text={t.checkedTip}>
            <span className="ml-1 underline decoration-dotted underline-offset-2">{t.checked}</span>
          </Tip>
        </p>
      ) : (
        <Table className="table-fixed min-w-[480px]">
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-[140px]" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>{t.level}</TableHead>
              <TableHead>{t.finding}</TableHead>
              <TableHead>{t.client}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f, i) => (
              <TableRow key={`${f.path}:${f.line}:${f.rule}:${i}`} className="cursor-default" onClick={() => setOpen(f)}>
                <TableCell>
                  <Level level={f.level} />
                </TableCell>
                <TableCell className="py-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{coreText(f.title)}</span>
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
                <TableCell className="truncate text-muted-foreground">{nameOf(f.client)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {open && <Detail f={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 一处发现的详情。**没有删除按钮** —— 删不删由用户自己去改文件 */
function Detail({ f, onClose }: { f: ScanFinding; onClose: () => void }) {
  const t = useText(mcpText);
  const common = useText(commonText);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Level level={f.level} />
            {coreText(f.title)}
          </DialogTitle>
          <DialogDescription>{coreText(f.detail)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 tw-body">
          <code className="font-mono tw-label break-all">
            {f.path}:{f.line}
          </code>
          {/* 不可见字符已经换成可见记号，否则这一行看起来和正常行一样，
              用户会以为是误报 */}
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono tw-label">{f.excerpt}</pre>
          <p className="tw-label text-muted-foreground">{t.reportOnly}</p>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{common.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
