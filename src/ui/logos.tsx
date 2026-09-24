import { cn } from "@/lib/utils";
import { GLYPHS, type GlyphId } from "./logo-data";

/**
 * 上游厂商和客户端应用的标志。**单色**：一律 `currentColor`，跟着文字色走，和
 * 界面的黑白灰放在一起；不用各家的品牌色。认不出来的画一个带首字母的小方块。
 *
 * 三个入口：
 *
 *   <Logo id="anthropic" />                          // 已知是哪一个
 *   <UpstreamLogo name={p.name} baseUrl={p.base_url} protocol={p.protocol} />
 *   <ClientLogo id="claude-code" name="Claude Code" />
 *
 * 尺寸默认 16px（表格行、列表项）；页头、空状态用 20–24。标志和旁边的文字之间
 * 留 `gap-2`。颜色：表格里用 `text-muted-foreground`，选中或标题里用前景色。
 */

export type { GlyphId } from "./logo-data";

export function Logo({
  id,
  size = 16,
  className,
  title,
}: {
  id: GlyphId;
  size?: number;
  className?: string;
  /** 读屏用。旁边已经写着名字时不传（默认隐藏） */
  title?: string;
}) {
  const g = GLYPHS[id] as (typeof GLYPHS)[GlyphId] & { viewBox?: string; nonzero?: boolean };
  return (
    <svg
      data-slot="logo"
      viewBox={g.viewBox ?? "0 0 24 24"}
      width={size}
      height={size}
      fill="currentColor"
      fillRule={g.nonzero ? undefined : "evenodd"}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {g.paths.map((p, i) =>
        typeof p === "string" ? <path key={i} d={p} /> : <path key={i} d={p.d} fillOpacity={p.o} />,
      )}
    </svg>
  );
}

/**
 * 认不出来时的方块：名字的第一个字符，圆角细边框。和标志同样大小、同样颜色，
 * 在一列里对得齐。
 */
export function LetterTile({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const ch = Array.from(name.trim().replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?";
  return (
    <span
      data-slot="logo"
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[4px] border border-current/35 font-semibold leading-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.58)) }}
    >
      {ch}
    </span>
  );
}

/** 地址（主机名）上的特征 → 厂商。先比地址，地址认不出再比名字 */
const HOSTS: [RegExp, GlyphId][] = [
  [/(^|\.)anthropic\.com$/, "anthropic"],
  [/(^|\.)(openai\.azure\.com|azure\.com|azure-api\.net|cognitiveservices\.azure\.com)$/, "azure"],
  [/(^|\.)(openai\.com|chatgpt\.com)$/, "openai"],
  [/(^|\.)openrouter\.ai$/, "openrouter"],
  [/(^|\.)deepseek\.com$/, "deepseek"],
  [/(^|\.)(generativelanguage|aiplatform)\.googleapis\.com$/, "gemini"],
  [/(^|\.)z\.ai$/, "zai"],
  [/(^|\.)bigmodel\.cn$/, "zhipu"],
  [/(^|\.)kimi\.(com|ai)$/, "kimi"],
  [/(^|\.)moonshot\.(cn|ai)$/, "moonshot"],
  [/(^|\.)(dashscope(-intl)?\.aliyuncs\.com|qwen\.ai)$/, "qwen"],
  [/(^|\.)x\.ai$/, "xai"],
  [/(^|\.)mistral\.ai$/, "mistral"],
  [/(^|\.)groq\.com$/, "groq"],
  [/(^|\.)bedrock(-runtime)?\.[a-z0-9-]+\.amazonaws\.com$/, "bedrock"],
];

/** 名字里的特征 → 厂商。只在地址认不出（中转、自建）时用 */
const NAMES: [RegExp, GlyphId][] = [
  [/anthropic|claude/, "anthropic"],
  [/azure/, "azure"],
  [/openai|chatgpt|gpt/, "openai"],
  [/openrouter/, "openrouter"],
  [/deepseek/, "deepseek"],
  [/gemini|google|vertex/, "gemini"],
  [/ollama/, "ollama"],
  [/^z-?ai|zai\b/, "zai"],
  [/zhipu|bigmodel|glm/, "zhipu"],
  [/kimi/, "kimi"],
  [/moonshot/, "moonshot"],
  [/qwen|dashscope|tongyi|bailian/, "qwen"],
  [/xai|grok/, "xai"],
  [/mistral/, "mistral"],
  [/groq/, "groq"],
  [/bedrock|aws/, "bedrock"],
];

function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * 上游是哪家。**按地址认，不按名字**：名字是用户起的（`relay-hk`），地址才说
 * 请求实际发去哪。地址是中转站或本机时才看名字（`ollama` 在 127.0.0.1:11434）。
 * 认不出来返回 `null`。
 */
export function upstreamGlyph(u: {
  name?: string | null;
  baseUrl?: string | null;
  protocol?: string | null;
}): GlyphId | null {
  const host = hostOf(u.baseUrl);
  for (const [re, id] of HOSTS) if (re.test(host)) return id;
  if (u.protocol === "bedrock") return "bedrock";
  if (/:11434(\/|$)/.test(u.baseUrl ?? "")) return "ollama";
  const name = (u.name ?? "").toLowerCase();
  for (const [re, id] of NAMES) if (re.test(name)) return id;
  return null;
}

/** 上游的标志；认不出来画首字母方块 */
export function UpstreamLogo({
  name,
  baseUrl,
  protocol,
  size = 16,
  className,
}: {
  name: string;
  baseUrl?: string | null;
  protocol?: string | null;
  size?: number;
  className?: string;
}) {
  const id = upstreamGlyph({ name, baseUrl, protocol });
  return id ? <Logo id={id} size={size} className={className} /> : <LetterTile name={name} size={size} className={className} />;
}

/** 客户端 id（`tw-adopt` 里的那份，也认显示名和请求头推测出的应用名）→ 标志 */
const CLIENTS: Record<string, GlyphId> = {
  claudecode: "claudecode",
  claude: "claudecode",
  claudedesktop: "claude",
  codex: "codex",
  codexcli: "codex",
  chatgpt: "openai",
  opencode: "opencode",
  cursor: "cursor",
  geminicli: "geminicli",
  gemini: "geminicli",
  cline: "cline",
  zed: "zed",
  zededitor: "zed",
  windsurf: "windsurf",
};

/** 客户端是哪个。`claude-code`、`Claude Code`、`claude_code` 都认。认不出来返回 `null` */
export function clientGlyph(idOrName: string | null | undefined): GlyphId | null {
  const k = (idOrName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return CLIENTS[k] ?? null;
}

/** 客户端的标志；认不出来画首字母方块（用 `name`，没有就用 `id`） */
export function ClientLogo({
  id,
  name,
  size = 16,
  className,
}: {
  id: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const g = clientGlyph(id) ?? clientGlyph(name);
  return g ? <Logo id={g} size={size} className={className} /> : <LetterTile name={name ?? id} size={size} className={className} />;
}
