import { useState } from "react";
import { SearchIcon, ServerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Tile as IconTile } from "@/ui/tile";
import { VendorTile } from "./parts";
import { CUSTOM, PRESETS, presetAliases, type Preset, type PresetGroup } from "./presets";
import { serviceSectionText } from "./ServiceSection.i18n";

const GROUPS: PresetGroup[] = ["vendor", "platform", "local"];

/**
 * 新建上游的第一步：「服务类型」。一格一种，点一下就选定并进到下一步。
 *
 * 分三组：**模型厂商**、**平台与中转**、**本机与自定义**（「自定义」收尾，别的格子都不是
 * 的服务选它）。账号登录不另起一组：它是这家服务的一种认证方式，在下一步选（OpenAI 的
 * ChatGPT 账号、Z.ai / BigModel 的账号）。顶上一个搜索框按名称、说明和常用的叫法过滤
 * （「ChatGPT」找得到 OpenAI）。退回这一步时当前那一格标着选中。
 */
export function ServiceSection({
  value,
  onPick,
}: {
  /** 当前的预设 id；还没选过是 null，哪一格都不标 */
  value: string | null;
  onPick: (id: string) => void;
}) {
  const t = useText(serviceSectionText);
  const [query, setQuery] = useState("");
  const shown = PRESETS.filter((p) => matches(p, query));

  return (
    <div className="flex flex-col gap-5">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          autoFocus
          placeholder={t.search}
          aria-label={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </InputGroup>
      {GROUPS.map((g) => {
        const entries = shown.filter((p) => p.group === g);
        return entries.length > 0 && <Group key={g} title={t.groups[g]} entries={entries} value={value} onPick={onPick} />;
      })}
      {shown.length === 0 && <p className="py-8 text-center tw-body text-muted-foreground">{t.none}</p>}
    </div>
  );
}

/** 搜索：名称、说明、id 和常用的叫法里有没有这几个字（不分大小写） */
export function matches(p: Preset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return [p.label, p.desc, p.id, ...p.keywords, ...presetAliases(p.id)].some((w) => w.toLowerCase().includes(q));
}

function Group({
  title,
  entries,
  value,
  onPick,
}: {
  title: string;
  entries: Preset[];
  value: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="tw-label font-medium text-muted-foreground">{title}</h3>
      <div role="listbox" aria-label={title} className="grid grid-cols-3 gap-2">
        {entries.map((p) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={p.id === value}
            onClick={() => onPick(p.id)}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left outline-none transition-colors duration-(--motion-fast)",
              "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
              p.id === value && "border-foreground/40 bg-muted",
            )}
          >
            <PresetTile preset={p} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate tw-body font-medium">{p.label}</span>
              <span className="truncate tw-label text-muted-foreground">{p.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * 预设的标志。ThinkWatch 企业网关画应用自己的标志；Sub2API、New API 没有能用的标志，
 * 写首字母；自定义没有厂商，画一个服务器
 */
export function PresetTile({ preset, size = "md" }: { preset: Preset; size?: "md" | "lg" }) {
  if (preset.id === CUSTOM.id) {
    return (
      <IconTile className={size === "lg" ? "size-11 rounded-xl [&_svg:not([class*='size-'])]:size-5" : undefined}>
        <ServerIcon />
      </IconTile>
    );
  }
  return (
    <VendorTile
      // 没有标志的写首字母：Sub2API 是 S，New API 是 N
      name={preset.name || preset.label}
      baseUrl={preset.baseUrl}
      protocol={preset.protocol || null}
      own={preset.id === "thinkwatch"}
      size={size}
    />
  );
}
