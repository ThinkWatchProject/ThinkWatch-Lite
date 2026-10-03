import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { PlusIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { IconPlugin } from "@/ui/icons";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { DECLINED, undoable } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { RowMenu, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ListSkeleton, Loadable } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tip } from "@/ui/tip";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { writeQueue } from "@/lib/writeQueue";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { useNav, useNavParams } from "@/nav";
import { useConfigVersion } from "@/keys/data";
import type { Overview, PluginView, PluginWrite } from "@/types";
import { ChangedDialog } from "./ChangedDialog";
import { pluginDescription, pluginName } from "./defaults";
import { NewPluginEditor, PluginEditor, type EditorTab } from "./Editor";
import { DeleteDialog, ReorderDialog } from "./ListDialogs";
import { LogsDialog } from "./LogsDialog";
import { holdsToolCalls, manifestUnknown } from "./model";
import { PermissionChips, PluginText, RequestKinds, ScopeSummary, StatsCell, StatusOf } from "./parts";
import { pluginsPageText } from "./PluginsPage.i18n";
import { TrialDialog } from "./TrialDialog";
import { setEnabled, type NativeWrite } from "./write";

type DialogState =
  | null
  | { kind: "add" }
  /** 编辑器：哪一页先开着；`current` 是从磁盘上那一份起头（审核更改时文件读不了，去修它） */
  | { kind: "edit"; id: string; tab: EditorTab; from?: "approved" | "current" }
  | { kind: "review"; id: string }
  | { kind: "trial"; id: string }
  | { kind: "logs"; id: string }
  | { kind: "reorder" }
  /** 删的那一个连同它的样子一起记下：删成功之后它从列表里拿掉了，对话框还要放完收起动画 */
  | { kind: "delete"; target: PluginView };

/**
 * 插件页。
 *
 * 插件是一段 JavaScript：请求发往上游之前改写请求，回答交给客户端之前改写回答。它只在
 * core 的沙箱里运行，**从不在这个界面里运行**。这一页列出装着的插件（按运行的顺序）、各自
 * 的状态和权限，以及进入其余一切的入口：安装、设置、试运行、日志、确认文件变更、删除。
 *
 * 几条纪律：
 *
 * - **插件写的字一律按纯文本画**（名字、说明、设置项的标签、日志、报错），见 `PluginText`。
 *   core 自带的默认插件按界面语言说（`defaults.ts`）。
 * - **插件的 JS 文件是唯一的真相**：出错时怎么办、适用范围、设置都写在代码里。点一个插件
 *   打开它的编辑器（`Editor`），「设置」和「代码」两页、一个保存。添加插件用的是同一个编辑器，
 *   从一段模板起头，按钮是「安装」。
 * - **只有改得了回答里工具调用的插件**，装上它、打开它、改它的代码、批准它改过的文件，要在
 *   系统原生对话框里点头（`write.ts`）。别的写入不问；删除在应用里确认一次。
 * - 启用、停用可以撤销，一按就写。
 * - **不在运行、又会拒绝请求的插件挂一条横幅**：文件变了或者加载不了的插件不运行，出错时
 *   选了「拒绝」的，适用范围内的请求全部被拒 —— 这件事要一直看得见，直到处理掉。
 */
export default function PluginsPage({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const t = useText(pluginsPageText);
  const nav = useNav();
  const version = useConfigVersion(ov.config_version);
  /** 这一页上的写入排成一队：连着拨两个开关，第二次带第一次写完的版本（见 writeQueue） */
  const queue = useMemo(() => writeQueue(version), [version]);
  /*
    **统计跟着请求走。**运行次数、改写次数在请求落地时变，所以请求事件也让它重读（节流
    2.5 秒）；core 那边是内存里的数，读一次很便宜。
  */
  const plugins = useResource("plugins", () => call("Plugins", null), {
    events: ["config_reloaded", "request_finished", "request_failed", "plugin_failed"],
    deps: [ov.config_version],
  });
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState<Record<string, number>>({});
  const list = plugins.data;
  const byId = (id: string) => list?.find((p) => p.id === id);

  /** 写完一次：记下新版本，重读列表，告诉外壳（概览跟着重读） */
  const wrote = useCallback(
    (v: string) => {
      version.set(v);
      void plugins.reload();
      onChanged();
    },
    [version, plugins, onChanged],
  );

  /**
   * 要原生确认的写入：照样排进队里。用户在系统对话框里取消的，版本号不变、什么都没写
   */
  const native: NativeWrite = useCallback(
    async (run: (base: string) => Promise<PluginWrite>) => {
      let cancelled = false;
      const w = await queue(async (base) => {
        const r = await run(base);
        if (r.kind === "cancelled") {
          cancelled = true;
          return { version: base };
        }
        return { version: r.version };
      });
      if (cancelled) return "cancelled";
      wrote(w.version);
      return "done";
    },
    [queue, wrote],
  );

  // 从别处来的：定位一个插件、添加、审核文件变更（命令面板、通知）
  const [focus, setFocus] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  useNavParams("plugins", (p) => {
    setFocus(p.plugin ?? null);
    if (p.add) setDialog({ kind: "add" });
    else if (p.review) setDialog({ kind: "review", id: p.review });
  });
  useEffect(() => {
    if (!focus || !list?.some((p) => p.id === focus)) return;
    document.querySelector(`[data-plugin="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" });
    setHighlight(focus);
    setFocus(null);
  }, [focus, list]);
  useEffect(() => {
    if (!highlight) return;
    const h = setTimeout(() => setHighlight(null), 1600);
    return () => clearTimeout(h);
  }, [highlight]);

  async function tracked<T>(id: string, run: () => Promise<T>): Promise<T> {
    setPending((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
    try {
      return await run();
    } finally {
      setPending((p) => ({ ...p, [id]: Math.max(0, (p[id] ?? 0) - 1) }));
    }
  }

  /**
   * 启用、停用。**可以撤销**：先拨过去，写完给「撤销」。开关和确认过的代码一起交（`setEnabled`）。
   *
   * 改得了工具调用的插件（或者读不出权限的），打开它要在系统的确认框里点头：**开关不先拨
   * 过去**，转着圈等那个框，点了头才是开。点了取消，开关原样，什么都不说
   */
  function toggle(p: PluginView, enabled: boolean) {
    const send = (on: boolean, from: boolean) =>
      tracked(p.id, async () => {
        const r = await native((base) => setEnabled(p, on, from, base));
        return r === "cancelled" ? DECLINED : r;
      });
    const name = <PluginText text={pluginName(p.id, p.name)} />;
    const asks = enabled && holdsToolCalls(p.permissions);
    void undoable({
      message: enabled ? t.turnedOn(name) : t.turnedOff(name),
      apply: asks
        ? undefined
        : () => plugins.mutate((ps) => (ps ?? []).map((x) => (x.id === p.id ? { ...x, enabled } : x))),
      do: () => send(enabled, p.enabled),
      undo: () => send(!enabled, enabled),
    });
  }

  const taken = (list ?? []).map((p) => p.id);
  const at = (d: { id: string }) => byId(d.id);

  return (
    <Page>
      <PageHeader
        summary={<Summary list={list} loading={plugins.loading} />}
        actions={
          <>
            {list && list.length > 1 && (
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "reorder" })}>
                {t.reorder}
              </Button>
            )}
            <Button size="sm" onClick={() => setDialog({ kind: "add" })}>
              <PlusIcon />
              {t.add}
            </Button>
          </>
        }
      />

      <Loadable
        r={plugins}
        loading={<ListSkeleton rows={3} />}
        errorTitle={t.loadFailed}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            icon={<IconPlugin />}
            title={t.emptyTitle}
            description={t.emptyDescription}
            action={
              <Button size="sm" onClick={() => setDialog({ kind: "add" })}>
                <PlusIcon />
                {t.add}
              </Button>
            }
          />
        }
      >
        {(data) => (
          <div className="flex flex-col gap-4">
            <Stopped
              list={data}
              onReview={(id) => setDialog({ kind: "review", id })}
              onEdit={(id) => setDialog({ kind: "edit", id, tab: "code" })}
            />
            <PluginList
              list={data}
              highlight={highlight}
              pending={(id) => (pending[id] ?? 0) > 0}
              onToggle={toggle}
              onOpen={(kind, p) =>
                setDialog(
                  kind === "delete"
                    ? { kind, target: p }
                    : kind === "settings" || kind === "code"
                      ? { kind: "edit", id: p.id, tab: kind }
                      : { kind, id: p.id },
                )
              }
            />
          </div>
        )}
      </Loadable>

      {dialog?.kind === "add" && (
        <NewPluginEditor
          taken={taken}
          ov={ov}
          native={native}
          onClose={() => setDialog(null)}
          onInstalled={(id) => {
            setDialog(null);
            setFocus(id);
          }}
        />
      )}
      {dialog?.kind === "edit" && at(dialog) && (
        <PluginEditor
          // 换一个插件、换一份起头的代码就是另一个编辑器
          key={`${dialog.id}:${dialog.from ?? "approved"}`}
          plugin={at(dialog)!}
          tab={dialog.tab}
          from={dialog.from}
          ov={ov}
          native={native}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
          onReview={() => setDialog({ kind: "review", id: dialog.id })}
        />
      )}
      {dialog?.kind === "review" && at(dialog) && (
        <ChangedDialog
          plugin={at(dialog)!}
          native={native}
          onClose={() => setDialog(null)}
          onApproved={() => setDialog(null)}
          onEdit={(from) => setDialog({ kind: "edit", id: dialog.id, tab: "code", from })}
        />
      )}
      {dialog?.kind === "trial" && at(dialog) && <TrialDialog plugin={at(dialog)!} onClose={() => setDialog(null)} />}
      {dialog?.kind === "logs" && at(dialog) && (
        <LogsDialog
          plugin={at(dialog)!}
          onClose={() => setDialog(null)}
          onOpenRequest={(id) => {
            setDialog(null);
            nav.open("requests", { request: id });
          }}
        />
      )}
      {dialog?.kind === "reorder" && list && (
        <ReorderDialog
          list={list}
          onClose={() => setDialog(null)}
          onSave={async (ids) => {
            const w = await queue((base) => call("ReorderPlugins", { ids, base_version: base }));
            plugins.mutate((ps) => ids.map((id) => (ps ?? []).find((p) => p.id === id)!).filter(Boolean));
            wrote(w.version);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog
          target={dialog.target}
          onClose={() => setDialog(null)}
          onDelete={async () => {
            const w = await queue((base) => call("DeletePlugin", { base_version: base }, dialog.target.id));
            // 先从列表里拿掉（那一行淡出），再去取真值
            plugins.mutate((ps) => (ps ?? []).filter((p) => p.id !== dialog.target.id));
            wrote(w.version);
          }}
        />
      )}
    </Page>
  );
}

/**
 * 页头一行：几个插件，几个生效中、停用、文件已更改、加载失败（和行上的状态点同色）。
 */
function Summary({ list, loading }: { list: PluginView[] | undefined; loading: boolean }) {
  const t = useText(pluginsPageText);
  if (!list) return loading ? <Skeleton className="my-1 h-3 w-48 rounded-sm" /> : null;
  const count = (kind: PluginView["status"]["kind"]) => list.filter((p) => p.status.kind === kind).length;
  const items: [number, "ok" | "idle" | "warn" | "error", string][] = [
    [count("ok"), "ok", t.active],
    [count("disabled"), "idle", t.disabled],
    [count("changed"), "warn", t.changed],
    [count("error"), "error", t.failed],
  ];
  return (
    <>
      <SummaryItem value={<AnimatedNumber value={list.length} />} label={t.pluginsUnit(list.length)} />
      {items
        .filter(([n]) => n > 0)
        .map(([n, tone, label]) => (
          <SummaryItem key={label} lead={<StatusDot tone={tone} />} value={n} label={label} />
        ))}
    </>
  );
}

/**
 * 启用着、却没在运行的插件：文件变了，或者加载不了。**选了「拒绝这次请求」的，适用范围内的
 * 请求此刻全被拒绝** —— 一条一直在的横幅，按钮直接通到处理它的那个对话框。选了「跳过」的
 * 不拒请求，只是没在运行，用灰色的那一档。
 */
function Stopped({
  list,
  onReview,
  onEdit,
}: {
  list: PluginView[];
  onReview: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const t = useText(pluginsPageText);
  const stopped = list.filter((p) => p.enabled && (p.status.kind === "changed" || p.status.kind === "error"));
  if (stopped.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {stopped.map((p) => {
        const reject = p.on_error === "reject";
        const name = <PluginText text={pluginName(p.id, p.name)} />;
        if (p.status.kind === "changed") {
          return (
            <Banner
              key={p.id}
              layout="inline"
              tone={reject ? "warning" : "info"}
              title={t.changedTitle(name)}
              actions={
                <Button size="sm" variant="outline" onClick={() => onReview(p.id)}>
                  {t.review}
                </Button>
              }
            >
              {reject ? t.changedRejecting : t.changedSkipping}
            </Banner>
          );
        }
        return (
          <Banner
            key={p.id}
            layout="inline"
            tone={reject ? "error" : "info"}
            title={t.failedTitle(name)}
            actions={
              <Button size="sm" variant="outline" onClick={() => onEdit(p.id)}>
                {t.editCode}
              </Button>
            }
          >
            {p.status.kind === "error" && (
              <p className="break-words select-text">
                <PluginText text={coreText(p.status.message, p.id)} />
              </p>
            )}
            <p>{reject ? t.failedRejecting : t.failedSkipping}</p>
          </Banner>
        );
      })}
    </div>
  );
}

type RowAction = "settings" | "code" | "trial" | "logs" | "review" | "delete";

/**
 * 插件列表，**按运行的顺序**：前一个改过的内容交给后一个，所以行首写着它是第几个。
 *
 * 每一行三行字：名字和状态；说明（加载失败的是原因）；权限、还处理哪几种请求、适用范围、
 * 运行统计。右边是启用的开关，和**写成字的几个操作**（设置、试运行、日志、删除）—— 不用
 * 图标：这一页上每个操作都要一眼认得出，`…` 里藏着的东西用户想不到去找。文件变了的、加载
 * 不了的，处理它的那个操作排在最前面。点一行（或回车）打开设置；右键是同一份操作。
 *
 * **core 读不出 manifest 的**（停用着、缓存里又没有它）只画 id 和状态：权限、说明、范围
 * 都不知道，空着的标签会读成「没申请任何权限」。
 */
function PluginList({
  list,
  highlight,
  pending,
  onToggle,
  onOpen,
}: {
  list: PluginView[];
  highlight: string | null;
  pending: (id: string) => boolean;
  onToggle: (p: PluginView, enabled: boolean) => void;
  onOpen: (kind: RowAction, p: PluginView) => void;
}) {
  const t = useText(pluginsPageText);
  const rows = usePresentList(list, (p) => p.id);
  const menu = (p: PluginView): MenuItems => [
    ...(p.status.kind === "changed" ? [{ kind: "item" as const, label: t.menu.review, onSelect: () => onOpen("review", p) }] : []),
    { kind: "item", label: t.menu.settings, onSelect: () => onOpen("settings", p) },
    { kind: "item", label: t.menu.code, onSelect: () => onOpen("code", p) },
    { kind: "item", label: t.menu.trial, onSelect: () => onOpen("trial", p), disabled: p.status.kind === "error" },
    { kind: "item", label: t.menu.logs, onSelect: () => onOpen("logs", p) },
    { kind: "sep" },
    { kind: "item", label: t.menu.remove, onSelect: () => onOpen("delete", p), danger: true },
  ];
  return (
    <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
      {rows.map(({ item: p, key, presence }, i) => {
        const unknown = manifestUnknown(p);
        // 默认插件按界面语言说；读不出 manifest 的只有 id
        const w = { name: pluginName(p.id, p.name), description: unknown ? null : pluginDescription(p) };
        return (
        <RowMenu key={key} items={menu(p)}>
          <li
            data-plugin={p.id}
            className={cn(
              "flex cursor-default gap-3 border-b border-border px-4 py-3 outline-none last:border-b-0",
              "transition-colors duration-(--motion-fast) hover:bg-muted/30",
              "focus-visible:bg-muted/60 focus-visible:shadow-[inset_2px_0_0_0_var(--ring)]",
              highlight === p.id && "bg-muted/60",
              rowMotion(presence),
            )}
            // 加载失败的：点开先看代码（设置读不出来）
            {...openable(() => onOpen(p.status.kind === "error" ? "code" : "settings", p))}
          >
            <Tip text={t.order(i + 1)}>
              <span className="mt-px w-4 shrink-0 text-right tw-num tw-body text-muted-foreground">{i + 1}</span>
            </Tip>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2.5">
                {unknown ? (
                  <span className={cn("min-w-0 truncate font-mono tw-head", p.enabled ? "text-foreground" : "text-muted-foreground")}>
                    {p.id}
                  </span>
                ) : (
                  <PluginText
                    text={w.name}
                    className={cn("min-w-0 truncate tw-head", p.enabled ? "text-foreground" : "text-muted-foreground")}
                  />
                )}
                <StatusOf status={p.status} />
              </div>
              {p.status.kind === "error" ? (
                <p className="mt-0.5 truncate tw-body text-destructive">
                  <PluginText text={coreText(p.status.message, p.id)} />
                </p>
              ) : (
                w.description && (
                  <p className="mt-0.5 truncate tw-body text-muted-foreground">
                    <PluginText text={w.description} />
                  </p>
                )
              )}
              {/*
                权限、还处理哪几种请求、适用范围、统计在左，写成字的操作在右。**窗口窄时操作整组
                折到下一行**（靠右），不去挤名字和状态
              */}
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 tw-label">
                {!unknown && (
                  <>
                    <PermissionChips permissions={p.permissions} />
                    <RequestKinds kinds={p.requests} className="text-muted-foreground" />
                    <span className="flex min-w-0 max-w-[260px] items-center gap-1">
                      <span className="shrink-0 text-muted-foreground/80">{t.appliesTo}</span>
                      <ScopeSummary scope={p.scope} />
                    </span>
                    <StatsCell stats={p.stats} pluginId={p.id} />
                  </>
                )}
                <span className="-my-1 -mr-2 ml-auto flex shrink-0 items-center" {...keepInRow}>
                  {p.status.kind === "changed" && (
                    <Button size="xs" variant="outline" className="mr-1" onClick={() => onOpen("review", p)}>
                      {t.review}
                    </Button>
                  )}
                  {p.status.kind === "error" && (
                    <Button size="xs" variant="outline" className="mr-1" onClick={() => onOpen("code", p)}>
                      {t.editCode}
                    </Button>
                  )}
                  <RowWord onClick={() => onOpen("settings", p)}>{t.settings}</RowWord>
                  <RowWord onClick={() => onOpen("trial", p)} disabled={p.status.kind === "error"}>
                    {t.trial}
                  </RowWord>
                  <RowWord onClick={() => onOpen("logs", p)}>{t.logs}</RowWord>
                  <RowWord onClick={() => onOpen("delete", p)} danger>
                    {t.remove}
                  </RowWord>
                </span>
              </div>
            </div>
            <div className="shrink-0 pt-0.5" {...keepInRow}>
              <Switch
                size="sm"
                checked={p.enabled}
                pending={pending(p.id)}
                aria-label={t.toggleFor(unknown ? p.id : w.name)}
                onCheckedChange={(v) => onToggle(p, v)}
              />
            </div>
          </li>
        </RowMenu>
        );
      })}
    </ul>
  );
}

/** 行上写成字的一个操作。灰字，悬停变实；删除悬停是红的 */
function RowWord({
  onClick,
  disabled,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: string;
}) {
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
      className={cn("font-normal text-muted-foreground hover:text-foreground", danger && "hover:text-destructive")}
    >
      {children}
    </Button>
  );
}

/** 可以点开的一行：单击、回车、空格打开。**选中文字不算点击**；行里的按钮不冒泡上来 */
function openable(open: () => void) {
  return {
    tabIndex: 0,
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  };
}

/** 行里自己能点的那一块（开关、操作）：点击和按键不再冒泡成「打开这一行」 */
const keepInRow = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
};
