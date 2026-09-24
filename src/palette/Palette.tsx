import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeftRightIcon } from "lucide-react";
import { useLang, useText } from "@/i18n";
import { useNav } from "@/nav";
import { useConnections } from "@/connection/ConnectionProvider";
import { useResource } from "@/lib/resource";
import { api as clientsApi } from "@/clients/api";
import { cn } from "@/lib/utils";
import { notify } from "@/ui/notify";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/ui/command";
import type { Overview, RequestRow } from "@/types";
import type { Found, UpdateView } from "@/updateFlow";
import { arrange } from "./arrange";
import { buildItems, requestItems, type GroupId, type Item, type Verb } from "./items";
import { COMBOS, Keys, type Combo } from "./keys";
import { normalize, requestIdQuery, score } from "./match";
import { paletteText } from "./palette.i18n";
import { ShortcutSheet } from "./ShortcutSheet";
import { loadUsage, recordUse, type Usage } from "./usage";

export interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 快捷键一览开着。它和面板挂在一起：面板里能打开它，`?` 也能 */
  shortcuts: boolean;
  onShortcutsChange: (open: boolean) => void;
  /** 连上 core 了 */
  linked: boolean;
  /** 连着的远程 core 断了：内容只读，写配置的动作不出现 */
  readOnly: boolean;
  /** 连着远程 core */
  remote: boolean;
  ov: Overview | null;
  /** 流量页已经取回来的请求（新的在前）。按编号、模型搜 */
  rows: readonly RequestRow[];
  railOpen: boolean;
  /** 只有外壳做得了的几件事 */
  shell: {
    toggleRail: () => void;
    refresh: () => void;
    configFile: () => void;
    history: () => void;
    notices: () => void;
  };
}

/**
 * ⌘K 的命令面板，和 `?` 的快捷键一览。
 *
 * **面板不自己做事，只是把人送到做事的地方。**「新建上游」打开的是上游页上那个对话框
 * （`nav.open("upstreams", { create: "upstream" })`），「deepseek」打开的是点那一行
 * 会打开的那个 —— 对话框只有一份，在页面里。面板自己做的只有页面上没有入口的几件：
 * 检查更新、切换连接那一级列表。
 *
 * 能搜的：页面、操作、上游、密钥、路由、策略组、客户端、连接、设置的各节，以及流量页
 * 已经取回来的请求（按编号、模型）。**都是已经在手上的数据**：概览、流量的
 * 行、连接列表；客户端要现扫一次配置文件，打开面板时读（有缓存，第二次打开立刻有）。
 */
export function Palette(props: PaletteProps) {
  const { open, onOpenChange } = props;
  const t = useText(paletteText);
  /** 打开之前焦点在哪。关的时候只还给能打字的地方，见 `onCloseAutoFocus` */
  const before = useRef<Element | null>(null);
  /** 这次关闭是因为执行了一项：焦点交给那一项打开的东西 */
  const ran = useRef(false);
  /**
   * 在下一级里按 Esc：回到最外层，不关面板。**只能在对话框那一层拦**：Radix 在
   * document 的捕获阶段处理 Esc，比面板里任何一个按键处理都早
   */
  const escape = useRef<(() => boolean) | null>(null);
  // 在 Radix 把焦点挪进面板之前记下来（它在 effect 里挪，这里是 layout effect）
  useLayoutEffect(() => {
    if (!open) return;
    before.current = document.activeElement;
    ran.current = false;
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-passive=""
          showCloseButton={false}
          aria-describedby={undefined}
          className={cn(
            "top-[max(48px,12vh)] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-[640px]",
            // 缩放 + 淡入：从 0.97 长到 1，200ms 缓出；关的时候 150ms。系统关了动效只剩淡入淡出
            "origin-top duration-200 ease-(--motion-ease) data-closed:duration-150",
            "[&[data-state=open]]:[--tw-enter-scale:0.97] [&[data-state=closed]]:[--tw-exit-scale:0.98]",
          )}
          onEscapeKeyDown={(e) => {
            // 输入法里按 Esc 是取消这次输入，不是关面板（WebKit 里是 keyCode 229）
            if (e.isComposing || e.keyCode === 229 || escape.current?.()) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // 执行了一项：焦点在那一项打开的东西里（对话框、搜索框），不抢回来。只是看了
            // 一眼就关掉：之前在打字的话回到那个输入框；之前在按钮上的不还 —— WebKit
            // 里脚本聚焦的按钮会画上一圈焦点框（见 Notices.tsx）
            const el = before.current as HTMLElement | null;
            if (!ran.current && el && el.isConnected && isTextField(el)) el.focus();
          }}
        >
          <DialogTitle className="sr-only">{t.title}</DialogTitle>
          {/* 面板关上（淡出结束）之后 Radix 把里面整个卸掉：下次打开查询、所在的一级都从头来 */}
          <PaletteBody
            {...props}
            escape={escape}
            close={() => {
              ran.current = true;
              onOpenChange(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <ShortcutSheet open={props.shortcuts} onOpenChange={props.onShortcutsChange} />
    </>
  );
}

/**
 * 面板里面。**只在开着的时候挂着**（Radix 关上之后卸掉内容）：查询、所在的一级、选中的
 * 那一项每次打开都从头来，客户端列表也只在这时候读。
 */
function PaletteBody({
  linked,
  readOnly,
  remote,
  ov,
  rows,
  railOpen,
  shell,
  onShortcutsChange,
  escape,
  close,
}: PaletteProps & { escape: { current: (() => boolean) | null }; close: () => void }) {
  const t = useText(paletteText);
  const lang = useLang();
  const nav = useNav();
  const conn = useConnections();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"connections" | null>(null);
  /** 选中的那一项，和它是在哪一次查询（哪一级）里选的。见下面 `selected` */
  const [picked, setPicked] = useState<{ value: string; asked: string }>({ value: "", asked: "" });
  const [usage, setUsage] = useState<Usage>(loadUsage);

  // 客户端：这台机器上的应用。和客户端页、密钥页同一份缓存（`useClients` 的键和取数）：
  // 看过那两页就立刻有，面板打开时再在后台读一次。没连上 core 不读；读不到就少一组
  const clients = useResource(linked ? "clients" : null, clientsApi.list);

  const items = useMemo(
    () =>
      buildItems({
        nav,
        lang,
        linked,
        readOnly,
        remote,
        ov,
        railOpen,
        conn: conn.view,
        clients: clients.data,
        switchTo: conn.switchTo,
        addConnection: conn.add,
        shell: {
          ...shell,
          shortcuts: () => onShortcutsChange(true),
          checkUpdates: () => checkForUpdates(t),
        },
      }),
    // `shell` 和 `t` 不在依赖里：前者是外壳的几个固定动作，后者跟着 `lang` 变
    [nav, lang, linked, readOnly, remote, ov, railOpen, conn.view, clients.data],
  );

  const requests = useMemo(() => {
    if (!linked || scope !== null || !normalize(query)) return [];
    return requestItems(rows, ov, nav, (title, kw) => score(query, title, kw), requestIdQuery(query), 5);
  }, [linked, scope, query, rows, ov, nav]);

  const shown = useMemo(
    () => arrange<Item>({ items, extra: requests, query, scope, usage }),
    [items, requests, query, scope, usage],
  );
  const byValue = useMemo(() => new Map(shown.flatMap((g) => g.items.map((x) => [x.value, x.item] as const))), [shown]);

  /*
    **选中哪一项由这里算，不交给 cmdk。**结果是自己排的（`shouldFilter` 关着），cmdk
    在查询变了之后先按它记着的上一项去滚、再改选第一项：打一个 `c`，上一次选中的
    「概览」还在结果里、排到了很下面，列表就跟着滚了下去，第一行反倒看不见。

    所以选中的值是**在渲染时算出来的**，和结果同一帧：查询变了、进出了一级，那一次
    选的就不算了，直接是第一项（进出一级时查询常常本来就是空的，cmdk 不会自己重选）；
    结果自己变了（客户端读到了、来了新请求），选中的那一项还在就不动，没了也是第一项。
  */
  const asked = JSON.stringify([scope, query]);
  const first = shown.flatMap((g) => g.items).find((x) => !x.item.disabled)?.value ?? "";
  const selected = picked.asked === asked && byValue.has(picked.value) ? picked.value : first;
  const current = byValue.get(selected);

  // 查询变了、进出了一级：列表滚回顶上（选中的是第一项，cmdk 不会再滚）
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [asked]);

  const run = (item: Item) => {
    setUsage(recordUse(item.id));
    if (item.enter) {
      setScope(item.enter);
      setQuery("");
      return;
    }
    close();
    // 面板关掉之后再动：对话框的焦点归还和新页面挂上不要挤在同一帧
    setTimeout(item.run, 0);
  };

  const back = () => {
    setScope(null);
    setQuery("");
  };
  useLayoutEffect(() => {
    escape.current = () => {
      if (scope === null) return false;
      setScope(null);
      setQuery("");
      return true;
    };
  }, [escape, scope]);

  const q = normalize(query);
  const empty = shown.length === 0;

  return (
    <Command
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={(value) => setPicked({ value, asked })}
      label={t.title}
      onKeyDown={(e) => {
        // 在下一级里，输入框空着再按退格：回到最外层（Esc 在对话框那一层处理）
        if (scope !== null && e.key === "Backspace" && query === "" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          back();
        }
      }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={
          scope === "connections" ? t.connectionsPlaceholder : linked ? t.placeholder : t.placeholderUnlinked
        }
        spellCheck={false}
        autoComplete="off"
        className="tw-title font-normal"
        lead={
          scope === "connections" && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 tw-label font-medium text-foreground">
              <ArrowLeftRightIcon className="size-3" aria-hidden />
              {t.groups.connections}
            </span>
          )
        }
        trail={<Keys combo={["esc"]} className="shrink-0" />}
      />
      <CommandList ref={listRef}>
        <div className="py-1.5">
          {shown.map((g) => (
            <CommandGroup key={g.group} heading={groupHeading(t, g.group as GroupId)}>
              {g.items.map(({ item, value }) => (
                <Row key={value} value={value} item={item} query={q} onSelect={() => run(item)} />
              ))}
            </CommandGroup>
          ))}
        </div>
        {empty && <CommandEmpty>{q ? t.none(query.trim()) : t.noConnections}</CommandEmpty>}
      </CommandList>
      <Footer
        verb={current && !current.disabled ? current.verb : null}
        scope={scope}
        onBack={back}
        onShortcuts={() => {
          close();
          setTimeout(() => onShortcutsChange(true), 0);
        }}
      />
    </Command>
  );
}

function groupHeading(t: (typeof paletteText)["zh"], g: GroupId): string {
  return t.groups[g];
}

/** 一行：图标、名字（搜中的字加粗）、灰字的补充、右端的状态或键帽 */
function Row({ item, value, query, onSelect }: { item: Item; value: string; query: string; onSelect: () => void }) {
  return (
    <CommandItem value={value} onSelect={onSelect} disabled={item.disabled} className="data-disabled:opacity-60">
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-selected/command-item:text-foreground"
      >
        {item.icon}
      </span>
      <span className="min-w-0 truncate">{highlight(item.title, query)}</span>
      {item.detail && <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.detail}</span>}
      {(item.meta || item.combo) && (
        <CommandShortcut>
          {item.meta}
          {item.combo && <Keys combo={item.combo} capClassName={SELECTED_CAP} />}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}

/** 选中的那一行底色和键帽同一种灰：键帽换成面板的底色，读起来还是一个个键 */
const SELECTED_CAP = "group-data-selected/command-item:bg-popover group-data-selected/command-item:text-foreground";

/**
 * 名字里和查询对上的那几段加重。**只标连续命中的**（开头、词首、包含）；按字母
 * 顺序散着命中的不标 —— 零零散散加粗几个字母读起来像乱码。
 */
function highlight(title: string, query: string): ReactNode {
  if (!query) return title;
  const lower = title.toLowerCase();
  const ranges: [number, number][] = [];
  for (const token of query.split(" ")) {
    const at = lower.indexOf(token);
    if (token && at >= 0) ranges.push([at, at + token.length]);
  }
  if (ranges.length === 0) return title;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out: ReactNode[] = [];
  let at = 0;
  merged.forEach(([from, to], i) => {
    if (from > at) out.push(title.slice(at, from));
    out.push(
      <span key={i} className="font-semibold text-foreground">
        {title.slice(from, to)}
      </span>,
    );
    at = to;
  });
  if (at < title.length) out.push(title.slice(at));
  return out;
}

/**
 * 底边：左边是快捷键一览（在下一级时是「返回」），右边是按键提示。`verb` 为 `null`：
 * 没有能选的结果，按键提示不出现 —— 这时按回车什么都不会发生。
 */
function Footer({
  verb,
  scope,
  onBack,
  onShortcuts,
}: {
  verb: Verb | null;
  scope: string | null;
  onBack: () => void;
  onShortcuts: () => void;
}) {
  const t = useText(paletteText);
  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-t border-border bg-surface/60 pr-3.5 pl-2 tw-label text-muted-foreground">
      {scope !== null ? (
        <Button variant="ghost" size="xs" className="gap-1.5 text-muted-foreground" onClick={onBack}>
          <Keys combo={["backspace"]} capClassName={FOOTER_CAP} />
          {t.back}
        </Button>
      ) : (
        <Button variant="ghost" size="xs" className="gap-1.5 text-muted-foreground" onClick={onShortcuts}>
          <Keys combo={COMBOS.shortcuts} capClassName={FOOTER_CAP} />
          {t.shortcuts}
        </Button>
      )}
      <span className="flex-1" />
      {verb !== null && (
        <>
          <Hint combos={[["up"], ["down"]]} label={t.move} />
          <Hint combos={[["enter"]]} label={t.verbs[verb]} />
        </>
      )}
    </div>
  );
}

/**
 * 底边上的键帽。底边压了一档灰，键帽原来的灰底在浅色下几乎看不出来：换成面板的底色
 * 加一圈细边，读起来是一个个键
 */
const FOOTER_CAP = "bg-popover inset-ring inset-ring-border";

function Hint({ combos, label }: { combos: Combo[]; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-0.5">
        {combos.map((c) => (
          <Keys key={c.join("+")} combo={c} capClassName={FOOTER_CAP} />
        ))}
      </span>
      {label}
    </span>
  );
}

function isTextField(el: HTMLElement): boolean {
  return (
    (el.tagName === "INPUT" && !["button", "checkbox", "radio", "submit"].includes((el as HTMLInputElement).type)) ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

/**
 * 检查更新。**查到了 Rust 那边会把更新窗口拉起来**（和设置里「检查更新」同一条路，
 * 见 Update.tsx），这里只在吐司里说一句结果：没有新版本的时候界面上什么都不会变。
 */
function checkForUpdates(t: (typeof paletteText)["zh"]) {
  notify.promise(
    invoke<Found | null>("update_check").then(async (found) => {
      if (found) return t.found(found.version);
      const v = await invoke<UpdateView>("update_state");
      return t.latest(v.version);
    }),
    { loading: t.checking, success: (msg) => msg, error: t.checkFailed },
  );
}
