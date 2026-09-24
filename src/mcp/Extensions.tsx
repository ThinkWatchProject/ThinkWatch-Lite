import { SparklesIcon, WebhookIcon } from "lucide-react";
import { ClientLogo } from "@/ui/logos";
import { PageSection } from "@/ui/page";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { EmptyState } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { ROW_FOCUS, rowNav, stop } from "@/security/rows";
import type { HookView, ScanFinding, ScanReport, SkillView } from "@/types";
import { mcpText } from "./McpPage.i18n";
import { copyText, Level, rank, worst } from "./parts";

/**
 * 一个钩子命中了哪些发现。
 *
 * 发现按文件和行记，而一个配置文件里有好几个钩子 —— 按命中的那一行里有没有
 * 这条命令来认。那一行是 JSON，命令在里面是转义过的样子，两种写法都比一下。
 */
function hookFindings(h: HookView, findings: ScanFinding[]): ScanFinding[] {
  const escaped = JSON.stringify(h.command).slice(1, -1);
  return findings.filter(
    (f) => f.kind === "hooks" && f.path === h.source && (f.excerpt.includes(escaped) || f.excerpt.includes(h.command)),
  );
}

/** 一个技能命中了哪些发现：技能就是一个 SKILL.md，按文件认 */
function skillFindings(s: SkillView, findings: ScanFinding[]): ScanFinding[] {
  return findings.filter((f) => f.kind === "skill" && f.path === s.path);
}

/** 最要紧的那一处 */
const first = (fs: ScanFinding[]) => [...fs].sort((a, b) => rank(a.level) - rank(b.level))[0];

function ClientCell({ id, name }: { id: string; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
      <ClientLogo id={id} name={name} className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * 钩子和技能。**两张表，都只列出** —— 钩子不需要模型参与就能拿到执行权，
 * 是危险度最高的一类；技能没有跨客户端的通行格式，不提供复制。
 *
 * 命中扫描规则的那一行标出级别，点它看那一处发现。
 */
export function Extensions({
  data,
  nameOf,
  onFinding,
}: {
  data: ScanReport;
  nameOf: (client: string) => string;
  /** 打开一处发现的详情 */
  onFinding: (f: ScanFinding) => void;
}) {
  const t = useText(mcpText);

  const hookMenu = (h: HookView, found: ScanFinding | undefined): MenuItems => [
    ...(found ? [{ kind: "item" as const, label: t.viewFinding, onSelect: () => onFinding(found) }, { kind: "sep" as const }] : []),
    { kind: "item", label: t.copyCommand, onSelect: () => copyText(h.command) },
    { kind: "item", label: t.copyPath, onSelect: () => copyText(h.source) },
  ];
  const skillMenu = (s: SkillView, found: ScanFinding | undefined): MenuItems => [
    ...(found ? [{ kind: "item" as const, label: t.viewFinding, onSelect: () => onFinding(found) }, { kind: "sep" as const }] : []),
    { kind: "item", label: t.copyPath, onSelect: () => copyText(s.path) },
  ];

  return (
    <div>
      <PageSection
        title={
          <>
            {t.hooks} <span className="ml-1 tw-label tw-num text-muted-foreground">{data.hooks.length}</span>
          </>
        }
        description={t.hooksNote}
      >
        {data.hooks.length === 0 ? (
          <EmptyState variant="outlined" icon={<WebhookIcon />} title={t.noHooks} className="py-8" />
        ) : (
          <Table className="table-fixed min-w-[560px]">
            <colgroup>
              <col className="w-[148px]" />
              <col className="w-[128px]" />
              <col />
              <col className="w-[76px]" />
              <col className="w-9" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t.client}</TableHead>
                <TableHead>{t.event}</TableHead>
                <TableHead>{t.command}</TableHead>
                <TableHead>{t.level}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.hooks.map((h, i) => {
                const fs = hookFindings(h, data.findings);
                const level = worst(fs);
                const found = first(fs);
                const items = hookMenu(h, found);
                const open = found ? () => onFinding(found) : undefined;
                return (
                  <RowMenu key={`${h.source}:${h.event}:${i}`} items={items}>
                    <TableRow className={cn("cursor-default", ROW_FOCUS)} onClick={open} {...rowNav(open)}>
                      <TableCell>
                        <ClientCell id={h.client} name={nameOf(h.client)} />
                      </TableCell>
                      <TableCell className="truncate font-mono tw-label">{h.event}</TableCell>
                      <TableCell className="truncate font-mono tw-label" title={h.command}>
                        {h.command}
                      </TableCell>
                      <TableCell>{level && <Level level={level} />}</TableCell>
                      <TableCell className="text-right" {...stop}>
                        <RowMenuButton items={items} label={t.actionsFor(h.event)} />
                      </TableCell>
                    </TableRow>
                  </RowMenu>
                );
              })}
            </TableBody>
          </Table>
        )}
      </PageSection>

      <PageSection
        title={
          <>
            {t.skills} <span className="ml-1 tw-label tw-num text-muted-foreground">{data.skills.length}</span>
          </>
        }
        description={t.skillsNote}
      >
        {data.skills.length === 0 ? (
          <EmptyState variant="outlined" icon={<SparklesIcon />} title={t.noSkills} className="py-8" />
        ) : (
          <Table className="table-fixed min-w-[560px]">
            <colgroup>
              <col className="w-[200px]" />
              <col className="w-[148px]" />
              <col />
              <col className="w-[76px]" />
              <col className="w-9" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t.name}</TableHead>
                <TableHead>{t.client}</TableHead>
                <TableHead>{t.allowedTools}</TableHead>
                <TableHead>{t.level}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.skills.map((s) => {
                const fs = skillFindings(s, data.findings);
                const level = worst(fs);
                const found = first(fs);
                const items = skillMenu(s, found);
                const open = found ? () => onFinding(found) : undefined;
                return (
                  <RowMenu key={s.path} items={items}>
                    <TableRow className={cn("cursor-default", ROW_FOCUS)} onClick={open} {...rowNav(open)}>
                      <TableCell className="truncate font-medium" title={s.path}>
                        {s.name}
                      </TableCell>
                      <TableCell>
                        <ClientCell id={s.client} name={nameOf(s.client)} />
                      </TableCell>
                      <TableCell className="truncate font-mono tw-label text-muted-foreground">
                        {s.allowed_tools.length > 0 ? s.allowed_tools.join(t.listSep) : "—"}
                      </TableCell>
                      <TableCell>{level && <Level level={level} />}</TableCell>
                      <TableCell className="text-right" {...stop}>
                        <RowMenuButton items={items} label={t.actionsFor(s.name)} />
                      </TableCell>
                    </TableRow>
                  </RowMenu>
                );
              })}
            </TableBody>
          </Table>
        )}
      </PageSection>
    </div>
  );
}
