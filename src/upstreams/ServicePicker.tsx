import type { ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, ServerIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useText } from "@/i18n";
import { VendorTile } from "./parts";
import { CHATGPT, CUSTOM, PRESETS, ZAI, presetById, type Preset } from "./presets";
import { servicePickerText } from "./ServicePicker.i18n";

/**
 * 新建上游时的「服务类型」：一个带标志的下拉。
 *
 * 原生下拉画不了图标，而这一栏恰恰是认标志比认字快的地方。**仍然是下拉**（选一个
 * 值），不是一排卡片：选中之后表单照常往下填，这一栏只占一个字段的位置。
 *
 * 两个账号类（ChatGPT、Z.ai）不是预设：选中就改走登录，这张表单让位（调用方处理），
 * 所以它们放在分隔线下面，标着「登录」。
 */
export function ServicePicker({
  id,
  value,
  onPick,
}: {
  id?: string;
  /** 当前的预设 id；`custom` 是自定义 */
  value: string;
  onPick: (id: string) => void;
}) {
  const t = useText(servicePickerText);
  const current = presetById(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className="w-full justify-start gap-2 border-input bg-transparent px-2 font-normal hover:bg-transparent aria-expanded:bg-transparent dark:bg-input/30 dark:hover:bg-input/30"
        >
          <PresetTile preset={current} />
          <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-64">
        <DropdownMenuGroup>
          {[CUSTOM, ...PRESETS].map((p) => (
            <Option key={p.id} tile={<PresetTile preset={p} />} label={p.label} on={p.id === current.id} onSelect={() => onPick(p.id)} />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <Option
            tile={<VendorTile name="chatgpt" baseUrl="https://chatgpt.com" size="sm" />}
            label={t.chatgpt}
            note={t.signIn}
            onSelect={() => onPick(CHATGPT)}
          />
          <Option
            tile={<VendorTile name="zai" baseUrl="https://api.z.ai" size="sm" />}
            label={t.zai}
            note={t.signIn}
            onSelect={() => onPick(ZAI)}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Option({
  tile,
  label,
  note,
  on = false,
  onSelect,
}: {
  tile: ReactNode;
  label: string;
  note?: string;
  on?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-2 py-1.5">
      {tile}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note && <span className="tw-label text-muted-foreground">{note}</span>}
      <CheckIcon className={cn("size-3.5", !on && "invisible")} />
    </DropdownMenuItem>
  );
}

/** 预设的标志。自定义没有厂商，画一个服务器 */
function PresetTile({ preset }: { preset: Preset }) {
  if (preset.id === CUSTOM.id) {
    return (
      <span
        aria-hidden
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground shadow-[0_1px_0_0_var(--border)] [&_svg]:size-3"
      >
        <ServerIcon />
      </span>
    );
  }
  return <VendorTile name={preset.name} baseUrl={preset.baseUrl} protocol={preset.protocol || null} size="sm" />;
}
