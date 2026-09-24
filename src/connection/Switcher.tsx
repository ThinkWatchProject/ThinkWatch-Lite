import type { ReactNode } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { IconLocal, IconRemote } from "@/ui/icons";
import { Tip } from "@/ui/tip";
import { StatusDot } from "@/ui/status-dot";
import { textOf, useText } from "@/i18n";
import { clientGateway, currentProfile, type ConnView, type Profile } from "./api";
import { connText } from "./connection.i18n";
import { useConnections } from "./ConnectionProvider";
import { profileName } from "./describe";

export type Tone = "ok" | "warn" | "bad";

/** 远程连接此刻怎么说：已连接 / 正在连接 / 未连接 */
export function remoteStatus(v: ConnView): { text: string; tone: Tone; addr: string | null } {
  const t = textOf(connText);
  const p = currentProfile(v);
  switch (v.link.kind) {
    case "connected":
      // 连上之后写服务器的网关地址：客户端要连的是它
      return {
        text: t.connected,
        tone: "ok",
        addr: clientGateway(p?.host ?? "", v.link.info.gateway_addr) ?? p?.addr ?? null,
      };
    case "connecting":
      return { text: t.connecting, tone: "warn", addr: p?.addr ?? null };
    default:
      return { text: t.unlinked, tone: "bad", addr: p?.addr ?? null };
  }
}

/**
 * 侧栏底部：当前连接、它的状态、网关地址（设计稿 ①）。
 *
 * **在原来的状态点和网关地址上方加一行连接名**，点开是连接列表。选中另一条不会立即
 * 切换：本机直接切，远程先试连、再确认（④）。侧栏收起成 80px 时只剩图标和状态点。
 *
 * 连本机时状态和地址照旧来自守护（`local`）；连远程时来自连接那一层。
 */
export function Switcher({
  local,
}: {
  /** 本机 core 的状态：几个字、收起时的短写、颜色、地址、悬停说明 */
  local: { text: string; short: string; tone: Tone; addr: string | null; tip: ReactNode };
}) {
  const t = useText(connText);
  const { view, add, manage, switchTo } = useConnections();
  const p = view ? currentProfile(view) : undefined;
  const remote = p && !p.local && view ? remoteStatus(view) : null;
  const status = remote
    ? { text: remote.text, short: remote.text, tone: remote.tone, addr: remote.addr, tip: remote.text }
    : local;
  const name = p ? profileName(p) : t.local;
  const Icon = p && !p.local ? IconRemote : IconLocal;
  // 列表还没读到：什么都不画。先按本机画的话，连着远程时会闪一下「本机 · 已停止」
  if (!view) return null;

  return (
    <div className="flex flex-col gap-0.5">
      {view && (
        <DropdownMenu modal={false}>
          <Tip side="right" text={t.switcherTip}>
            <DropdownMenuTrigger
              className={cn(
                "-mx-1 flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1 text-left tw-body font-medium outline-none",
                "hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-sidebar-accent",
                "group-data-[collapsible=icon]:justify-center",
              )}
              style={{ color: "var(--chrome-text)" }}
            >
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate group-data-[collapsible=icon]:hidden">{name}</span>
              <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50 group-data-[collapsible=icon]:hidden" />
            </DropdownMenuTrigger>
          </Tip>
          <DropdownMenuContent side="top" align="start" className="w-64">
            <p className="px-1.5 pt-1 pb-0.5 tw-label font-medium text-muted-foreground">{t.menuTitle}</p>
            {view.profiles.map((it) => (
              <Choice
                key={it.id}
                p={it}
                current={it.id === view.current}
                sub={
                  it.local
                    ? it.id === view.current
                      ? `${t.localCore} · ${local.text}`
                      : t.localStopped
                    : (it.addr ?? "")
                }
                onSelect={() => switchTo(it.id)}
              />
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={add}>{t.addRemote}</DropdownMenuItem>
            <DropdownMenuItem onSelect={manage}>
              {t.manage}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Tip side="right" text={status.tip}>
        <div
          className={cn(
            "flex items-center gap-1.5 tw-label",
            status.tone === "ok" ? "text-success" : status.tone === "warn" ? "text-warning" : "text-destructive",
          )}
        >
          <StatusDot
            tone={status.tone === "ok" ? "ok" : status.tone === "warn" ? "warn" : "error"}
            pulse={status.tone === "warn"}
          />
          {/* 展开时写全，收起时 80px 也放得下的短写 */}
          <span className="group-data-[collapsible=icon]:hidden">{status.text}</span>
          <span className="hidden group-data-[collapsible=icon]:inline">{status.short}</span>
        </div>
      </Tip>
      {status.addr && (
        <code
          className="block truncate font-mono tw-label group-data-[collapsible=icon]:hidden"
          style={{ color: "var(--chrome-dim)" }}
        >
          {status.addr}
        </code>
      )}
    </div>
  );
}

function Choice({
  p,
  current,
  sub,
  onSelect,
}: {
  p: Profile;
  current: boolean;
  sub: string;
  onSelect: () => void;
}) {
  const Icon = p.local ? IconLocal : IconRemote;
  return (
    <DropdownMenuItem onSelect={onSelect} className="items-start py-1.5" aria-checked={current} role="menuitemradio">
      <span className="flex w-4 shrink-0 justify-center pt-0.5">{current && <CheckIcon className="size-3.5" />}</span>
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5 opacity-70" />
          <span className="truncate">{profileName(p)}</span>
        </span>
        <span className="truncate tw-label text-muted-foreground">{sub}</span>
      </span>
    </DropdownMenuItem>
  );
}
