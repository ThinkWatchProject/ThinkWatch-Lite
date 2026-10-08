import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { coreText } from "@/i18n/core.i18n";
import { cn } from "@/lib/utils";
import { isMac } from "@/platform";
import { Switcher } from "@/connection/Switcher";
import { Keys, comboText, pageCombo } from "@/palette/keys";
import type { Surface } from "@/nav";
import type { Msg } from "@/types";
import {
  IconClient,
  IconDashboard,
  IconFlow,
  IconGuard,
  IconKey,
  IconMcp,
  IconPlugin,
  IconRoute,
  IconServer,
  IconSettings,
} from "@/ui/icons";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/ui/sidebar";
import type { CoreLine } from "./describe";

/**
 * 主窗口的几个面。
 *
 * **源列表，不是标签栏。**原生客户端用左侧源列表：它能分组、能挂角标，加一项
 * 不会把别的挤窄。分组的判据是打开频率：上面那组每天看，越往下越是配一次就不动的。
 * 顺序和 `SURFACES` 一致，⌘1…⌘9 按它数（设置是 ⌘,，见 `palette/keys.tsx` 的 `DIGIT_PAGES`）。
 */
const SOURCES: { group: string; items: { id: Surface; icon: LucideIcon }[] }[] = [
  {
    // 概览回答「现在什么情况」，是打开这个应用的默认意图；流量回答「刚才那一条
    // 发生了什么」。会话不是第三项，是流量的第二种粒度（归组）
    group: "monitor",
    items: [
      { id: "dashboard", icon: IconDashboard },
      { id: "requests", icon: IconFlow },
    ],
  },
  {
    // 谁在用这个网关、拿什么连进来：客户端和密钥是同一件事的两面，挨着放
    group: "access",
    items: [
      { id: "clients", icon: IconClient },
      { id: "keys", icon: IconKey },
    ],
  },
  {
    // 网关的配置。安全、MCP 和插件也在这一组：它们是要去动的开关和规则，不是看板
    group: "config",
    items: [
      { id: "upstreams", icon: IconServer },
      { id: "routing", icon: IconRoute },
      { id: "security", icon: IconGuard },
      { id: "mcp", icon: IconMcp },
      { id: "plugins", icon: IconPlugin },
    ],
  },
  {
    // 应用自己的设置，不是网关的配置
    group: "app",
    items: [{ id: "settings", icon: IconSettings }],
  },
];

/**
 * 标成拖拽区，**只在 macOS 上**。那里窗口用的是 Overlay 标题栏（红绿灯浮在内容上），
 * 没有一条真的标题栏可以抓。Windows 和 Linux 用系统标题栏，再把内容标成拖拽区的话，
 * 点一下侧栏空白就会把窗口拖走。
 */
export const drag = isMac ? { "data-tauri-drag-region": true } : {};

/**
 * 源列表。**在 macOS 上整条都是拖拽区**，是半透的系统材质（`data-vibrant`，
 * 见 index.css）；别的平台是实色。可以收起：收起之后只剩图标，名字进悬浮说明。
 */
export const SourceList = memo(function SourceList({
  tab,
  onOpen,
  linked,
  findings,
  core,
  addr,
  listenError,
}: {
  tab: Surface;
  onOpen: (s: Surface) => void;
  linked: boolean;
  /** MCP 页上没看过的新发现几条 */
  findings: number;
  core: CoreLine;
  /** 网关地址 */
  addr: string | null;
  /** 监听设置没换成的原因（`CoreStatus.listen_error`） */
  listenError: Msg | null;
}) {
  const t = useText(appText);
  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border"
      style={{ color: "var(--chrome-text)" }}
      {...drag}
    >
      {/* 红绿灯占掉左上角，内容从它下面开始。Windows、Linux 上是系统标题栏，没有这一块 */}
      {isMac && <SidebarHeader className="h-[38px] p-0" {...drag} />}

      <SidebarContent className={cn("gap-0", !isMac && "pt-2")}>
        {SOURCES.map((g, gi) => (
          <SidebarGroup key={g.group} className="px-2.5 py-0">
            {/* 没有分组标题，只有细分隔线：四个标题会吃掉列表约三分之一的高度 */}
            {gi > 0 && <SidebarSeparator className="mx-1.5 my-2.5 opacity-70" />}
            <SidebarGroupContent>
              <SidebarMenu className="gap-px">
                {g.items.map((it) => {
                  const on = tab === it.id;
                  /** 这一页的快捷键：⌘1…⌘9 按在源列表里的位置数，设置是 ⌘, */
                  const combo = pageCombo(it.id);
                  // 客户端配置里出现了新东西：挂个角标，直到去看过
                  const badge = it.id === "mcp" ? findings : 0;
                  const Icon = it.icon;
                  const label = t.surfaces[it.id];
                  // 没连上时需要 core 数据的几页置灰；设置始终可用，连接管理在那里
                  const off = !linked && it.id !== "settings";
                  return (
                    <SidebarMenuItem key={it.id}>
                      <SidebarMenuButton
                        disabled={off}
                        isActive={on}
                        onClick={() => onOpen(it.id)}
                        aria-current={on ? "page" : undefined}
                        /*
                          悬浮说明**只在收起时出来**（shadcn 的默认）：那时只剩图标，名字和快捷键
                          都靠它。展开时名字就在图标旁边，再弹一个写着同一个名字的气泡是重复，
                          快捷键改写在这一行的末尾
                        */
                        tooltip={{
                          children: (
                            <>
                              {badge > 0 ? t.newFindings(label, badge) : label}
                              {combo && <Keys combo={combo} />}
                            </>
                          ),
                        }}
                        className={cn(
                          "h-7 gap-2.5 px-2 text-(--chrome-text) transition-colors duration-(--motion-fast)",
                          "hover:bg-(--chrome-hover) hover:text-(--chrome-strong) active:bg-(--chrome-selected)",
                          "data-active:bg-(--chrome-selected) data-active:text-(--chrome-strong) data-active:font-medium",
                          "[&>svg]:opacity-65 data-active:[&>svg]:opacity-100 hover:[&>svg]:opacity-100",
                          off && "opacity-45",
                        )}
                      >
                        <Icon size={16} />
                        <span className="truncate">{label}</span>
                        {/*
                          行尾：快捷键和新发现的个数，收起时整段藏掉。**快捷键悬停、键盘聚焦时
                          才出来**，和悬停底色一起淡入：常显的话右边多出一列 ⌘1…⌘9，读起来像
                          计数。写成字不用键帽：这一行悬停时已经有底色，键帽是框中框。
                          个数排在快捷键后面、同在一行里，两位数也不会压上去。快捷键不进按钮
                          的名字（`aria-hidden`）：读屏从悬浮说明拿，说明收着也还是按钮的描述。
                        */}
                        <span className="ms-auto flex shrink-0 items-center gap-2 group-data-[collapsible=icon]:hidden">
                          {combo && (
                            <span
                              aria-hidden
                              className="tw-label text-(--chrome-dim) tw-num opacity-0 transition-opacity duration-(--motion-fast) group-hover/menu-button:opacity-100 group-focus-visible/menu-button:opacity-100"
                            >
                              {comboText(combo)}
                            </span>
                          )}
                          {badge > 0 && (
                            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 tw-label font-medium text-white tw-num">
                              {badge}
                            </span>
                          )}
                        </span>
                      </SidebarMenuButton>
                      {/* 收起时数字塞不下，只留一个点：它回答的是「那边有没有新东西」 */}
                      {badge > 0 && (
                        <span className="pointer-events-none absolute top-[7px] right-[7px] hidden size-[7px] rounded-full bg-destructive ring-2 ring-(--chrome-ground) group-data-[collapsible=icon]:block" />
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/*
        状态钉在源列表底部。**它要一直看得见** —— core 挂了是这个应用唯一「什么都
        不工作」的状态。连接名在状态点和网关地址上面，点开是连接列表（`Switcher`）
      */}
      <SidebarFooter className="border-t px-3.5 py-2.5" style={{ borderColor: "var(--chrome-hair)" }}>
        <Switcher
          local={{
            text: core.text,
            short: core.short,
            tone: core.tone,
            addr,
            tip: (
              <>
                {addr ? `${core.text} · ${addr}` : core.text}
                {/* 监听设置没换成：上面的地址是还在服务的旧地址，原因写在这里 */}
                {listenError && <div>{t.listenStale(coreText(listenError))}</div>}
              </>
            ),
          }}
        />
      </SidebarFooter>
    </Sidebar>
  );
});
