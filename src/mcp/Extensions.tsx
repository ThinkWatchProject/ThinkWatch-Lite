import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { useText } from "@/i18n";
import type { HookView, ScanFinding, ScanResponse, SkillView } from "@/types";
import { Level } from "./Findings";
import { mcpText } from "./McpPage.i18n";

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** 几处发现里最高的那一级。一处都没有就是 `null` */
function worst(findings: ScanFinding[]): ScanFinding["level"] | null {
  let out: ScanFinding["level"] | null = null;
  for (const f of findings) if (out == null || (RANK[f.level] ?? 3) < (RANK[out] ?? 3)) out = f.level;
  return out;
}

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

/**
 * 钩子和技能。**两张表，都只列出** —— 钩子不需要模型参与就能拿到执行权，
 * 是危险度最高的一类；技能没有跨客户端的通行格式，不提供复制。
 *
 * 命中扫描规则的那一行标出级别，详情在「发现」里。
 */
export function Extensions({ data, nameOf }: { data: ScanResponse; nameOf: (client: string) => string }) {
  const t = useText(mcpText);
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <h3 className="tw-head">
          {t.hooks} <span className="tw-label tabular-nums text-muted-foreground">{data.hooks.length}</span>
        </h3>
        <p className="tw-label text-muted-foreground">{t.hooksNote}</p>
        {data.hooks.length === 0 ? (
          <p className="tw-body text-muted-foreground">{t.noHooks}</p>
        ) : (
          <Table className="table-fixed min-w-[560px]">
            <colgroup>
              <col className="w-[128px]" />
              <col className="w-[128px]" />
              <col />
              <col className="w-14" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t.client}</TableHead>
                <TableHead>{t.event}</TableHead>
                <TableHead>{t.command}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.hooks.map((h, i) => {
                const level = worst(hookFindings(h, data.findings));
                return (
                  <TableRow key={`${h.source}:${h.event}:${i}`}>
                    <TableCell className="truncate text-muted-foreground">{nameOf(h.client)}</TableCell>
                    <TableCell className="truncate font-mono tw-label">{h.event}</TableCell>
                    <TableCell className="truncate font-mono tw-label" title={h.command}>
                      {h.command}
                    </TableCell>
                    <TableCell className="text-right">{level && <Level level={level} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="tw-head">
          {t.skills} <span className="tw-label tabular-nums text-muted-foreground">{data.skills.length}</span>
        </h3>
        <p className="tw-label text-muted-foreground">{t.skillsNote}</p>
        {data.skills.length === 0 ? (
          <p className="tw-body text-muted-foreground">{t.noSkills}</p>
        ) : (
          <Table className="table-fixed min-w-[560px]">
            <colgroup>
              <col className="w-[200px]" />
              <col className="w-[128px]" />
              <col />
              <col className="w-14" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t.name}</TableHead>
                <TableHead>{t.client}</TableHead>
                <TableHead>{t.allowedTools}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.skills.map((s) => {
                const level = worst(skillFindings(s, data.findings));
                return (
                  <TableRow key={s.path}>
                    <TableCell className="truncate font-medium" title={s.path}>
                      {s.name}
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">{nameOf(s.client)}</TableCell>
                    <TableCell className="truncate font-mono tw-label">
                      {s.allowed_tools.length > 0 ? s.allowed_tools.join(t.listSep) : "—"}
                    </TableCell>
                    <TableCell className="text-right">{level && <Level level={level} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
