import { useState, type ReactNode } from "react";
import { SearchIcon, ServerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Tile as IconTile } from "@/ui/tile";
import { shortUrl } from "./labels";
import { VendorTile } from "./parts";
import { CUSTOM, PRESETS, type Preset } from "./presets";
import { serviceSectionText } from "./ServiceSection.i18n";

/**
 * 新建上游的第一步：「服务类型」。一格一种，点一下就选定并进到「连接」。
 *
 * 分两组：**账号登录**（ChatGPT、Z.ai —— 不是预设，选中就改走登录，这张表单让位）
 * 和 **API 接入**（各家预设，「自定义」收尾，接中转站的人选它）。顶上一个搜索框按名称
 * 和说明过滤，列表长了也找得到。退回这一步时当前那一格标着选中。
 */
export function ServiceSection({
  value,
  onPick,
  onChatgptLogin,
  onZaiLogin,
}: {
  /** 当前的预设 id（`custom` 是自定义）；还没选过是 null，哪一格都不标 */
  value: string | null;
  onPick: (id: string) => void;
  onChatgptLogin: () => void;
  onZaiLogin: () => void;
}) {
  const t = useText(serviceSectionText);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hit = (...words: string[]) => q === "" || words.some((w) => w.toLowerCase().includes(q));

  const accounts: Entry[] = [
    {
      key: "chatgpt",
      tile: <VendorTile name="chatgpt" baseUrl="https://chatgpt.com" />,
      label: t.chatgpt,
      desc: t.signIn,
      on: false,
      pick: onChatgptLogin,
    },
    {
      key: "zai",
      tile: <VendorTile name="zai" baseUrl="https://api.z.ai" />,
      label: t.zai,
      desc: t.signIn,
      on: false,
      pick: onZaiLogin,
    },
  ].filter((e) => hit(e.label, e.key));
  const api: Entry[] = [...PRESETS, CUSTOM]
    .map((p) => ({
      key: p.id,
      tile: <PresetTile preset={p} />,
      label: p.label,
      desc: p.id === CUSTOM.id ? t.customDesc : p.billing === "free" ? t.local : shortUrl(p.baseUrl),
      on: p.id === value,
      pick: () => onPick(p.id),
    }))
    .filter((e) => hit(e.label, e.key, e.desc));

  return (
    <div className="flex flex-col gap-5">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          autoFocus
          placeholder={t.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </InputGroup>
      {accounts.length > 0 && <Group title={t.accounts} entries={accounts} />}
      {api.length > 0 && <Group title={t.api} entries={api} />}
      {accounts.length === 0 && api.length === 0 && (
        <p className="py-8 text-center tw-body text-muted-foreground">{t.none}</p>
      )}
    </div>
  );
}

interface Entry {
  key: string;
  tile: ReactNode;
  label: string;
  desc: string;
  on: boolean;
  pick: () => void;
}

function Group({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="tw-label font-medium text-muted-foreground">{title}</h3>
      <div role="listbox" aria-label={title} className="grid grid-cols-3 gap-2">
        {entries.map((e) => (
          <button
            key={e.key}
            type="button"
            role="option"
            aria-selected={e.on}
            onClick={e.pick}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-border px-3 py-3 text-left outline-none transition-colors duration-(--motion-fast)",
              "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
              e.on && "border-foreground/40 bg-muted",
            )}
          >
            {e.tile}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate tw-body font-medium">{e.label}</span>
              <span className="truncate tw-label text-muted-foreground">{e.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** 预设的标志。自定义没有厂商，画一个服务器 */
export function PresetTile({ preset }: { preset: Preset }) {
  if (preset.id === CUSTOM.id) {
    return (
      <IconTile>
        <ServerIcon />
      </IconTile>
    );
  }
  return <VendorTile name={preset.name} baseUrl={preset.baseUrl} protocol={preset.protocol || null} />;
}
