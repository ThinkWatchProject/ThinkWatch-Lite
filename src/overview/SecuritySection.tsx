import { cn } from "@/lib/utils";
import { PageSection } from "@/ui/page";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { presetRange, type Range } from "@/ui/range";
import { useNav } from "@/nav";
import type { Dashboard, Guard, Overview } from "@/types";
import { useText } from "@/i18n";
import { LinkRow, Scope } from "./parts";
import { overviewText } from "./overview.i18n";

/**
 * 安全：各项防护现在各在哪一档，以及这段时间各自看见了什么。
 *
 * **档位和所见要一起说。**只说所见的话，「未发现」在关闭档下是句空话；只说档位
 * 的话，不知道它到底拦下过什么。
 *
 * **没有发现时也在，而且说「未发现」。**这一页别处的纪律是「条件不满足就不
 * 出现」—— 那条对费用面板成立：一排零不构成安心。但安全是反过来的：**看不见的
 * 防护会被当成没开**。
 *
 * **数的是安全日志里的条数**，和从这里点进去看到的是同一批（起点都按
 * `windowStart` 算）。有发现的那一行可以点，落到安全日志的这一段时间。
 */
export function SecuritySection({
  d,
  ov,
  range,
  scoped,
}: {
  d: Dashboard;
  ov: Overview | null;
  range: Range;
  scoped?: string;
}) {
  const t = useText(overviewText);
  const nav = useNav();
  const sec = ov?.security;
  if (!sec) return null;
  const c = d.summary.security;
  const mode = (m: string) => (m === "enforce" ? t.modeEnforce : m === "off" ? t.modeOff : t.modeObserve);
  const guards: {
    key: Guard;
    name: string;
    mode: string;
    hits: number;
    /**
     * 没被处置、照常放行了的那几处。**有它才标琥珀** —— 全换掉了、全切断了，说明防护
     * 在起作用。和安全日志同一套语气（`outcomeTone`）：仅记录的是琥珀，值得看一眼；
     * 红色留给「请求的结局变了」，而概览这一行说的不是某一次请求。
     */
    open: number;
    saw: string;
  }[] = [
    {
      key: "redact",
      name: t.redact,
      mode: sec.redact,
      hits: c.secrets,
      open: c.secrets - c.secrets_replaced,
      saw: c.secrets > 0 ? t.secrets(c.secrets, c.secrets_replaced) : sec.redact === "off" ? t.notChecked : t.noSecrets,
    },
    {
      key: "inspect_tools",
      name: t.inspect,
      mode: sec.inspect_tools,
      hits: c.tool_calls,
      open: c.tool_calls - c.tool_calls_cut,
      saw:
        c.tool_calls > 0
          ? t.toolCalls(c.tool_calls, c.tool_calls_cut)
          : sec.inspect_tools === "off"
            ? t.notChecked
            : t.noToolCalls,
    },
    {
      key: "hidden_text",
      name: t.hiddenText,
      mode: sec.hidden_text,
      hits: c.hidden_text,
      open: c.hidden_text - c.hidden_text_blocked,
      saw:
        c.hidden_text > 0
          ? t.hiddenFound(c.hidden_text, c.hidden_text_blocked)
          : sec.hidden_text === "off"
            ? t.notChecked
            : t.noHidden,
    },
    {
      key: "content",
      name: t.content,
      mode: sec.content,
      hits: c.content,
      open: c.content - c.content_blocked,
      saw:
        c.content > 0 ? t.contentMatched(c.content, c.content_blocked) : sec.content === "off" ? t.notChecked : t.noContent,
    },
    {
      key: "output_limit",
      name: t.outputLimit,
      mode: sec.output_limit,
      hits: c.output_limit,
      open: c.output_limit - c.output_limit_cut,
      saw:
        c.output_limit > 0
          ? t.overLimit(c.output_limit, c.output_limit_cut)
          : sec.output_limit === "off"
            ? t.notChecked
            : t.noOverLimit,
    },
  ];
  // 实时档的计数按 24 小时算（见 `windowStart`），日志也按 24 小时看
  const openLog = () =>
    nav.open("security", { focus: { range: range.live ? presetRange("1d") : range, at: Date.now() } });

  return (
    <PageSection title={t.security} actions={scoped ? <Scope>{scoped}</Scope> : undefined}>
      {guards.map((g) => {
        const tone: StatusTone = g.mode === "off" && g.hits === 0 ? "idle" : g.open > 0 ? "warn" : "ok";
        return (
          <LinkRow key={g.key} className="h-7" hint={g.hits > 0 ? t.showLog : undefined} onOpen={g.hits > 0 ? openLog : undefined}>
            <StatusDot tone={tone} size="md" />
            <span className="w-40 shrink-0 truncate">{g.name}</span>
            {/* 56px：Observe 要 51，44 的话会压到后面那一列上 */}
            <span className="w-14 shrink-0 text-muted-foreground">{mode(g.mode)}</span>
            {/* 颜色只在点上。有发现的那句用正文色 —— 一整句染色读起来像报错 */}
            <span className={cn("min-w-0 flex-1 truncate", g.hits === 0 ? "text-muted-foreground" : "text-foreground")}>
              {g.saw}
            </span>
          </LinkRow>
        );
      })}
    </PageSection>
  );
}
