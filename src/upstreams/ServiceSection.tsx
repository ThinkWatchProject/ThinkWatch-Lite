import type { ReactNode } from "react";
import { ServerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { shortUrl } from "./labels";
import { VendorTile } from "./parts";
import { CUSTOM, PRESETS, type Preset } from "./presets";
import { serviceSectionText } from "./ServiceSection.i18n";

/**
 * 新建上游的第一步：「服务类型」。一格一种，点一下就选定并进到「连接」。
 *
 * **账号登录的两种排最前**（ChatGPT、Z.ai）：它们不是预设，选中就改走登录，这张
 * 表单让位（调用方处理）。预设按常用程度排，「自定义」收尾 —— 接中转站的人选它。
 * 退回这一步时当前那一格标着选中。
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
  return (
    <div role="listbox" aria-label={t.ariaLabel} className="grid grid-cols-3 gap-2">
      <Tile
        tile={<VendorTile name="chatgpt" baseUrl="https://chatgpt.com" />}
        label={t.chatgpt}
        desc={t.signIn}
        onPick={onChatgptLogin}
      />
      <Tile
        tile={<VendorTile name="zai" baseUrl="https://api.z.ai" />}
        label={t.zai}
        desc={t.signIn}
        onPick={onZaiLogin}
      />
      {PRESETS.map((p) => (
        <Tile
          key={p.id}
          tile={<PresetTile preset={p} />}
          label={p.label}
          desc={p.billing === "free" ? t.local : shortUrl(p.baseUrl)}
          on={p.id === value}
          onPick={() => onPick(p.id)}
        />
      ))}
      <Tile
        tile={<PresetTile preset={CUSTOM} />}
        label={CUSTOM.label}
        desc={t.customDesc}
        on={value === CUSTOM.id}
        onPick={() => onPick(CUSTOM.id)}
      />
    </div>
  );
}

function Tile({
  tile,
  label,
  desc,
  on = false,
  onPick,
}: {
  tile: ReactNode;
  label: string;
  desc: string;
  on?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      onClick={onPick}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors duration-(--motion-fast) outline-none",
        "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50",
        on && "border-foreground/40 bg-muted",
      )}
    >
      {tile}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate tw-body font-medium">{label}</span>
        <span className="truncate tw-label text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

/** 预设的标志。自定义没有厂商，画一个服务器 */
export function PresetTile({ preset, size = "md" }: { preset: Preset; size?: "sm" | "md" }) {
  if (preset.id === CUSTOM.id) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center border border-border bg-surface text-muted-foreground shadow-[0_1px_0_0_var(--border)]",
          size === "md" ? "size-7 rounded-lg [&_svg]:size-4" : "size-5 rounded-md [&_svg]:size-3",
        )}
      >
        <ServerIcon />
      </span>
    );
  }
  return <VendorTile name={preset.name} baseUrl={preset.baseUrl} protocol={preset.protocol || null} size={size} />;
}
